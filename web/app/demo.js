// Synthetic demo week, so the zero-install trial has something to look at.
// Deterministic given the calendar date; clearly labelled as demo data in the
// UI so nobody mistakes it for their own capture.

import { makeEvent } from '../engine/index.js';

const APPS = [
  { id: 'demo:code', name: 'Visual Studio Code', category: 'development' },
  { id: 'demo:chat', name: 'Slack', category: 'communication', is_communication: true },
  { id: 'demo:web', name: 'Chrome', category: 'browser' },
  { id: 'demo:ai', name: 'Claude', category: 'ai', is_ai_tool: true },
  { id: 'demo:mail', name: 'Mail', category: 'communication', is_communication: true },
];

const MIN = 60_000;

function at(dayOffset, hour, minute, offsetMin) {
  const now = new Date();
  const local = new Date(now.getTime() + offsetMin * MIN);
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMin * MIN;
  return base + dayOffset * 24 * 60 * MIN + hour * 60 * MIN + minute * MIN;
}

const isoDay = (ms, offsetMin) => new Date(ms + offsetMin * MIN).toISOString().slice(0, 10);

export function buildDemo(offsetMin = 330) {
  const events = [];
  let counter = 0;

  const add = (startMs, minutes, appId, idleMs = 0) => {
    counter += 1;
    events.push(
      makeEvent({
        id: `demo-${counter}`,
        device_id: 'demo',
        kind: 'app_focus',
        ts_start: startMs,
        ts_end: startMs + minutes * MIN,
        local_date: isoDay(startMs, offsetMin),
        app_id: appId,
        idle_ms: idleMs,
        collector: 'demo@1',
      }),
    );
  };

  for (let day = -13; day <= 0; day += 1) {
    const weekday = new Date(Date.now() + day * 86400000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const drifting = day >= -3; // the last few days get later and choppier

    if (weekend) {
      add(at(day, 11, 10, offsetMin), 35, 'demo:web');
      add(at(day, 11, 50, offsetMin), 50, 'demo:web');
      add(at(day, 12, 45, offsetMin), 40, 'demo:code');
      add(at(day, 14, 30, offsetMin), 45, 'demo:web');
      add(at(day, 15, 20, offsetMin), 25, 'demo:mail');
      add(at(day, 20, 40, offsetMin), 45, 'demo:web');
      continue;
    }

    const shift = drifting ? 45 : 0;
    add(at(day, 9, 5 + shift, offsetMin), 95, 'demo:code', 0);
    add(at(day, 10, 42 + shift, offsetMin), 8, 'demo:chat');
    add(at(day, 10, 52 + shift, offsetMin), 80, 'demo:code');
    if (drifting) {
      for (let i = 0; i < 4; i += 1) {
        add(at(day, 12, 15 + i * 4 + shift, offsetMin), 1.5, 'demo:chat');
        add(at(day, 12, 18 + i * 4 + shift, offsetMin), 2.5, 'demo:web');
      }
    }
    add(at(day, 14, 5 + shift, offsetMin), 100, 'demo:code');
    add(at(day, 15, 48 + shift, offsetMin), 12, 'demo:chat');
    add(at(day, 16, 5 + shift, offsetMin), 70, 'demo:code');
    add(at(day, 17, 18 + shift, offsetMin), 18, 'demo:ai');
    add(at(day, 17, 40 + shift, offsetMin), 15, 'demo:mail');
    if (drifting) {
      add(at(day, 22, 30, offsetMin), 45, 'demo:code');
      add(at(day, 23, 18, offsetMin), 30, 'demo:ai');
    }
  }

  return {
    apps: Object.fromEntries(APPS.map((app) => [app.id, app])),
    events,
  };
}
