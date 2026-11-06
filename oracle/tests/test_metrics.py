"""Metric definitions: hand-computed expectations, not snapshots."""

from __future__ import annotations

from conftest import dt, ev

from wl_oracle.metrics import compute
from wl_oracle.model import HOUR, MINUTE


def test_active_time_and_rollups(params, apps):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 60, idx=1),
        ev("code", dt("2026-10-26", 10, 10), 30, idx=2),  # 10 min gap -> new session
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert window.active_ms == 90 * MINUTE
    assert window.active_hours == 1.5
    assert window.days["2026-10-26"].sessions == 2


def test_switches_per_active_hour(params, apps):
    # two hours of activity, four app changes -> 2.0 switches/hour
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("web", dt("2026-10-26", 9, 30, 10), 30, idx=2),
        ev("code", dt("2026-10-26", 10, 0, 20), 30, idx=3),
        ev("web", dt("2026-10-26", 10, 30, 30), 30, idx=4),
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert window.switches == 3
    assert window.active_hours == 2.0
    assert window.switches_per_hour == 1.5


def test_late_night_share(params, apps):
    events = [
        ev("code", dt("2026-10-26", 10, 0), 60, idx=1),  # daytime
        ev("code", dt("2026-10-26", 22, 30), 60, idx=2),  # 30 min in hour 22, 30 in 23
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert window.late_night_share == 0.5


def test_short_session_share(params, apps):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("chat", dt("2026-10-26", 10, 0), 1, idx=2),
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert window.short_session_share == 0.5


def test_focus_block_needs_twenty_minutes(params, apps):
    short = [ev("code", dt("2026-10-26", 9, 0), 10, idx=1)]
    assert compute(short, apps, params, "2026-10-26", "2026-10-26").focus_blocks == []
    long = [ev("code", dt("2026-10-26", 9, 0), 25, idx=1)]
    assert len(compute(long, apps, params, "2026-10-26", "2026-10-26").focus_blocks) == 1


def test_communication_app_breaks_a_focus_block(params, apps):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 25, idx=1),
        ev("chat", dt("2026-10-26", 9, 25, 20), 2, idx=2),
        ev("code", dt("2026-10-26", 9, 28), 25, idx=3),
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert len(window.focus_blocks) == 2


def test_break_debt_finds_the_longest_unbroken_run(params, apps):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 60, idx=1),
        ev("code", dt("2026-10-26", 10, 1), 60, idx=2),  # 1 min gap: still unbroken
        ev("code", dt("2026-10-26", 12, 0), 30, idx=3),  # 59 min gap: a real break
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert window.days["2026-10-26"].longest_run_ms == 120 * MINUTE


def test_coverage_measures_missing_capture_not_idleness(params, apps):
    # active 2 h inside a 4 h span -> 50 % captured
    events = [
        ev("code", dt("2026-10-26", 9, 0), 60, idx=1),
        ev("code", dt("2026-10-26", 12, 0), 60, idx=2),
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert round(window.days["2026-10-26"].coverage, 2) == 0.5


def test_ai_share(params, apps):
    events = [
        ev("ai", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("code", dt("2026-10-26", 10, 0), 90, idx=2),
    ]
    window = compute(events, apps, params, "2026-10-26", "2026-10-26")
    assert round(window.ai_share, 2) == 0.25


def test_facts_are_deterministic(params, apps):
    from wl_oracle.facts import build, dumps

    events = [ev("code", dt("2026-10-26", 9, 0), 90, idx=1)]
    first = dumps(build(events, apps, params, "2026-10-26", "2026-10-26", baseline_weeks=0))
    second = dumps(build(events, apps, params, "2026-10-26", "2026-10-26", baseline_weeks=0))
    assert first == second
    assert HOUR == 3_600_000
