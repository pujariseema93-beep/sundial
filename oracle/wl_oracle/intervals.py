"""Interval algebra.

The only subtle rule in the whole metric engine lives here: an event is
credited up to the idle threshold, and the remainder of the idle period is
discarded (you were probably reading; after that you were probably gone).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from .model import Event, Params

Interval = tuple[int, int]


def credited(event: Event, params: Params) -> Interval | None:
    """credited(e) = [s, min(e, s + (e - s) - max(0, i - tau)))"""
    if not event.is_activity:
        return None
    start, end = event.ts_start, event.ts_end
    if end <= start:
        return None
    lost = max(0, event.idle_ms - params.idle_threshold_ms)
    credited_end = max(start, end - lost)
    if credited_end <= start:
        return None
    return (start, credited_end)


def union(intervals: Iterable[Interval]) -> list[Interval]:
    """Merge overlapping and touching intervals; deterministic output."""
    ordered = sorted(intervals)
    if not ordered:
        return []
    merged: list[Interval] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            if end > last_end:
                merged[-1] = (last_start, end)
        else:
            merged.append((start, end))
    return merged


def measure(intervals: Sequence[Interval]) -> int:
    """Total milliseconds covered by the union of the intervals."""
    return sum(end - start for start, end in union(intervals))


def clip(interval: Interval, lo: int, hi: int) -> Interval | None:
    start, end = interval
    start, end = max(start, lo), min(end, hi)
    if end <= start:
        return None
    return (start, end)


def clip_all(intervals: Iterable[Interval], lo: int, hi: int) -> list[Interval]:
    out = [clip(iv, lo, hi) for iv in intervals]
    return [iv for iv in out if iv is not None]


def intersect(a: Interval, b: Interval) -> Interval | None:
    start, end = max(a[0], b[0]), min(a[1], b[1])
    return (start, end) if end > start else None


def overlaps_any(interval: Interval, others: Sequence[Interval]) -> bool:
    return any(intersect(interval, other) is not None for other in others)


def split_by_hour(interval: Interval, params: Params) -> dict[int, int]:
    """Milliseconds of `interval` falling into each local hour of the day."""
    buckets: dict[int, int] = {}
    start, end = interval
    cursor = start
    while cursor < end:
        local = params.to_local(cursor)
        hour = local.hour
        next_hour = (local.replace(minute=0, second=0, microsecond=0) + _one_hour())
        boundary = min(end, params.to_utc_ms(next_hour))
        buckets[hour] = buckets.get(hour, 0) + (boundary - cursor)
        cursor = boundary
    return buckets


def _one_hour():
    from datetime import timedelta

    return timedelta(hours=1)


def split_by_local_day(interval: Interval, params: Params) -> dict[str, int]:
    """Milliseconds of `interval` falling into each local date.

    A session that spans midnight stays one session; only rollups split.
    """
    buckets: dict[str, int] = {}
    start, end = interval
    cursor = start
    while cursor < end:
        local = params.to_local(cursor)
        day = local.date().isoformat()
        _, day_end = params.day_bounds(day)
        boundary = min(end, day_end)
        if boundary <= cursor:  # defensive: never loop forever
            break
        buckets[day] = buckets.get(day, 0) + (boundary - cursor)
        cursor = boundary
    return buckets
