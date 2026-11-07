// Assembly of the wl.facts.v3 document — the only thing the AI layer sees.
// Deterministic: same events plus same parameters produce identical output.

import { run as runDetectors, DETECTOR_VERSION } from './detectors.js';
import { compute } from './metrics.js';
import { HOUR, MINUTE, addDays, median, pyRound } from './util.js';
import { windowEvents } from './model.js';

export const ALGO_VERSION = 'wl-oracle-0.1.0';
export const SCHEMA = 'wl.facts.v3';
export const TOP_APPS = 12;

function baselineFrom(events, apps, params, start, end, weeks = 4) {
  if (weeks <= 0) return null;
  const length = params.daysBetween(start, end).length;
  const rows = [];
  for (let index = 1; index <= weeks; index += 1) {
    const prevEnd = addDays(start, -((index - 1) * length + 1));
    const prevStart = addDays(prevEnd, -(length - 1));
    const window = compute(events, apps, params, prevStart, prevEnd);
    if (window.active_ms === 0) continue;
    rows.push(window);
  }
  if (!rows.length) return null;
  return {
    active_ms: median(rows.map((w) => w.active_ms)),
    late_night_share: median(rows.map((w) => w.late_night_share)),
    switches_per_hour: median(rows.map((w) => w.switches_per_hour)),
    short_session_share: median(rows.map((w) => w.short_session_share)),
    recovery_gap_min: median(
      rows.map((w) => Math.max(...[...w.days.values()].map((d) => d.longest_gap_ms), 0) / MINUTE),
    ),
    weeks_used: rows.length,
  };
}

export function build(events, apps, params, start, end, options = {}) {
  const { fidelity = 'L4', baselineWeeks = 4 } = options;
  const baseline = baselineFrom(events, apps, params, start, end, baselineWeeks);
  const window = compute(events, apps, params, start, end, { fidelity, baseline });

  const evs = windowEvents(events, start, end);
  const devices = [...new Set(evs.map((e) => e.device_id))].sort();
  const dayCount = window.days.size;

  const byHour = [];
  for (let hour = 0; hour < 24; hour += 1) {
    byHour.push(pyRound((window.by_hour_ms.get(hour) || 0) / HOUR / Math.max(dayCount, 1), 1));
  }
  let peakHour = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const ms = window.by_hour_ms.get(hour) || 0;
    const best = window.by_hour_ms.get(peakHour) || 0;
    if (ms > best) peakHour = hour;
  }

  const totals = {
    active_h: pyRound(window.active_hours, 1),
    delta_pct: null,
    devices: devices.length,
  };
  if (baseline && baseline.active_ms) {
    totals.delta_pct = pyRound(((window.active_ms - baseline.active_ms) / baseline.active_ms) * 100, 1);
  }

  const appsRows = window.appTotals().slice(0, TOP_APPS).map((row) => ({
    id: row.id,
    name: row.name,
    h: pyRound(row.active_ms / HOUR, 1),
    share: pyRound(row.share, 2),
    sessions: row.sessions,
    median_session_min: row.median_session_min,
  }));

  return {
    schema: SCHEMA,
    window: { start, end, tz: params.tz },
    coverage: {
      days: dayCount,
      complete_days: window.complete_days,
      fidelity,
      confidence: pyRound(window.coverage, 2),
    },
    totals,
    shape: {
      by_hour: byHour,
      peak_hour: peakHour,
      late_night_share: pyRound(window.late_night_share, 2),
      switches_per_hour: pyRound(window.switches_per_hour, 1),
      short_session_share: pyRound(window.short_session_share, 2),
      focus_hours: pyRound(window.focus_hours, 1),
      ai_share: pyRound(window.ai_share, 2),
    },
    days: [...window.days.keys()].sort().map((day) => dayAsFactOf(window, day)),
    apps: appsRows,
    clusters: [],
    patterns: runDetectors(window),
    goals: [],
    notes: {},
    meta: {
      algo_version: ALGO_VERSION,
      params_hash: params.hash(),
      detectors: DETECTOR_VERSION,
      baseline_weeks: baseline ? baseline.weeks_used : 0,
    },
  };
}

function dayAsFactOf(window, day) {
  const stats = window.days.get(day);
  return {
    day: stats.day,
    active_h: pyRound(stats.active_ms / HOUR, 2),
    switches: stats.switches,
    sessions: stats.sessions,
    late_h: pyRound(stats.late_ms / HOUR, 2),
    focus_h: pyRound(stats.focus_ms / HOUR, 2),
    longest_run_min: pyRound(stats.longest_run_ms / MINUTE, 1),
    longest_gap_min: pyRound(stats.longest_gap_ms / MINUTE, 1),
    coverage: pyRound(stats.coverage, 2),
  };
}

export function dumps(facts) {
  return `${JSON.stringify(facts, null, 2)}\n`;
}
