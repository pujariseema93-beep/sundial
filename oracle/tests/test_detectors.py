"""Detectors: conditions, thresholds, and the refusal to fire on thin evidence."""

from __future__ import annotations

from conftest import dt, ev

from wl_oracle import detectors
from wl_oracle.metrics import compute


def _week(window_events, params, apps, baseline=None):
    return compute(window_events, apps, params, "2026-10-26", "2026-11-01", baseline=baseline)


def test_deep_work_needs_two_days(params, apps):
    one_day = [ev("code", dt("2026-10-26", 9, 0), 120, idx=1)]
    assert detectors.d04_deep_work_present(_week(one_day, params, apps)) is None

    two_days = one_day + [ev("code", dt("2026-10-27", 9, 0), 120, idx=2)]
    fact = detectors.d04_deep_work_present(_week(two_days, params, apps))
    assert fact and fact["severity"] == "positive"


def test_ai_for_everything_fires_above_a_quarter(params, apps):
    events = [
        ev("ai", dt("2026-10-26", 9, 0), 60, idx=1),
        ev("code", dt("2026-10-26", 11, 0), 60, idx=2),
    ]
    window = _week(events, params, apps)
    assert round(window.ai_share, 2) == 0.5
    assert detectors.d06_ai_for_everything(window)["id"] == "D06"


def test_late_night_drift_needs_a_baseline(params, apps):
    late = [ev("code", dt(day, 22, 30), 60, idx=i) for i, day in enumerate(
        ["2026-10-26", "2026-10-27", "2026-10-28"])]
    assert detectors.d01_late_night_drift(_week(late, params, apps)) is None

    with_baseline = _week(late, params, apps, baseline={"late_night_share": 0.0})
    fact = detectors.d01_late_night_drift(with_baseline)
    assert fact is not None and fact["id"] == "D01"
    assert any("late_night_share" in line for line in fact["evidence"])


def test_late_night_drift_needs_three_days(params, apps):
    one_night = [ev("code", dt("2026-10-26", 22, 30), 60, idx=1)]
    window = _week(one_night, params, apps, baseline={"late_night_share": 0.0})
    assert detectors.d01_late_night_drift(window) is None


def test_fragmentation_spike_needs_a_rise_not_just_a_level(params, apps):
    events = [ev("code", dt("2026-10-26", 9, 0), 60, idx=1)]
    flat = _week(events, params, apps, baseline={"switches_per_hour": 9.0, "short_session_share": 0.5})
    assert detectors.d02_fragmentation_spike(flat) is None


def test_weekend_inversion(params, apps):
    # 2026-10-31 and 2026-11-01 are a Saturday and a Sunday
    events = [
        ev("code", dt("2026-10-26", 9, 0), 60, idx=1),
        ev("web", dt("2026-10-31", 10, 0), 240, idx=2),
        ev("web", dt("2026-11-01", 10, 0), 240, idx=3),
    ]
    fact = detectors.d08_weekend_inversion(_week(events, params, apps))
    assert fact is not None and fact["id"] == "D08"


def test_detector_order_is_fixed(params, apps):
    events = [
        ev("ai", dt("2026-10-26", 9, 0), 120, idx=1),
        ev("code", dt("2026-10-27", 9, 0), 120, idx=2),
    ]
    window = _week(events, params, apps, baseline={"late_night_share": 0.0})
    first = detectors.run(window)
    second = detectors.run(window)
    assert [f["id"] for f in first] == [f["id"] for f in second]

    rank = {"high": 0, "medium": 1, "positive": 2, "info": 3}
    ranks = [rank[f["severity"]] for f in first]
    assert ranks == sorted(ranks)
