// The metrics engine, ported from oracle/wl_oracle/metrics.py.
//
// Every number the product shows comes from here. Keep it in lockstep with
// the oracle: the golden facts in /golden are the contract between them.

import { bucketDayHour, clip, credited } from './intervals.js';
import { HOUR, MINUTE, median, pyRound } from './util.js';
import { windowEvents } from './model.js';
import {
  appActiveMs,
  buildSessions,
  countSwitches,
  isCommunication,
  medianSessionMs,
  sessionsByApp,
} from './sessions.js';

export const LATE_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5]);

function newDay(day) {
  return {
    day,
    active_ms: 0,
    switches: 0,
    sessions: 0,
    late_ms: 0,
    focus_ms: 0,
    longest_run_ms: 0,
    longest_gap_ms: 0,
    first_ts: null,
    last_ts: null,
    by_app: new Map(),
    by_hour: new Map(),
    coverage: 0,
  };
}

export function dayAsFact(stats) {
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

function focusBlocks(sessions, params, apps) {
  const blocks = [];
  let run = [];

  const flush = () => {
    if (!run.length) return;
    const active = run.reduce((total, s) => total + s.active_ms, 0);
    const distinct = new Set(run.map((s) => s.app_id));
    if (active >= params.focus_min_ms && distinct.size <= params.focus_max_apps) {
      blocks.push({
        start: run[0].start,
        end: run[run.length - 1].end,
        apps: [...distinct].sort(),
        active_ms: active,
      });
    }
    run = [];
  };

  for (const session of sessions) {
    if (isCommunication(session.app_id, apps)) {
      flush();
      continue;
    }
    if (!run.length) {
      run = [session];
      continue;
    }
    const gap = session.start - run[run.length - 1].end;
    const distinct = new Set([...run.map((s) => s.app_id), session.app_id]);
    if (gap > params.focus_gap_ms || distinct.size > params.focus_max_apps) {
      flush();
      run = [session];
    } else {
      run.push(session);
    }
  }
  flush();
  return blocks;
}

export function compute(events, apps, params, start, end, options = {}) {
  const { fidelity = 'L4', baseline = null } = options;
  const evs = windowEvents(events, start, end);
  const dayNames = params.daysBetween(start, end);
  const days = new Map(dayNames.map((day) => [day, newDay(day)]));

  const dayHour = new Map();
  for (const event of evs) {
    const iv = credited(event, params);
    if (!iv) continue;
    for (const [key, ms] of bucketDayHour(iv, params)) {
      dayHour.set(key, (dayHour.get(key) || 0) + ms);
      const [day, hourText] = key.split('|');
      const hour = Number(hourText);
      const stats = days.get(day);
      if (!stats) continue;
      stats.by_hour.set(hour, (stats.by_hour.get(hour) || 0) + ms);
      const appId = event.app_id || '';
      stats.by_app.set(appId, (stats.by_app.get(appId) || 0) + ms);
      if (LATE_HOURS.has(hour)) stats.late_ms += ms;
    }
  }

  const sessions = buildSessions(evs, params);
  for (const session of sessions) {
    const stats = days.get(session.local_date);
    if (!stats) continue;
    stats.sessions += 1;
    if (stats.first_ts === null) stats.first_ts = session.start;
    stats.last_ts = Math.max(stats.last_ts || 0, session.end);
  }

  for (let i = 1; i < sessions.length; i += 1) {
    const previous = sessions[i - 1];
    const following = sessions[i];
    if (following.app_id !== previous.app_id && following.start - previous.end <= params.merge_gap_ms) {
      const stats = days.get(params.toLocal(following.start).date);
      if (stats) stats.switches += 1;
    }
  }

  for (const [key, ms] of dayHour) {
    const stats = days.get(key.split('|')[0]);
    if (stats) stats.active_ms += ms;
  }

  const blocks = focusBlocks(sessions, params, apps);
  for (const block of blocks) {
    const stats = days.get(params.toLocal(block.start).date);
    if (stats) stats.focus_ms += block.active_ms;
  }

  for (const stats of days.values()) {
    const todays = sessions.filter((s) => s.local_date === stats.day);
    stats.longest_run_ms = longestRun(todays, params);
    stats.longest_gap_ms = longestGap(todays, params, stats.day);
    stats.coverage = dayCoverage(stats);
  }

  const byHourMs = new Map();
  for (const [key, ms] of dayHour) {
    const hour = Number(key.split('|')[1]);
    byHourMs.set(hour, (byHourMs.get(hour) || 0) + ms);
  }

  let activeMs = 0;
  for (const stats of days.values()) activeMs += stats.active_ms;
  const observed = [...days.values()].filter((s) => s.active_ms > 0).map((s) => s.coverage);

  return {
    start,
    end,
    params,
    apps,
    fidelity,
    days,
    sessions,
    focus_blocks: blocks,
    by_hour_ms: byHourMs,
    active_ms: activeMs,
    switches: countSwitches(sessions, params),
    coverage: observed.length ? median(observed) : 0,
    baseline,
    get active_hours() {
      return this.active_ms / HOUR;
    },
    get switches_per_hour() {
      return this.active_ms ? this.switches / (this.active_ms / HOUR) : 0;
    },
    get late_night_share() {
      let late = 0;
      for (const stats of this.days.values()) late += stats.late_ms;
      return this.active_ms ? late / this.active_ms : 0;
    },
    get short_session_share() {
      if (!this.sessions.length) return 0;
      const short = this.sessions.filter((s) => s.active_ms < this.params.short_ms);
      return short.length / this.sessions.length;
    },
    get ai_share() {
      let ai = 0;
      for (const [appId, ms] of appActiveMs(this.sessions)) {
        const app = this.apps[appId];
        if (app && app.is_ai_tool) ai += ms;
      }
      return this.active_ms ? ai / this.active_ms : 0;
    },
    get focus_hours() {
      return this.focus_blocks.reduce((total, b) => total + b.active_ms, 0) / HOUR;
    },
    get complete_days() {
      return [...this.days.values()].filter((s) => s.coverage >= 0.7).length;
    },
    appTotals() {
      const totals = appActiveMs(this.sessions);
      const grouped = sessionsByApp(this.sessions);
      const rows = [...totals.entries()].map(([appId, ms]) => {
        const app = this.apps[appId];
        const appSessions = grouped.get(appId) || [];
        return {
          id: appId,
          name: app ? app.name : appId,
          active_ms: ms,
          share: this.active_ms ? ms / this.active_ms : 0,
          sessions: appSessions.length,
          median_session_min: pyRound(medianSessionMs(appSessions) / MINUTE, 1),
        };
      });
      rows.sort((a, b) => b.active_ms - a.active_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return rows;
    },
  };
}

/** Share of the day's observed span that was actually captured (ADR 0004). */
export function dayCoverage(stats) {
  if (stats.first_ts === null || stats.last_ts === null) return 0;
  const span = stats.last_ts - stats.first_ts;
  if (span < MINUTE) return stats.active_ms > 0 ? 1 : 0;
  return Math.min(1, stats.active_ms / span);
}

function longestRun(sessions, params) {
  let longest = 0;
  let run = 0;
  let previousEnd = null;
  for (const session of sessions) {
    if (previousEnd === null) {
      run = session.active_ms;
    } else {
      const gap = session.start - previousEnd;
      if (gap >= params.break_min_ms) {
        longest = Math.max(longest, run);
        run = session.active_ms;
      } else {
        run += session.active_ms;
      }
    }
    previousEnd = session.end;
  }
  return Math.max(longest, run);
}

function longestGap(sessions, params, day) {
  const [lo] = params.dayBounds(day);
  const wakeLo = lo + params.wake_start_hour * HOUR;
  const wakeHi = lo + params.wake_end_hour * HOUR;
  if (!sessions.length) return wakeHi - wakeLo;
  const points = [];
  for (const session of sessions) {
    const clipped = clip([session.start, session.end], wakeLo, wakeHi);
    if (clipped) points.push(clipped);
  }
  if (!points.length) return wakeHi - wakeLo;
  points.sort((a, b) => a[0] - b[0]);
  let longest = Math.max(0, points[0][0] - wakeLo);
  for (let i = 1; i < points.length; i += 1) {
    longest = Math.max(longest, points[i][0] - points[i - 1][1]);
  }
  return Math.max(longest, wakeHi - points[points.length - 1][1]);
}
