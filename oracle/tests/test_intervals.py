"""Interval algebra: the arithmetic everything else rests on."""

from __future__ import annotations

from conftest import dt, ev

from wl_oracle.intervals import credited, measure, split_by_local_day, union


def test_idle_beyond_threshold_is_dropped(params):
    # 45 min event, 40 min idle, threshold 60 s -> credited 45 - (40 - 1) = 6 min
    event = ev("code", dt("2026-10-26", 10, 0), 45, idle_ms=40 * 60_000)
    start, end = credited(event, params)
    assert end - start == 6 * 60_000


def test_idle_below_threshold_changes_nothing(params):
    event = ev("code", dt("2026-10-26", 10, 0), 30, idle_ms=45_000)
    assert credited(event, params) == (event.ts_start, event.ts_end)


def test_zero_length_event_is_not_credited(params):
    event = ev("code", dt("2026-10-26", 10, 0), 0)
    assert credited(event, params) is None


def test_barrier_is_not_credited(params):
    event = ev("code", dt("2026-10-26", 10, 0), 10, kind="lock")
    assert credited(event, params) is None


def test_union_merges_overlap_and_touching():
    merged = union([(0, 10), (10, 20), (25, 30), (5, 12)])
    assert merged == [(0, 20), (25, 30)]
    assert measure(merged) == 25


def test_measure_of_overlapping_intervals_counts_once():
    assert measure([(0, 60_000), (30_000, 90_000)]) == 90_000


def test_midnight_split_keeps_total(params):
    # 23:40 -> 00:30 local, so 20 min on the first day and 30 on the second
    event = ev("code", dt("2026-10-28", 23, 40), 50)
    buckets = split_by_local_day((event.ts_start, event.ts_end), params)
    assert buckets == {"2026-10-28": 20 * 60_000, "2026-10-29": 30 * 60_000}
    assert sum(buckets.values()) == event.duration_ms
