// Pattern detectors D01–D08, ported from the oracle. D09 and D10 need
// clustering and user-stated goals respectively, and are not implemented.

import { HOUR, MINUTE, mean, pyFloat, pyRound, weekdayIndex } from './util.js';

export const DETECTOR_VERSION = 'd01-d08@1';

const daysWith = (window, predicate) =>
  [...window.days.keys()].sort().filter((day) => predicate(window.days.get(day)));

const pct = (value) => `${pyFloat(pyRound(value * 100, 1))}%`;

export function d01LateNightDrift(window) {
  const baseline = window.baseline;
  if (!baseline) return null;
  const previous = baseline.late_night_share;
  if (previous === null || previous === undefined) return null;
  const shift = window.late_night_share - previous;
  const lateDays = daysWith(window, (s) => s.late_ms >= 30 * MINUTE);
  if (shift < 0.1 || lateDays.length < 3) return null;
  return {
    id: 'D01',
    name: 'late_night_drift',
    severity: shift < 0.2 ? 'medium' : 'high',
    evidence: [
      `late_night_share ${pyFloat(pyRound(previous, 3))} -> ${pyFloat(pyRound(window.late_night_share, 3))}`,
      `${lateDays.length} days with 30+ min after ${window.params.late_start_hour}:00`,
    ],
    scope: `days ${lateDays.join(', ')}`,
  };
}

export function d02FragmentationSpike(window) {
  const baseline = window.baseline;
  if (!baseline || !baseline.switches_per_hour) return null;
  const previous = baseline.switches_per_hour;
  if (window.switches_per_hour <= previous * 1.25) return null;
  const shortPrevious = baseline.short_session_share ?? 0;
  if (window.short_session_share < shortPrevious) return null;
  return {
    id: 'D02',
    name: 'fragmentation_spike',
    severity: window.switches_per_hour < previous * 1.5 ? 'medium' : 'high',
    evidence: [
      `switches_per_hour ${pyFloat(pyRound(previous, 1))} -> ${pyFloat(pyRound(window.switches_per_hour, 1))}`,
      `short_session_share ${pyFloat(pyRound(shortPrevious, 2))} -> ${pyFloat(pyRound(window.short_session_share, 2))}`,
    ],
    scope: 'window',
  };
}

export function d03ToolThrash(window) {
  const blocksByDay = new Map();
  const sessions = window.sessions;
  let i = 0;
  while (i < sessions.length) {
    let j = i;
    const apps = [];
    while (j < sessions.length && sessions[j].start - sessions[i].start <= 10 * MINUTE) {
      apps.push(sessions[j].app_id);
      j += 1;
    }
    const distinct = [];
    for (const appId of apps) {
      if (!distinct.length || distinct[distinct.length - 1] !== appId) distinct.push(appId);
    }
    if (new Set(distinct).size >= 4 && distinct.length >= 6) {
      const day = sessions[i].local_date;
      blocksByDay.set(day, (blocksByDay.get(day) || 0) + 1);
      i = j;
    } else {
      i += 1;
    }
  }
  const hotDays = [...blocksByDay.entries()].filter(([, count]) => count >= 3);
  if (!hotDays.length) return null;
  const worst = hotDays.reduce((best, row) => (row[1] > best[1] ? row : best));
  return {
    id: 'D03',
    name: 'tool_thrash',
    severity: 'medium',
    evidence: [
      `${hotDays.length} days with 3+ ten-minute blocks cycling 4+ apps`,
      `worst day: ${worst[0]}`,
    ],
    scope: hotDays.map(([day]) => day).join(', '),
  };
}

export function d04DeepWorkPresent(window) {
  const days = daysWith(window, (s) => s.focus_ms >= 90 * MINUTE);
  if (days.length < 2) return null;
  return {
    id: 'D04',
    name: 'deep_work_present',
    severity: 'positive',
    evidence: [
      `${days.length} days with 90+ min in blocks of ${window.params.focus_min_ms / MINUTE}+ min`,
      `focus_hours total ${pyFloat(pyRound(window.focus_hours, 1))}`,
    ],
    scope: days.join(', '),
  };
}

export function d05BreakDeficit(window) {
  const days = daysWith(window, (s) => s.longest_run_ms > 120 * MINUTE);
  if (days.length < 3) return null;
  const worst = [...window.days.values()].reduce((best, s) => (s.longest_run_ms > best.longest_run_ms ? s : best));
  return {
    id: 'D05',
    name: 'break_deficit',
    severity: 'medium',
    evidence: [
      `${days.length} days with an unbroken run over 120 min`,
      `longest run ${pyRound(worst.longest_run_ms / MINUTE, 0)} min on ${worst.day}`,
    ],
    scope: days.join(', '),
  };
}

export function d06AiForEverything(window) {
  const share = window.ai_share;
  if (share <= 0.25) return null;
  return {
    id: 'D06',
    name: 'ai_for_everything',
    severity: 'info',
    evidence: [
      `ai_share ${pct(share)} of active time`,
      `${pyFloat(pyRound(window.active_hours * share, 1))} hours in apps flagged as AI tools`,
    ],
    scope: 'window',
  };
}

export function d07RecoveryWin(window) {
  const baseline = window.baseline;
  if (!baseline) return null;
  const previous = baseline.recovery_gap_min ?? 0;
  if (previous >= 30) return null;
  const days = daysWith(window, (s) => s.longest_gap_ms >= 45 * MINUTE);
  if (days.length < 4) return null;
  const average = mean(days.map((day) => window.days.get(day).longest_gap_ms));
  return {
    id: 'D07',
    name: 'recovery_win',
    severity: 'positive',
    evidence: [
      `${days.length} days with a 45+ min gap, against ${pyRound(previous, 0)} min before`,
      `median longest gap now ${pyRound(average / MINUTE, 0)} min`,
    ],
    scope: days.join(', '),
  };
}

export function d08WeekendInversion(window) {
  const weekday = [];
  const weekend = [];
  for (const [day, stats] of window.days) {
    const index = weekdayIndex(day);
    (index === 0 || index === 6 ? weekend : weekday).push(stats.active_ms / HOUR);
  }
  if (!weekday.length || !weekend.length) return null;
  const delta = mean(weekend) - mean(weekday);
  if (delta < 2) return null;
  return {
    id: 'D08',
    name: 'weekend_inversion',
    severity: 'info',
    evidence: [
      `weekend mean ${pyFloat(pyRound(mean(weekend), 1))} h vs weekday ${pyFloat(pyRound(mean(weekday), 1))} h`,
      `delta ${pyFloat(pyRound(delta, 1))} h per day`,
    ],
    scope: 'window',
  };
}

export const ALL_DETECTORS = [
  d01LateNightDrift,
  d02FragmentationSpike,
  d03ToolThrash,
  d04DeepWorkPresent,
  d05BreakDeficit,
  d06AiForEverything,
  d07RecoveryWin,
  d08WeekendInversion,
];

const RANK = { high: 0, medium: 1, positive: 2, info: 3 };

export function run(window) {
  const found = [];
  for (const detector of ALL_DETECTORS) {
    const fact = detector(window);
    if (fact) found.push(fact);
  }
  found.sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || (a.id < b.id ? -1 : 1));
  return found;
}
