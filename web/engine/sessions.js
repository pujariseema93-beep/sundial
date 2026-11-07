// Sessionisation: maximal runs of activity on one app.

import { credited, measure, overlapsAny, union } from './intervals.js';
import { median } from './util.js';

export function buildSessions(events, params) {
  const activity = [];
  const barriers = [];
  for (const event of events) {
    if (event.is_barrier) {
      barriers.push([event.ts_start, event.ts_end]);
      continue;
    }
    const iv = credited(event, params);
    if (iv) activity.push([iv, event.app_id || '']);
  }
  activity.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
  const barrierUnion = union(barriers);

  const sessions = [];
  let current = [];
  let currentApp = null;
  let currentStart = 0;
  let currentEnd = 0;

  const close = () => {
    if (current.length && currentApp !== null) {
      sessions.push({
        app_id: currentApp,
        start: currentStart,
        end: currentEnd,
        active_ms: measure(current),
        local_date: params.toLocal(currentStart).date,
        index: sessions.length,
      });
    }
    current = [];
    currentApp = null;
  };

  for (const [iv, appId] of activity) {
    const [start, end] = iv;
    if (currentApp === null) {
      current = [iv];
      currentApp = appId;
      currentStart = start;
      currentEnd = end;
      continue;
    }
    const gap = start - currentEnd;
    const broken =
      appId !== currentApp ||
      gap > params.merge_gap_ms ||
      gap > params.idle_split_ms ||
      (gap > 0 && overlapsAny([currentEnd, start], barrierUnion));
    if (broken) {
      close();
      current = [iv];
      currentApp = appId;
      currentStart = start;
      currentEnd = end;
    } else {
      current.push(iv);
      currentEnd = Math.max(currentEnd, end);
    }
  }
  close();
  return sessions;
}

export function countSwitches(sessions, params) {
  let switches = 0;
  for (let i = 1; i < sessions.length; i += 1) {
    const previous = sessions[i - 1];
    const following = sessions[i];
    if (following.app_id !== previous.app_id && following.start - previous.end <= params.merge_gap_ms) {
      switches += 1;
    }
  }
  return switches;
}

export function medianSessionMs(sessions) {
  if (!sessions.length) return 0;
  return Math.trunc(median(sessions.map((s) => s.active_ms)));
}

export function sessionsByApp(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    if (!grouped.has(session.app_id)) grouped.set(session.app_id, []);
    grouped.get(session.app_id).push(session);
  }
  return grouped;
}

export function appActiveMs(sessions) {
  const totals = new Map();
  for (const session of sessions) {
    totals.set(session.app_id, (totals.get(session.app_id) || 0) + session.active_ms);
  }
  return totals;
}

export function isCommunication(appId, apps) {
  const app = apps[appId];
  return Boolean(app && app.is_communication);
}
