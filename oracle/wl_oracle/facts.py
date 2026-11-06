"""Assembly of the wl.facts.v3 document — the only thing the AI layer sees.

The document is prose-free by design: numbers, identifiers and short
evidence strings. It is deterministic: same events plus same parameters
produce byte-identical JSON, which is what makes a narrative reproducible
and a golden test possible.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

from . import detectors
from .metrics import compute, trailing_median
from .model import HOUR, MINUTE, App, Event, Params, window_events

ALGO_VERSION = "wl-oracle-0.1.0"
SCHEMA = "wl.facts.v3"
TOP_APPS = 12


def baseline_from(events: Sequence[Event], apps: dict[str, App], params: Params,
                  start: str, end: str, weeks: int = 4) -> dict | None:
    """Median metrics over the N equal-length windows preceding `start`."""
    from datetime import date, timedelta

    if weeks <= 0:
        return None
    length = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    rows = []
    for index in range(1, weeks + 1):
        prev_end = date.fromisoformat(start) - timedelta(days=(index - 1) * length + 1)
        prev_start = prev_end - timedelta(days=length - 1)
        window = compute(events, apps, params, prev_start.isoformat(), prev_end.isoformat())
        if window.active_ms == 0:
            continue
        rows.append(window)
    if not rows:
        return None
    return {
        "active_ms": trailing_median([w.active_ms for w in rows]),
        "late_night_share": trailing_median([w.late_night_share for w in rows]),
        "switches_per_hour": trailing_median([w.switches_per_hour for w in rows]),
        "short_session_share": trailing_median([w.short_session_share for w in rows]),
        "recovery_gap_min": trailing_median(
            [max((d.longest_gap_ms for d in w.days.values()), default=0) / MINUTE for w in rows]
        ),
        "weeks_used": len(rows),
    }


def build(events: Sequence[Event], apps: dict[str, App], params: Params,
          start: str, end: str, fidelity: str = "L4", baseline_weeks: int = 4) -> dict:
    baseline = baseline_from(events, apps, params, start, end, baseline_weeks)
    window = compute(events, apps, params, start, end, fidelity=fidelity, baseline=baseline)

    evs = window_events(events, start, end)
    devices = sorted({event.device_id for event in evs})
    day_count = len(window.days)

    by_hour = [round(window.by_hour_ms.get(hour, 0) / HOUR / max(day_count, 1), 1) for hour in range(24)]
    peak_hour = max(range(24), key=lambda hour: (window.by_hour_ms.get(hour, 0), -hour))

    totals = {
        "active_h": round(window.active_hours, 1),
        "delta_pct": None,
        "devices": len(devices),
    }
    if baseline and baseline["active_ms"]:
        totals["delta_pct"] = round(
            (window.active_ms - baseline["active_ms"]) / baseline["active_ms"] * 100, 1
        )

    apps_rows = [
        {
            "id": row["id"],
            "name": row["name"],
            "h": round(row["active_ms"] / HOUR, 1),
            "share": round(row["share"], 2),
            "sessions": row["sessions"],
            "median_session_min": row["median_session_min"],
        }
        for row in window.app_totals()[:TOP_APPS]
    ]

    facts = {
        "schema": SCHEMA,
        "window": {"start": start, "end": end, "tz": params.tz},
        "coverage": {
            "days": day_count,
            "complete_days": window.complete_days,
            "fidelity": fidelity,
            "confidence": round(window.coverage, 2),
        },
        "totals": totals,
        "shape": {
            "by_hour": by_hour,
            "peak_hour": peak_hour,
            "late_night_share": round(window.late_night_share, 2),
            "switches_per_hour": round(window.switches_per_hour, 1),
            "short_session_share": round(window.short_session_share, 2),
            "focus_hours": round(window.focus_hours, 1),
            "ai_share": round(window.ai_share, 2),
        },
        "days": [window.days[day].as_fact() for day in sorted(window.days)],
        "apps": apps_rows,
        "clusters": [],
        "patterns": detectors.run(window),
        "goals": [],
        "notes": {},
        "meta": {
            "algo_version": ALGO_VERSION,
            "params_hash": params.hash(),
            "detectors": detectors.DETECTOR_VERSION,
            "baseline_weeks": (baseline or {}).get("weeks_used", 0),
        },
    }
    return facts


def dumps(facts: dict) -> str:
    return json.dumps(facts, indent=2, sort_keys=False, ensure_ascii=False) + "\n"
