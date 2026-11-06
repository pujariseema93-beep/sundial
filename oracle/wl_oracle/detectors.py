"""Pattern detectors.

Each detector is a pure function over a computed Window (plus an optional
baseline built from preceding weeks). It emits a fact, never prose: the
wording in `evidence` is a number with its unit, and the model is the only
thing allowed to write a sentence about it.

D09 (context churn across projects) and D10 (goal drift) are not implemented
in M0: the first needs clustering, the second needs user-stated goals.
"""

from __future__ import annotations

from statistics import mean

from .metrics import Window
from .model import HOUR, MINUTE

DETECTOR_VERSION = "d01-d08@1"


def _days_with(window: Window, predicate) -> list[str]:
    return [day for day, stats in sorted(window.days.items()) if predicate(stats)]


def _pct(value: float) -> str:
    return f"{round(value * 100, 1)}%"


def d01_late_night_drift(window: Window) -> dict | None:
    baseline = window.baseline
    if not baseline:
        return None
    previous = baseline.get("late_night_share")
    if previous is None:
        return None
    shift = window.late_night_share - previous
    late_days = _days_with(window, lambda s: s.late_ms >= 30 * MINUTE)
    if shift < 0.10 or len(late_days) < 3:
        return None
    return {
        "id": "D01",
        "name": "late_night_drift",
        "severity": "medium" if shift < 0.20 else "high",
        "evidence": [
            f"late_night_share {round(previous, 3)} -> {round(window.late_night_share, 3)}",
            f"{len(late_days)} days with 30+ min after {window.params.late_start_hour}:00",
        ],
        "scope": f"days {', '.join(late_days)}",
    }


def d02_fragmentation_spike(window: Window) -> dict | None:
    baseline = window.baseline
    if not baseline or not baseline.get("switches_per_hour"):
        return None
    previous = baseline["switches_per_hour"]
    if window.switches_per_hour <= previous * 1.25:
        return None
    short_previous = baseline.get("short_session_share", 0.0)
    if window.short_session_share < short_previous:
        return None
    return {
        "id": "D02",
        "name": "fragmentation_spike",
        "severity": "medium" if window.switches_per_hour < previous * 1.5 else "high",
        "evidence": [
            f"switches_per_hour {round(previous, 1)} -> {round(window.switches_per_hour, 1)}",
            f"short_session_share {round(short_previous, 2)} -> {round(window.short_session_share, 2)}",
        ],
        "scope": "window",
    }


def d03_tool_thrash(window: Window) -> dict | None:
    """Four or more apps cycling inside ten minutes, three or more times a day."""
    blocks_by_day: dict[str, int] = {}
    sessions = window.sessions
    i = 0
    while i < len(sessions):
        j = i
        apps: list[str] = []
        while j < len(sessions) and sessions[j].start - sessions[i].start <= 10 * MINUTE:
            apps.append(sessions[j].app_id)
            j += 1
        distinct = []
        for app_id in apps:
            if not distinct or distinct[-1] != app_id:
                distinct.append(app_id)
        if len(set(distinct)) >= 4 and len(distinct) >= 6:
            day = sessions[i].local_date
            blocks_by_day[day] = blocks_by_day.get(day, 0) + 1
            i = j
        else:
            i += 1
    hot_days = {day: count for day, count in blocks_by_day.items() if count >= 3}
    if not hot_days:
        return None
    pairs = sorted(hot_days.items())
    return {
        "id": "D03",
        "name": "tool_thrash",
        "severity": "medium",
        "evidence": [
            f"{len(hot_days)} days with 3+ ten-minute blocks cycling 4+ apps",
            "worst day: " + max(hot_days.items(), key=lambda kv: kv[1])[0],
        ],
        "scope": ", ".join(day for day, _ in pairs),
    }


def d04_deep_work_present(window: Window) -> dict | None:
    days = _days_with(window, lambda s: s.focus_ms >= 90 * MINUTE)
    if len(days) < 2:
        return None
    return {
        "id": "D04",
        "name": "deep_work_present",
        "severity": "positive",
        "evidence": [
            f"{len(days)} days with 90+ min in blocks of {window.params.focus_min_ms // MINUTE}+ min",
            f"focus_hours total {round(window.focus_hours, 1)}",
        ],
        "scope": ", ".join(days),
    }


def d05_break_deficit(window: Window) -> dict | None:
    days = _days_with(window, lambda s: s.longest_run_ms > 120 * MINUTE)
    if len(days) < 3:
        return None
    worst = max(window.days.values(), key=lambda s: s.longest_run_ms)
    return {
        "id": "D05",
        "name": "break_deficit",
        "severity": "medium",
        "evidence": [
            f"{len(days)} days with an unbroken run over 120 min",
            f"longest run {round(worst.longest_run_ms / MINUTE)} min on {worst.day}",
        ],
        "scope": ", ".join(days),
    }


def d06_ai_for_everything(window: Window) -> dict | None:
    share = window.ai_share
    if share <= 0.25:
        return None
    return {
        "id": "D06",
        "name": "ai_for_everything",
        "severity": "info",
        "evidence": [
            f"ai_share {_pct(share)} of active time",
            f"{round(window.active_hours * share, 1)} hours in apps flagged as AI tools",
        ],
        "scope": "window",
    }


def d07_recovery_win(window: Window) -> dict | None:
    baseline = window.baseline
    if not baseline:
        return None
    previous = baseline.get("recovery_gap_min", 0.0)
    if previous >= 30:
        return None
    days = _days_with(window, lambda s: s.longest_gap_ms >= 45 * MINUTE)
    if len(days) < 4:
        return None
    return {
        "id": "D07",
        "name": "recovery_win",
        "severity": "positive",
        "evidence": [
            f"{len(days)} days with a 45+ min gap, against {round(previous)} min before",
            "median longest gap now "
            + str(round(mean([window.days[d].longest_gap_ms for d in days]) / MINUTE)) + " min",
        ],
        "scope": ", ".join(days),
    }


def d08_weekend_inversion(window: Window) -> dict | None:
    weekday, weekend = [], []
    for day, stats in window.days.items():
        weekday_index = __import__("datetime").date.fromisoformat(day).weekday()
        (weekend if weekday_index >= 5 else weekday).append(stats.active_ms / HOUR)
    if not weekday or not weekend:
        return None
    delta = mean(weekend) - mean(weekday)
    if delta < 2.0:
        return None
    return {
        "id": "D08",
        "name": "weekend_inversion",
        "severity": "info",
        "evidence": [
            f"weekend mean {round(mean(weekend), 1)} h vs weekday {round(mean(weekday), 1)} h",
            f"delta {round(delta, 1)} h per day",
        ],
        "scope": "window",
    }


ALL_DETECTORS = (
    d01_late_night_drift,
    d02_fragmentation_spike,
    d03_tool_thrash,
    d04_deep_work_present,
    d05_break_deficit,
    d06_ai_for_everything,
    d07_recovery_win,
    d08_weekend_inversion,
)


def run(window: Window) -> list[dict]:
    """Run every detector; output order is fixed so facts are reproducible."""
    found = []
    for detector in ALL_DETECTORS:
        fact = detector(window)
        if fact:
            found.append(fact)
    order = {"high": 0, "medium": 1, "positive": 2, "info": 3}
    found.sort(key=lambda f: (order.get(f["severity"], 9), f["id"]))
    return found
