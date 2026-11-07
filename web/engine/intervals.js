// Interval algebra: the credited interval, unions, and the two splitters.

import { HOUR, MINUTE, isoDate, isoHour } from './util.js';

/** credited(e) = [s, min(e, s + (e - s) - max(0, i - tau))) */
export function credited(event, params) {
  if (!event.is_activity) return null;
  const start = event.ts_start;
  const end = event.ts_end;
  if (end <= start) return null;
  const lost = Math.max(0, event.idle_ms - params.idle_threshold_ms);
  const creditedEnd = Math.max(start, end - lost);
  if (creditedEnd <= start) return null;
  return [start, creditedEnd];
}

export function union(intervals) {
  const ordered = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!ordered.length) return [];
  const merged = [ordered[0]];
  for (const [start, end] of ordered.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) {
      if (end > last[1]) merged[merged.length - 1] = [last[0], end];
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function measure(intervals) {
  return union(intervals).reduce((total, [start, end]) => total + (end - start), 0);
}

export function clip(interval, lo, hi) {
  const start = Math.max(interval[0], lo);
  const end = Math.min(interval[1], hi);
  return end > start ? [start, end] : null;
}

export function intersects(a, b) {
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  return end > start ? [start, end] : null;
}

export function overlapsAny(interval, others) {
  return others.some((other) => intersects(interval, other) !== null);
}

/** Milliseconds of an interval in each (local date, local hour) bucket. */
export function bucketDayHour(interval, params) {
  const out = new Map();
  const offset = params.utc_offset_min * MINUTE;
  let cursor = interval[0];
  const end = interval[1];
  while (cursor < end) {
    const localMs = cursor + offset;
    const hourStartLocal = Math.floor(localMs / HOUR) * HOUR;
    const boundary = Math.min(end, hourStartLocal + HOUR - offset);
    if (boundary <= cursor) break;
    const key = `${isoDate(cursor, params.utc_offset_min)}|${isoHour(cursor, params.utc_offset_min)}`;
    out.set(key, (out.get(key) || 0) + (boundary - cursor));
    cursor = boundary;
  }
  return out;
}
