"""The metrics engine.

Every number the product shows, and every number the model is allowed to
talk about, is computed here. Definitions follow section 6 of the spec; the
identifiers match the code, not prose.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from statistics import median

from .intervals import Interval, clip, credited
from .model import HOUR, MINUTE, App, Event, Params, window_events
from .sessions import (
    Session,
    app_active_ms,
    build_sessions,
    count_switches,
    is_communication,
    median_session_ms,
    sessions_by_app,
)

LATE_HOURS = frozenset({22, 23, 0, 1, 2, 3, 4, 5})


@dataclass
class DayStats:
    day: str
    active_ms: int = 0
    switches: int = 0
    sessions: int = 0
    late_ms: int = 0
    focus_ms: int = 0
    longest_run_ms: int = 0
    longest_gap_ms: int = 0
    first_ts: int | None = None
    last_ts: int | None = None
    by_app: dict[str, int] = field(default_factory=dict)
    by_hour: dict[int, int] = field(default_factory=dict)
    coverage: float = 0.0

    def as_fact(self) -> dict:
        return {
            "day": self.day,
            "active_h": round(self.active_ms / HOUR, 2),
            "switches": self.switches,
            "sessions": self.sessions,
            "late_h": round(self.late_ms / HOUR, 2),
            "focus_h": round(self.focus_ms / HOUR, 2),
            "longest_run_min": round(self.longest_run_ms / 60_000, 1),
            "longest_gap_min": round(self.longest_gap_ms / 60_000, 1),
            "coverage": round(self.coverage, 2),
        }


@dataclass
class FocusBlock:
    start: int
    end: int
    apps: list[str]
    active_ms: int


@dataclass
class Window:
    start: str
    end: str
    params: Params
    apps: dict[str, App]
    fidelity: str
    days: dict[str, DayStats]
    sessions: list[Session]
    focus_blocks: list[FocusBlock]
    by_hour_ms: dict[int, int]
    active_ms: int
    switches: int
    coverage: float
    baseline: dict | None = None

    # ---------------- derived scalars
    @property
    def active_hours(self) -> float:
        return self.active_ms / HOUR

    @property
    def switches_per_hour(self) -> float:
        return self.switches / self.active_hours if self.active_ms else 0.0

    @property
    def late_night_share(self) -> float:
        late = sum(day.late_ms for day in self.days.values())
        return late / self.active_ms if self.active_ms else 0.0

    @property
    def short_session_share(self) -> float:
        if not self.sessions:
            return 0.0
        short = [s for s in self.sessions if s.active_ms < self.params.short_ms]
        return len(short) / len(self.sessions)

    @property
    def ai_share(self) -> float:
        ai_ms = 0
        for app_id, ms in app_active_ms(self.sessions).items():
            app = self.apps.get(app_id)
            if app and app.is_ai_tool:
                ai_ms += ms
        return ai_ms / self.active_ms if self.active_ms else 0.0

    @property
    def focus_hours(self) -> float:
        return sum(block.active_ms for block in self.focus_blocks) / HOUR

    @property
    def complete_days(self) -> int:
        return sum(1 for day in self.days.values() if day.coverage >= 0.7)

    def app_totals(self) -> list[dict]:
        totals = app_active_ms(self.sessions)
        grouped = sessions_by_app(self.sessions)
        rows = []
        for app_id, ms in totals.items():
            app = self.apps.get(app_id)
            rows.append(
                {
                    "id": app_id,
                    "name": app.name if app else app_id,
                    "active_ms": ms,
                    "share": (ms / self.active_ms) if self.active_ms else 0.0,
                    "sessions": len(grouped.get(app_id, [])),
                    "median_session_min": round(median_session_ms(grouped.get(app_id, [])) / 60_000, 1),
                }
            )
        rows.sort(key=lambda r: (-r["active_ms"], r["id"]))
        return rows


def _bucket_day_hour(interval: Interval, params: Params) -> dict[tuple[str, int], int]:
    buckets: dict[tuple[str, int], int] = {}
    start, end = interval
    cursor = start
    while cursor < end:
        local = params.to_local(cursor)
        key = (local.date().isoformat(), local.hour)
        hour_end = local.replace(minute=0, second=0, microsecond=0)
        from datetime import timedelta

        hour_end = hour_end + timedelta(hours=1)
        boundary = min(end, params.to_utc_ms(hour_end))
        if boundary <= cursor:
            break
        buckets[key] = buckets.get(key, 0) + (boundary - cursor)
        cursor = boundary
    return buckets


def _focus_blocks(sessions: Sequence[Session], params: Params, apps: dict[str, App]) -> list[FocusBlock]:
    blocks: list[FocusBlock] = []
    run: list[Session] = []

    def flush() -> None:
        nonlocal run
        if not run:
            return
        active = sum(s.active_ms for s in run)
        distinct = {s.app_id for s in run}
        if active >= params.focus_min_ms and len(distinct) <= params.focus_max_apps:
            blocks.append(
                FocusBlock(
                    start=run[0].start,
                    end=run[-1].end,
                    apps=sorted(distinct),
                    active_ms=active,
                )
            )
        run = []

    for session in sessions:
        if is_communication(session.app_id, apps):
            flush()
            continue
        if not run:
            run = [session]
            continue
        gap = session.start - run[-1].end
        distinct = {s.app_id for s in run} | {session.app_id}
        if gap > params.focus_gap_ms or len(distinct) > params.focus_max_apps:
            flush()
            run = [session]
        else:
            run.append(session)
    flush()
    return blocks


def compute(
    events: Sequence[Event],
    apps: dict[str, App],
    params: Params,
    start: str,
    end: str,
    fidelity: str = "L4",
    baseline: dict | None = None,
) -> Window:
    evs = window_events(events, start, end)
    day_names = params.days_between(start, end)
    days = {day: DayStats(day=day) for day in day_names}

    day_hour: dict[tuple[str, int], int] = {}
    for event in evs:
        iv = credited(event, params)
        if iv is None:
            continue
        for (day, hour), ms in _bucket_day_hour(iv, params).items():
            day_hour[(day, hour)] = day_hour.get((day, hour), 0) + ms
            if day in days:
                stats = days[day]
                stats.by_hour[hour] = stats.by_hour.get(hour, 0) + ms
                stats.by_app[event.app_id or ""] = stats.by_app.get(event.app_id or "", 0) + ms
                if hour in LATE_HOURS:
                    stats.late_ms += ms

    sessions = build_sessions(evs, params)
    for session in sessions:
        day = session.local_date
        if day in days:
            days[day].sessions += 1
            if days[day].first_ts is None:
                days[day].first_ts = session.start
            days[day].last_ts = max(days[day].last_ts or 0, session.end)

    for previous, following in zip(sessions, sessions[1:], strict=False):
        if following.app_id != previous.app_id and following.start - previous.end <= params.merge_gap_ms:
            day = params.to_local(following.start).date().isoformat()
            if day in days:
                days[day].switches += 1

    # per-day active time from the day/hour buckets (union-safe, already split)
    for (day, _hour), ms in day_hour.items():
        if day in days:
            days[day].active_ms += ms

    blocks = _focus_blocks(sessions, params, apps)
    for block in blocks:
        day = params.to_local(block.start).date().isoformat()
        if day in days:
            days[day].focus_ms += block.active_ms

    # break debt and recovery gap, per day, from that day's sessions
    for day, stats in days.items():
        todays = [s for s in sessions if s.local_date == day]
        stats.longest_run_ms = _longest_run(todays, params)
        stats.longest_gap_ms = _longest_gap(todays, params, day)
        stats.coverage = _day_coverage(stats)

    by_hour_ms: dict[int, int] = {}
    for (_day, hour), ms in day_hour.items():
        by_hour_ms[hour] = by_hour_ms.get(hour, 0) + ms

    active_ms = sum(stats.active_ms for stats in days.values())
    observed = [stats.coverage for stats in days.values() if stats.active_ms > 0]
    coverage = float(median(observed)) if observed else 0.0

    return Window(
        start=start,
        end=end,
        params=params,
        apps=apps,
        fidelity=fidelity,
        days=days,
        sessions=sessions,
        focus_blocks=blocks,
        by_hour_ms=by_hour_ms,
        active_ms=active_ms,
        switches=count_switches(sessions, params),
        coverage=coverage,
        baseline=baseline,
    )


def _day_coverage(stats: DayStats) -> float:
    """Share of the day's observed span that was actually captured.

    Deliberately not `active / waking window`: a normal six-hour working day
    would score 40 % and be flagged incomplete, which is a false alarm. The
    denominator is the span from the first to the last activity of the day,
    so the metric measures missing capture rather than idleness. See
    docs/adr/0004-coverage-definition.md.
    """
    if stats.first_ts is None or stats.last_ts is None:
        return 0.0
    span = stats.last_ts - stats.first_ts
    if span < MINUTE:
        return 1.0 if stats.active_ms > 0 else 0.0
    return min(1.0, stats.active_ms / span)


def _longest_run(sessions: Sequence[Session], params: Params) -> int:
    """Longest continuous stretch of activity without a real break."""
    longest = 0
    run = 0
    previous_end: int | None = None
    for session in sessions:
        if previous_end is None:
            run = session.active_ms
        else:
            gap = session.start - previous_end
            if gap >= params.break_min_ms:
                longest = max(longest, run)
                run = session.active_ms
            else:
                run += session.active_ms
        previous_end = session.end
    return max(longest, run)


def _longest_gap(sessions: Sequence[Session], params: Params, day: str) -> int:
    lo, hi = params.day_bounds(day)
    wake_lo = params.to_utc_ms(params.to_local(lo).replace(hour=params.wake_start_hour, minute=0, second=0))
    wake_hi = params.to_utc_ms(params.to_local(lo).replace(hour=params.wake_end_hour, minute=0, second=0))
    if not sessions:
        return wake_hi - wake_lo
    points: list[Interval] = []
    for session in sessions:
        clipped = clip((session.start, session.end), wake_lo, wake_hi)
        if clipped:
            points.append(clipped)
    if not points:
        return wake_hi - wake_lo
    points.sort()
    longest = max(0, points[0][0] - wake_lo)
    for previous, following in zip(points, points[1:], strict=False):
        longest = max(longest, following[0] - previous[1])
    longest = max(longest, wake_hi - points[-1][1])
    return longest


def trailing_median(values: Sequence[float]) -> float:
    return float(median(values)) if values else 0.0
