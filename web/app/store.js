// Local persistence. One JSON blob in localStorage: no server, no sync,
// no account. Everything the app knows lives under a single key so that
// "delete everything" is one call and export is one string.

import { makeEvent, loadEvents } from '../engine/index.js';
import { buildDemo } from './demo.js';

const KEY = 'sundial.v1.state';

// localStorage is unavailable on file:// in some browsers and in private
// modes. Falling back to memory keeps the app usable, and says so.
const memory = new Map();
let volatile = false;

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    volatile = true;
    return memory.get(key) ?? null;
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    volatile = true;
    memory.set(key, value);
  }
}

export const isVolatile = () => volatile;

export const DEFAULTS = {
  version: 1,
  apps: {},
  events: [],
  goals: [],
  journal: {},
  accepted: {},
  imported: [],
  settings: {
    fidelity: 'L2',
    tz: 'Asia/Kolkata',
    utc_offset_min: 330,
    idle_threshold_ms: 60000,
    merge_gap_ms: 90000,
    titles: false,
    provider: 'openai_compat',
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
};

export function load() {
  try {
    const raw = readKey(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
    };
  } catch (error) {
    console.warn('sundial: could not read local state', error);
    return structuredClone(DEFAULTS);
  }
}

export function save(state) {
  try {
    writeKey(KEY, JSON.stringify(state));
    return { ok: true, volatile };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** Load the synthetic demo week so the trial has something to show. */
export function loadDemo(state) {
  const demo = buildDemo(Number(state.settings.utc_offset_min));
  state.events = demo.events;
  state.apps = { ...state.apps, ...demo.apps };
  return demo.events.length;
}

export function wipe() {
  memory.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* already gone */
  }
}

export function rehydrate(state) {
  return { ...state, events: state.events.map(makeEvent) };
}

/** Import NDJSON from a collector, or a bundle this app exported. */
export function importText(state, text) {
  const trimmed = text.trim();
  if (!trimmed) return { added: 0, error: 'the file is empty' };

  let incoming = [];
  let apps = {};

  if (trimmed.startsWith('{') && trimmed.includes('"events"') && !trimmed.includes('\n{"type"')) {
    let bundle;
    try {
      bundle = JSON.parse(trimmed);
    } catch {
      return { added: 0, error: 'that looks like JSON but it will not parse' };
    }
    incoming = (bundle.events || []).map(makeEvent);
    apps = bundle.apps || {};
  } else {
    const parsed = loadEvents(trimmed);
    incoming = parsed.events;
    apps = parsed.apps;
  }

  if (!incoming.length) return { added: 0, error: 'no events found in that file' };

  const seen = new Set(state.events.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));

  state.events = [...state.events, ...fresh];
  state.apps = { ...state.apps, ...apps };
  state.imported = [
    ...(state.imported || []),
    { at: new Date().toISOString(), events: fresh.length, total: incoming.length },
  ].slice(-20);

  return {
    added: fresh.length,
    duplicates: incoming.length - fresh.length,
    days: new Set(fresh.map((e) => e.local_date)).size,
  };
}

export function addManual(state, { appName, day, start, minutes }) {
  const id = `manual-${Date.now().toString(36)}`;
  const appId = `manual:${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const [hours, mins] = start.split(':').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d, hours, mins) - state.settings.utc_offset_min * 60000;
  const endMs = startMs + Math.round(minutes * 60000);

  if (!state.apps[appId]) {
    state.apps[appId] = {
      id: appId,
      name: appName,
      category: null,
      is_ai_tool: false,
      is_communication: false,
    };
  }

  state.events.push(
    makeEvent({
      id,
      device_id: 'web-manual',
      kind: 'app_focus',
      ts_start: startMs,
      ts_end: endMs,
      local_date: day,
      app_id: appId,
      idle_ms: 0,
      collector: 'web-manual@1',
    }),
  );
  return id;
}

export function deleteRange(state, from, to) {
  const before = state.events.length;
  state.events = state.events.filter((e) => e.local_date < from || e.local_date > to);
  return before - state.events.length;
}

export function bundle(state) {
  return JSON.stringify(
    {
      sundial: 1,
      exported_at: new Date().toISOString(),
      note: 'Everything this app knows. Import it back into any Sundial build.',
      settings: state.settings,
      goals: state.goals,
      apps: state.apps,
      events: state.events.map((e) => ({
        id: e.id,
        device_id: e.device_id,
        kind: e.kind,
        ts_start: e.ts_start,
        ts_end: e.ts_end,
        local_date: e.local_date,
        app_id: e.app_id,
        title: e.title,
        idle_ms: e.idle_ms,
        collector: e.collector,
      })),
    },
    null,
    2,
  );
}

export function csv(state, facts) {
  const rows = [['day', 'active_h', 'sessions', 'switches', 'late_h', 'focus_h', 'coverage']];
  for (const day of facts.days) {
    rows.push([day.day, day.active_h, day.sessions, day.switches, day.late_h, day.focus_h, day.coverage]);
  }
  return rows.map((row) => row.join(',')).join('\n') + '\n';
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
