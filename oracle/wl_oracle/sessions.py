"""Sessionisation: turning a stream of credited intervals into sessions.

A session is a maximal run of activity on one app. It is broken by a
different app taking focus, a gap longer than the merge gap, or a lock or
sleep event falling inside the gap. Sessions may cross midnight; rollups
split them, sessions do not.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median

from .intervals import Interval, credited, measure, overlaps_any, union
from .model import App, Event, Params


@dataclass(frozen=True)
class Session:
    app_id: str
    start: int
    end: int
    active_ms: int
    local_date: str
    index: int


def build_sessions(events: Sequence[Event], params: Params) -> list[Session]:
    activity: list[tuple[Interval, str]] = []
    barriers: list[Interval] = []
    for event in events:
        if event.is_barrier:
            barriers.append((event.ts_start, event.ts_end))
            continue
        iv = credited(event, params)
        if iv is not None:
            activity.append((iv, event.app_id or ""))

    activity.sort(key=lambda pair: pair[0])
    barrier_union = union(barriers)

    sessions: list[Session] = []
    current: list[Interval] = []
    current_app: str | None = None
    current_start = 0
    current_end = 0

    def close() -> None:
        nonlocal current, current_app
        if current and current_app is not None:
            sessions.append(
                Session(
                    app_id=current_app,
                    start=current_start,
                    end=current_end,
                    active_ms=measure(current),
                    local_date=params.to_local(current_start).date().isoformat(),
                    index=len(sessions),
                )
            )
        current = []
        current_app = None

    for iv, app_id in activity:
        start, end = iv
        if current_app is None:
            current, current_app, current_start, current_end = [iv], app_id, start, end
            continue
        gap = start - current_end
        broken = (
            app_id != current_app
            or gap > params.merge_gap_ms
            or gap > params.idle_split_ms
            or (gap > 0 and overlaps_any((current_end, start), barrier_union))
        )
        if broken:
            close()
            current, current_app, current_start, current_end = [iv], app_id, start, end
        else:
            current.append(iv)
            current_end = max(current_end, end)
    close()
    return sessions


def count_switches(sessions: Sequence[Session], params: Params) -> int:
    """Foreground app changes, excluding returns after a real gap."""
    switches = 0
    for previous, following in zip(sessions, sessions[1:], strict=False):
        if following.app_id != previous.app_id and following.start - previous.end <= params.merge_gap_ms:
            switches += 1
    return switches


def median_session_ms(sessions: Sequence[Session]) -> int:
    if not sessions:
        return 0
    return int(median(session.active_ms for session in sessions))


def sessions_by_app(sessions: Sequence[Session]) -> dict[str, list[Session]]:
    grouped: dict[str, list[Session]] = {}
    for session in sessions:
        grouped.setdefault(session.app_id, []).append(session)
    return grouped


def app_active_ms(sessions: Sequence[Session]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for session in sessions:
        totals[session.app_id] = totals.get(session.app_id, 0) + session.active_ms
    return totals


def is_communication(app_id: str, apps: dict[str, App]) -> bool:
    app = apps.get(app_id)
    return bool(app and app.is_communication)
