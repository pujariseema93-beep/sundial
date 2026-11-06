"""Sessionisation rules."""

from __future__ import annotations

from conftest import dt, ev

from wl_oracle.sessions import build_sessions, count_switches


def test_same_app_short_gap_merges(params):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("code", dt("2026-10-26", 9, 30, 30), 20, idx=2),  # 30 s gap
    ]
    sessions = build_sessions(events, params)
    assert len(sessions) == 1
    assert sessions[0].active_ms == 50 * 60_000


def test_gap_beyond_merge_gap_splits(params):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("code", dt("2026-10-26", 9, 40), 20, idx=2),  # 10 min gap
    ]
    assert len(build_sessions(events, params)) == 2


def test_different_app_splits_and_counts_as_a_switch(params):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("chat", dt("2026-10-26", 9, 30, 20), 5, idx=2),
    ]
    sessions = build_sessions(events, params)
    assert [s.app_id for s in sessions] == ["code", "chat"]
    assert count_switches(sessions, params) == 1


def test_lock_in_the_gap_splits_the_session(params):
    events = [
        ev("code", dt("2026-10-26", 14, 0), 20, idx=1),
        ev("code", dt("2026-10-26", 14, 21), 2, kind="lock", idx=2),
        ev("code", dt("2026-10-26", 14, 25), 20, idx=3),
    ]
    assert len(build_sessions(events, params)) == 2


def test_session_spanning_midnight_stays_one_session(params):
    events = [ev("code", dt("2026-10-28", 23, 40), 50, idx=1)]
    sessions = build_sessions(events, params)
    assert len(sessions) == 1
    assert sessions[0].local_date == "2026-10-28"
    assert sessions[0].active_ms == 50 * 60_000


def test_return_after_a_long_gap_is_not_a_switch(params):
    events = [
        ev("code", dt("2026-10-26", 9, 0), 30, idx=1),
        ev("chat", dt("2026-10-26", 12, 0), 5, idx=2),  # 2.5 h later
    ]
    sessions = build_sessions(events, params)
    assert count_switches(sessions, params) == 0
