// The Sundial web app: dashboard, reflection ritual, topics, goals, settings.
//
// Everything is computed in the page from events already on the device. The
// only outbound request in the whole app is the insight call in the Reflect
// view, and it cannot happen without pressing Send on a payload you have
// already read.

import {
  Params,
  build,
  compute,
  addDays,
  daysBetween,
  pyRound,
  weekdayIndex,
} from '../engine/index.js';
import {
  DEFAULTS,
  addManual,
  isVolatile,
  loadDemo,
  bundle,
  csv,
  deleteRange,
  download,
  importText,
  load,
  rehydrate,
  save,
  wipe,
} from './store.js';
import { dayLabel, h1, hours, hourLabel, pct, plural, rangeLabel, signed } from './format.js';
import { asText, narrative, suggestionFor } from './template.js';
import { PROVIDERS, buildPayload, call, redacted, validate } from './insight.js';

const state = rehydrate(load());

let lastWindow = null;

const ui = {
  view: 'week',
  range: 'latest',
  sessionKey: '',
  killSwitch: false,
  preview: null,
  insight: null,
  busy: false,
  message: null,
  error: null,
};

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const persist = () => {
  const result = save(state);
  if (!result.ok) {
    ui.error = 'Could not save: this browser’s storage is full. Export and delete a range in Settings.';
  }
};

// ---------------------------------------------------------------- ranges

function todayIso() {
  const now = new Date();
  const offset = state.settings.utc_offset_min * 60000;
  return new Date(now.getTime() + offset).toISOString().slice(0, 10);
}

function mondayOf(iso) {
  const index = (weekdayIndex(iso) + 6) % 7;
  return addDays(iso, -index);
}

function pickRange() {
  const today = todayIso();
  const monday = mondayOf(today);
  const ranges = {
    'this-week': [monday, addDays(monday, 6)],
    'last-week': [addDays(monday, -7), addDays(monday, -1)],
    'last-4-weeks': [addDays(monday, -21), addDays(monday, 6)],
  };

  const dates = [...new Set(state.events.map((e) => e.local_date))].sort();
  const latest = dates.length
    ? [addDays(dates[dates.length - 1], -6), dates[dates.length - 1]]
    : [addDays(today, -6), today];
  ranges.latest = latest;

  const chosen = ranges[ui.range] || latest;
  const hasData = state.events.some((e) => e.local_date >= chosen[0] && e.local_date <= chosen[1]);
  if (hasData) return { start: chosen[0], end: chosen[1], fellBack: false, key: ui.range };
  return { start: latest[0], end: latest[1], fellBack: ui.range !== 'latest', key: 'latest' };
}

function computeFacts() {
  const { start, end } = pickRange();
  const params = new Params({
    idle_threshold_ms: Number(state.settings.idle_threshold_ms),
    merge_gap_ms: Number(state.settings.merge_gap_ms),
    utc_offset_min: Number(state.settings.utc_offset_min),
    tz: state.settings.tz,
  });
  const facts = build(state.events, state.apps, params, start, end, {
    fidelity: state.settings.fidelity,
    baselineWeeks: 4,
  });
  // The facts document is prose-free by design; the views that need sessions
  // or parameters read them from the window instead.
  lastWindow = compute(state.events, state.apps, params, start, end, {
    fidelity: state.settings.fidelity,
  });
  facts.goals = state.goals
    .filter((goal) => goal.active)
    .map((goal) => ({ id: goal.id, text: goal.text, metric: goal.metric, target: goal.target, actual: metricValue(facts, goal.metric) }));
  return facts;
}

function metricValue(facts, metric) {
  switch (metric) {
    case 'focus_hours':
      return facts.shape.focus_hours;
    case 'active_h':
      return facts.totals.active_h;
    case 'late_night_share':
      return facts.shape.late_night_share;
    case 'switches_per_hour':
      return facts.shape.switches_per_hour;
    default:
      return 0;
  }
}

const METRICS = {
  focus_hours: { label: 'Focus hours per week', unit: 'h', lower: false },
  active_h: { label: 'Active hours per week', unit: 'h', lower: false },
  late_night_share: { label: 'Late-night share', unit: '', lower: true },
  switches_per_hour: { label: 'App switches per hour', unit: '', lower: true },
};

// ---------------------------------------------------------------- pieces

function chip(text, tone = '') {
  return `<span class="chip ${tone}">${esc(text)}</span>`;
}

function severityTone(severity) {
  return { high: 'warn', medium: 'warn-soft', positive: 'good', info: '' }[severity] || '';
}

function hourChart(facts) {
  const values = facts.shape.by_hour;
  const max = Math.max(...values, 0.1);
  const bars = values
    .map((value, hour) => {
      const height = Math.max(2, Math.round((value / max) * 100));
      const peak = hour === facts.shape.peak_hour ? ' peak' : '';
      return `<div class="hour" title="${hourLabel(hour)} — ${value.toFixed(1)} h per day">
        <div class="bar${peak}" style="height:${height}%"></div>
        <span class="hour-label">${hour % 3 === 0 ? hourLabel(hour) : ''}</span>
      </div>`;
    })
    .join('');

  const rows = values
    .map((value, hour) => `<tr><td>${hourLabel(hour)}</td><td>${value.toFixed(1)}</td></tr>`)
    .join('');

  return `<figure class="chart">
    <div class="hour-chart">${bars}</div>
    <figcaption>Average hours per day in each hour, ${rangeLabel(facts.window.start, facts.window.end)}.
      <details><summary>Table view</summary><table class="mini"><thead><tr><th>Hour</th><th>Hours/day</th></tr></thead><tbody>${rows}</tbody></table></details>
    </figcaption>
  </figure>`;
}

function dayStrip(facts) {
  const max = Math.max(...facts.days.map((d) => d.active_h), 0.1);
  return `<ol class="days">${facts.days
    .map((day) => {
      const width = Math.max(2, Math.round((day.active_h / max) * 100));
      const low = day.coverage < 0.5 ? ' low' : '';
      return `<li class="${low.trim()}">
        <span class="day-name">${dayLabel(day.day)}</span>
        <span class="day-bar"><i style="width:${width}%"></i></span>
        <span class="day-value">${day.active_h.toFixed(1)} h</span>
        <span class="day-note">${day.coverage < 0.5 ? `${pct(day.coverage)} covered` : `${day.sessions} sessions`}</span>
      </li>`;
    })
    .join('')}</ol>`;
}

function appList(facts) {
  if (!facts.apps.length) return '<p class="muted">No apps recorded in this range.</p>';
  return `<ul class="apps">${facts.apps
    .map(
      (app) => `<li>
        <span class="app-name">${esc(app.name)}</span>
        <span class="app-bar"><i style="width:${Math.max(2, Math.round(app.share * 100))}%"></i></span>
        <span class="app-value">${app.h.toFixed(1)} h</span>
        <span class="app-note">${plural(app.sessions, 'session', 'sessions')} · median ${app.median_session_min} min</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function patternCards(facts, limit = 4) {
  if (!facts.patterns.length) {
    return `<div class="empty-pattern">
      <p>Nothing crossed a threshold this week.</p>
      <p class="muted">That is usually what a steady week looks like, not an absence of data.</p>
    </div>`;
  }
  return `<ul class="patterns">${facts.patterns
    .slice(0, limit)
    .map(
      (pattern) => `<li class="pattern ${severityTone(pattern.severity)}">
        <div class="pattern-head">
          <span class="pattern-name">${esc(pattern.name.replace(/_/g, ' '))}</span>
          ${chip(pattern.severity, severityTone(pattern.severity))}
          <span class="pattern-id">${pattern.id}</span>
        </div>
        <ul class="evidence">${pattern.evidence.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
        <p class="scope">${esc(pattern.scope)}</p>
      </li>`,
    )
    .join('')}</ul>`;
}

function coverageNote(facts) {
  const { coverage } = facts;
  // A day with a long evening away from the machine is not a day with bad
  // data, so only a genuinely holey range is allowed to look alarming.
  const tone = coverage.confidence >= 0.5 ? '' : 'warn-soft';
  return `<p class="coverage">${chip(`L${coverage.fidelity.slice(1)}`, '')}
    ${chip(`${coverage.complete_days}/${coverage.days} days fully captured`, '')}
    ${chip(`median day ${Math.round(coverage.confidence * 100)}% covered`, tone)}
    <span class="muted">covered = activity as a share of the time between your first and last event each day</span></p>`;
}

// ---------------------------------------------------------------- views

function weekView(facts) {
  const { totals, shape } = facts;
  const delta = signed(totals.delta_pct);
  return `
  <section class="hero">
    <p class="eyebrow">${rangeLabel(facts.window.start, facts.window.end)}</p>
    <h2 class="big">${h1(totals.active_h)}<span class="big-sub"> active</span></h2>
    <p class="hero-line">
      ${delta ? `<strong>${esc(delta)}</strong> against your four-week median` : 'no baseline yet'}
      · peak at ${hourLabel(shape.peak_hour)}
      · ${pct(shape.late_night_share)} after 10pm
    </p>
    ${coverageNote(facts)}
  </section>

  <div class="grid-2">
    <section class="card">
      <h3>Shape of the week</h3>
      ${hourChart(facts)}
    </section>
    <section class="card">
      <h3>Where the time went</h3>
      ${appList(facts)}
    </section>
  </div>

  <section class="card">
    <h3>Day by day</h3>
    ${dayStrip(facts)}
  </section>

  <section class="card">
    <div class="card-head">
      <h3>Patterns</h3>
      <button class="link" data-action="go" data-view="reflect">Reflect on this →</button>
    </div>
    ${patternCards(facts)}
  </section>`;
}

function reflectView(facts) {
  const suggestion = suggestionFor(facts, state.accepted);
  const accepted = state.accepted[suggestion.id];
  const lines = narrative(facts);
  const journal = state.journal[`${facts.window.start}:${facts.window.end}`] || '';
  const insight = ui.insight;

  const insightBlock = insight
    ? `<div class="insight">
        <p class="eyebrow">Written by ${esc(insight.model || 'your model')}</p>
        <h4>${esc(insight.headline)}</h4>
        <ul class="observations">${(insight.observations || [])
          .map((o) => `<li>${esc(o.text)} <span class="refs">${(o.fact_refs || []).join(' · ')}</span></li>`)
          .join('')}</ul>
        ${insight.tension ? `<p class="tension">${esc(insight.tension)}</p>` : ''}
        <p class="caveat">${esc((insight.caveats || []).join(' ') || '')}</p>
      </div>`
    : '';

  return `
  <section class="ritual">
    <p class="eyebrow">The weekly ritual · about four minutes</p>

    <div class="step">
      <span class="step-num">1</span>
      <div>
        <h3>The week in one line</h3>
        <p class="lead">${h1(facts.totals.active_h)} across ${facts.coverage.days} days on ${plural(facts.totals.devices, 'device', 'devices')}${
          facts.totals.delta_pct === null ? '' : `, ${signed(facts.totals.delta_pct)} on the four-week median`
        }.</p>
      </div>
    </div>

    <div class="step">
      <span class="step-num">2</span>
      <div>
        <h3>Three patterns, ranked</h3>
        ${patternCards(facts, 3)}
      </div>
    </div>

    <div class="step">
      <span class="step-num">3</span>
      <div>
        <h3>The narrative</h3>
        ${lines.map((line) => `<p>${esc(line)}</p>`).join('')}
        ${insightBlock}
      </div>
    </div>

    <div class="step">
      <span class="step-num">4</span>
      <div>
        <h3>One change</h3>
        <div class="suggestion">
          <p class="suggestion-action">${esc(suggestion.action)}</p>
          <p class="suggestion-amount">${esc(suggestion.amount)}</p>
          <p class="suggestion-why">${esc(suggestion.why)}</p>
          <div class="row">
            <button class="btn" data-action="accept" data-id="${esc(suggestion.id)}" data-kind="tried">Try it</button>
            <button class="btn ghost" data-action="accept" data-id="${esc(suggestion.id)}" data-kind="smaller">Make it smaller</button>
            <button class="btn ghost" data-action="accept" data-id="${esc(suggestion.id)}" data-kind="dismissed">Not this week</button>
          </div>
          ${accepted ? `<p class="accepted">Marked <strong>${esc(accepted)}</strong> for this week.</p>` : ''}
        </div>
      </div>
    </div>

    <div class="step">
      <span class="step-num">5</span>
      <div>
        <h3>A note, optional</h3>
        <p class="muted">One line, kept with this week. It is only sent to a model if you send it.</p>
        <textarea id="journal" rows="2" placeholder="tired, but the parser is nearly there">${esc(journal)}</textarea>
        <div class="row">
          <button class="btn ghost" data-action="save-journal">Save note</button>
          <button class="btn ghost" data-action="copy-text">Copy the reflection</button>
        </div>
      </div>
    </div>
  </section>

  ${byokPanel(facts)}`;
}

function byokPanel(facts) {
  const settings = state.settings;
  const provider = PROVIDERS[settings.provider] || PROVIDERS.openai_compat;
  const preview = ui.preview;
  const providerOptions = Object.entries(PROVIDERS)
    .map(([key, value]) => `<option value="${key}" ${key === settings.provider ? 'selected' : ''}>${esc(value.label)}</option>`)
    .join('');

  const previewBlock = preview
    ? `<div class="preview">
        <div class="preview-head">
          <strong>This is exactly what will be sent</strong>
          <span class="muted">${preview.estimate.tokens} tokens · ${esc(preview.host)} · ${esc(settings.model)}</span>
        </div>
        <pre class="payload">${esc(JSON.stringify(preview.facts, null, 2))}</pre>
        <div class="row">
          <button class="btn" data-action="send" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Send this'}</button>
          <button class="btn ghost" data-action="cancel-preview">Cancel</button>
        </div>
        <p class="muted small">No background calls, no retries, no batching. One press, one request.</p>
      </div>`
    : '';

  return `
  <section class="card byok">
    <div class="card-head">
      <h3>Ask a model about this week</h3>
      ${chip(ui.killSwitch ? 'kill switch on' : 'optional', ui.killSwitch ? 'warn' : '')}
    </div>
    <p class="muted">Bring your own key. The model receives the facts above and nothing else — no window titles, no events, no app list beyond what you see in the preview. The key stays in this tab and is gone when you reload.</p>

    <div class="fields">
      <label>Provider
        <select data-field="provider">${providerOptions}</select>
      </label>
      <label>Model
        <input type="text" data-field="model" value="${esc(settings.model)}" placeholder="${esc(provider.defaultModel)}">
      </label>
      <label>Base URL
        <input type="text" data-field="base_url" value="${esc(settings.base_url)}" placeholder="${esc(provider.defaultBase)}">
      </label>
      <label>API key (session only)
        <input type="password" id="key" autocomplete="off" placeholder="sk-…" value="${esc(ui.sessionKey)}">
      </label>
    </div>
    <p class="muted small">${esc(provider.note)}</p>

    <div class="row">
      <button class="btn ghost" data-action="preview">Preview the payload</button>
      <button class="btn ghost" data-action="toggle-kill">${ui.killSwitch ? 'Turn the kill switch off' : 'Kill switch'}</button>
    </div>
    ${previewBlock}
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
  </section>`;
}

function topicsView(facts) {
  const hasTitles = state.events.some((e) => e.title);
  const fidelity = facts.coverage.fidelity;

  const window = lastWindow;

  const shapes = facts.days
    .map((day) => {
      const all = window.sessions.filter((s) => s.local_date === day.day);
      const longest = Math.max(...all.map((s) => s.active_ms), 1);
      const sessions = all
        .slice(0, 12)
        .map((s) => {
          const app = state.apps[s.app_id]?.name || s.app_id;
          const width = Math.max(3, Math.round((s.active_ms / longest) * 100));
          return `<i class="seg" style="width:${Math.min(width, 100)}%" title="${esc(app)} — ${Math.round(s.active_ms / 60000)} min"></i>`;
        })
        .join('');
      return `<li><span class="day-name">${dayLabel(day.day)}</span><span class="shape">${sessions || '<i class="seg empty"></i>'}</span></li>`;
    })
    .join('');

  const note = hasTitles
    ? 'Window titles are present, so topic clustering is possible — the clustering step itself is not built yet (M4). Until then this is the app-level shape.'
    : `At L${fidelity.slice(1)} there are no window titles to cluster, so Sundial shows the shape of your days instead: which app, in what order, for how long. On a phone that is the more useful object anyway.`;

  return `
  <section class="card">
    <div class="card-head"><h3>Shape of each day</h3>${chip(`L${fidelity.slice(1)}`, '')}</div>
    <p class="muted">${esc(note)}</p>
    <ul class="shapes">${shapes}</ul>
    <p class="legend muted small"><i class="seg"></i> one mark per session, width by length · hover for the app</p>
  </section>

  <section class="card">
    <h3>Composition</h3>
    ${appList(facts)}
  </section>`;
}

function goalsView(facts) {
  const rows = state.goals
    .map((goal) => {
      const actual = metricValue(facts, goal.metric);
      const meta = METRICS[goal.metric];
      const ratio = goal.target ? Math.min(1.4, actual / goal.target) : 0;
      const good = meta.lower ? actual <= goal.target : actual >= goal.target;
      const shown = meta.unit === 'h' ? `${actual.toFixed(1)} h` : actual.toFixed(2);
      return `<li class="goal ${good ? 'good' : ''}">
        <div class="goal-head">
          <span>${esc(goal.text)}</span>
          ${chip(good ? 'met' : 'in progress', good ? 'good' : 'warn-soft')}
        </div>
        <p class="muted small">${esc(meta.label)} · target ${goal.target}${meta.unit} · now ${shown}</p>
        <div class="progress"><i style="width:${Math.round(ratio * 100)}%"></i></div>
        <button class="link" data-action="close-goal" data-id="${esc(goal.id)}">Close this goal</button>
      </li>`;
    })
    .join('');

  const options = Object.entries(METRICS)
    .map(([key, meta]) => `<option value="${key}">${esc(meta.label)}</option>`)
    .join('');

  return `
  <section class="card">
    <h3>One to three goals</h3>
    <p class="muted">A goal is a metric, a number, and a date. No streaks, no badges.</p>
    ${state.goals.length ? `<ul class="goals">${rows}</ul>` : '<p class="muted">No goals yet.</p>'}
  </section>

  <section class="card">
    <h3>Add a goal</h3>
    <form id="goal-form" class="fields">
      <label>What are you trying to do?<input type="text" name="text" required placeholder="finish the parser rewrite"></label>
      <label>Measured by<select name="metric">${options}</select></label>
      <label>Target<input type="number" name="target" step="0.5" min="0" required placeholder="12"></label>
      <button class="btn" type="submit">Add goal</button>
    </form>
  </section>`;
}

function settingsView(facts) {
  const settings = state.settings;
  const dataDays = [...new Set(state.events.map((e) => e.local_date))].sort();
  const span = dataDays.length ? `${dataDays[0]} → ${dataDays[dataDays.length - 1]}` : 'no data';

  return `
  <section class="card">
    <h3>Capture</h3>
    <p class="muted">The browser cannot see your desktop. This build is manual logging plus import, which the spec calls L0–L1. It is also the dashboard for data captured by a real collector elsewhere.</p>
    <div class="fields">
      <label>Fidelity<select data-field="fidelity">
        ${['L0', 'L1', 'L2', 'L3', 'L4']
          .map((level) => `<option ${level === settings.fidelity ? 'selected' : ''}>${level}</option>`)
          .join('')}
      </select></label>
      <label>Idle threshold (s)<input type="number" data-field="idle_threshold_ms" value="${settings.idle_threshold_ms / 1000}" min="10" step="10"></label>
      <label>Session gap (s)<input type="number" data-field="merge_gap_ms" value="${settings.merge_gap_ms / 1000}" min="30" step="30"></label>
      <label>UTC offset (min)<input type="number" data-field="utc_offset_min" value="${settings.utc_offset_min}" step="15"></label>
    </div>
    <p class="muted small">Changing idle threshold or session gap changes the numbers; the engine recomputes everything from the raw events.</p>
  </section>

  <section class="card">
    <div class="card-head"><h3>Data</h3>${chip(`${plural(state.events.length, 'event', 'events')} · ${span}`, '')}</div>
    <div class="row">
      <label class="btn ghost file">Import NDJSON or a bundle<input type="file" id="import" accept=".json,.jsonl,.ndjson,text/plain" hidden></label>
      <button class="btn ghost" data-action="export-json">Export bundle</button>
      <button class="btn ghost" data-action="export-csv">Export daily totals (CSV)</button>
    </div>
    <p class="muted small">Import accepts a collector's NDJSON stream or a bundle this app exported. Duplicate event ids are dropped.</p>
  </section>

  <section class="card">
    <h3>Log a block by hand</h3>
    <form id="manual-form" class="fields">
      <label>App<input type="text" name="appName" required placeholder="Visual Studio Code"></label>
      <label>Date<input type="date" name="day" required value="${esc(dataDays[dataDays.length - 1] || todayIso())}"></label>
      <label>Start<input type="time" name="start" required value="09:00"></label>
      <label>Minutes<input type="number" name="minutes" min="1" step="5" required value="45"></label>
      <button class="btn" type="submit">Add block</button>
    </form>
  </section>

  <section class="card danger">
    <h3>Delete</h3>
    <form id="delete-form" class="fields">
      <label>From<input type="date" name="from" value="${esc(dataDays[0] || todayIso())}"></label>
      <label>To<input type="date" name="to" value="${esc(dataDays[dataDays.length - 1] || todayIso())}"></label>
      <button class="btn ghost" type="submit">Delete this range</button>
    </form>
    <div class="row">
      <button class="btn danger" data-action="wipe">Delete everything</button>
    </div>
    <p class="muted small">Deletion is local and immediate. There is no copy anywhere else unless you exported one.</p>
  </section>

  <section class="card">
    <h3>What this app knows</h3>
    <ul class="facts-list">
      <li>Every event is stored in this browser's local storage under one key. Nothing is uploaded.</li>
      <li>There is no account, no analytics, no crash reporting, no update check.</li>
      <li>The only outbound request is the insight call in Reflect, and only after you press Send.</li>
      <li>Your API key lives in memory for this tab. Reload the page and it is gone.</li>
      <li>Coverage tells you what is missing: ${Math.round(facts.coverage.confidence * 100)}% of the observed span in this range was captured.</li>
    </ul>
    <p class="muted small">Sundial web · engine ${esc(facts.meta.algo_version)} · facts ${esc(facts.schema)} · params ${esc(facts.meta.params_hash)}</p>
  </section>`;
}

// ---------------------------------------------------------------- shell

function header(facts) {
  const tabs = [
    ['week', 'Week'],
    ['reflect', 'Reflect'],
    ['topics', 'Topics'],
    ['goals', 'Goals'],
    ['settings', 'Settings'],
  ];
  const ranges = [
    ['latest', 'Latest 7 days'],
    ['this-week', 'This week'],
    ['last-week', 'Last week'],
    ['last-4-weeks', 'Last 4 weeks'],
  ];
  return `
  <header class="top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <span class="wordmark">Sundial</span>
      <span class="tagline">local-first · no account</span>
      ${state.events.length && state.events.every((e) => e.device_id === 'demo') ? chip('demo data', 'warn-soft') : ''}
    </div>
    <nav class="tabs" aria-label="Sections">
      ${tabs
        .map(
          ([key, label]) =>
            `<a href="#${key}" ${ui.view === key ? 'aria-current="page"' : ''}>${label}</a>`,
        )
        .join('')}
    </nav>
    <label class="range">
      <span class="visually-hidden">Range</span>
      <select data-field="range">
        ${ranges.map(([key, label]) => `<option value="${key}" ${ui.range === key ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </label>
  </header>`;
}

function emptyState() {
  return `
  <section class="card empty">
    <h2>Nothing to reflect on yet</h2>
    <p>Sundial computes everything from events on this device. The browser cannot watch your desktop, so this build starts with either an import or a hand-logged block.</p>
    <div class="row">
      <button class="btn" data-action="demo">Load the demo week</button>
      <label class="btn ghost file">Import NDJSON<input type="file" id="import" accept=".json,.jsonl,.ndjson,text/plain" hidden></label>
      <button class="btn ghost" data-action="go" data-view="settings">Log a block by hand</button>
    </div>
    <p class="muted small">Try the fixture from the repository: <code>fixtures/desk-5weeks.jsonl</code>.</p>
  </section>`;
}

function render() {
  const hasData = state.events.length > 0;
  const facts = computeFacts();
  const { fellBack } = pickRange();

  let body;
  if (!hasData) body = emptyState();
  else if (ui.view === 'reflect') body = reflectView(facts);
  else if (ui.view === 'topics') body = topicsView(facts);
  else if (ui.view === 'goals') body = goalsView(facts);
  else if (ui.view === 'settings') body = settingsView(facts);
  else body = weekView(facts);

  document.getElementById('app').innerHTML = `
    ${header(facts)}
    <main class="wrap">
      ${fellBack && hasData ? `<p class="banner">No capture in that range — showing ${rangeLabel(facts.window.start, facts.window.end)} instead.</p>` : ''}
      ${ui.message ? `<p class="banner ok">${esc(ui.message)}</p>` : ''}
      ${isVolatile() ? '<p class="banner">This browser is not letting the page store data (file:// or private mode), so nothing will survive a reload. Export before you close the tab.</p>' : ''}
      ${body}
    </main>
    <footer class="foot">
      <span>Sundial · web build · GPL-3.0-or-later</span>
      <span class="muted">Facts are computed in this tab. <a href="#settings">What this app knows</a></span>
    </footer>`;

  ui.message = null;
  document.body.dataset.view = ui.view;
}

// ---------------------------------------------------------------- events

function go(view) {
  ui.view = view;
  ui.preview = null;
  ui.insight = null;
  ui.error = null;
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'go') {
    go(button.dataset.view);
  } else if (action === 'accept') {
    state.accepted[`${button.dataset.id}:${button.dataset.kind}`] = button.dataset.kind;
    state.accepted[button.dataset.id] = button.dataset.kind;
    persist();
    ui.message = `Noted: ${button.dataset.kind}.`;
    render();
  } else if (action === 'save-journal') {
    const facts = computeFacts();
    state.journal[`${facts.window.start}:${facts.window.end}`] = document.getElementById('journal').value;
    persist();
    ui.message = 'Note saved.';
    render();
  } else if (action === 'copy-text') {
    const facts = computeFacts();
    navigator.clipboard?.writeText(asText(facts, suggestionFor(facts, state.accepted)));
    ui.message = 'Reflection copied.';
    render();
  } else if (action === 'export-json') {
    download(`sundial-${todayIso()}.json`, bundle(state));
  } else if (action === 'export-csv') {
    download(`sundial-daily-${todayIso()}.csv`, csv(state, computeFacts()), 'text/csv');
  } else if (action === 'wipe') {
    if (confirm('Delete every event, goal and note on this device? This cannot be undone.')) {
      wipe();
      state.events = [];
      state.goals = [];
      state.journal = {};
      state.imported = [];
      persist();
      ui.message = 'Everything deleted.';
      render();
    }
  } else if (action === 'close-goal') {
    state.goals = state.goals.map((goal) => (goal.id === button.dataset.id ? { ...goal, active: false } : goal));
    persist();
    render();
  } else if (action === 'demo') {
    loadDemo(state);
    persist();
    ui.message = 'Demo week loaded — synthetic data, replaceable with an import.';
    ui.view = 'week';
    ui.range = 'latest';
    render();
  } else if (action === 'toggle-kill') {
    ui.killSwitch = !ui.killSwitch;
    ui.preview = null;
    render();
  } else if (action === 'preview') {
    if (ui.killSwitch) {
      ui.error = 'The kill switch is on. Turn it off to build a payload.';
      render();
      return;
    }
    const facts = computeFacts();
    const payload = buildPayload(redacted(facts), { goal: facts.goals[0] || null });
    ui.preview = {
      ...payload,
      host: new URL(state.settings.base_url || PROVIDERS[state.settings.provider].defaultBase).host,
    };
    ui.error = null;
    render();
  } else if (action === 'cancel-preview') {
    ui.preview = null;
    render();
  } else if (action === 'send') {
    sendInsight();
  }
});

async function sendInsight() {
  if (!ui.preview) return;
  ui.sessionKey = document.getElementById('key')?.value ?? ui.sessionKey;
  const settings = state.settings;

  if (settings.provider !== 'ollama' && !ui.sessionKey) {
    ui.error = 'Paste a key first — it stays in this tab.';
    render();
    return;
  }

  ui.busy = true;
  ui.error = null;
  render();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const text = await call({
      provider: settings.provider,
      baseUrl: settings.base_url,
      model: settings.model,
      key: ui.sessionKey,
      payload: ui.preview,
      signal: controller.signal,
    });
    const result = validate(text, ui.preview.facts);
    if (!result.ok) {
      ui.error = `The reply was rejected (${result.errors.join('; ')}). The template narrative above still stands.`;
      ui.insight = null;
    } else {
      ui.insight = { ...result.insight, model: settings.model };
      ui.message = 'Model reply accepted — every number in it traces to a fact.';
    }
  } catch (error) {
    const hint =
      error.name === 'AbortError'
        ? 'the request timed out'
        : /Failed to fetch/i.test(String(error))
          ? 'the browser blocked the request — most providers refuse cross-origin calls. For Ollama, start it with OLLAMA_ORIGINS=*'
          : String(error.message || error);
    ui.error = `Could not reach the provider: ${hint}.`;
  } finally {
    clearTimeout(timer);
    ui.busy = false;
    ui.preview = null;
    render();
  }
}

document.addEventListener('change', (event) => {
  const field = event.target.dataset.field;
  if (!field) return;

  if (field === 'range') {
    ui.range = event.target.value;
    ui.preview = null;
    ui.insight = null;
    render();
    return;
  }

  if (['idle_threshold_ms', 'merge_gap_ms'].includes(field)) {
    state.settings[field] = Number(event.target.value) * 1000;
  } else if (field === 'utc_offset_min') {
    state.settings[field] = Number(event.target.value);
  } else if (field === 'provider') {
    state.settings.provider = event.target.value;
    state.settings.base_url = PROVIDERS[event.target.value].defaultBase;
    state.settings.model = PROVIDERS[event.target.value].defaultModel;
  } else {
    state.settings[field] = event.target.value;
  }

  persist();
  ui.preview = null;
  render();
});

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'goal-form') {
    const data = new FormData(form);
    state.goals.push({
      id: `goal-${Date.now().toString(36)}`,
      text: String(data.get('text')),
      metric: String(data.get('metric')),
      target: Number(data.get('target')),
      active: true,
    });
    persist();
    ui.message = 'Goal added.';
    render();
  }

  if (form.id === 'manual-form') {
    const data = new FormData(form);
    addManual(state, {
      appName: String(data.get('appName')),
      day: String(data.get('day')),
      start: String(data.get('start')),
      minutes: Number(data.get('minutes')),
    });
    persist();
    ui.message = 'Block logged.';
    render();
  }

  if (form.id === 'delete-form') {
    const data = new FormData(form);
    const removed = deleteRange(state, String(data.get('from')), String(data.get('to')));
    persist();
    ui.message = `Deleted ${plural(removed, 'event', 'events')}.`;
    render();
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id !== 'import') return;
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const result = importText(state, text);
  if (result.error) {
    ui.error = `Import failed: ${result.error}`;
  } else {
    persist();
    ui.message = `Imported ${plural(result.added, 'event', 'events')} across ${plural(result.days, 'day', 'days')}${
      result.duplicates ? ` · ${result.duplicates} duplicates dropped` : ''
    }.`;
    ui.view = 'week';
    ui.range = 'latest';
  }
  render();
});

window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (['week', 'reflect', 'topics', 'goals', 'settings'].includes(view)) go(view);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

if (new URLSearchParams(location.search).get('demo') === '1' && !state.events.length) {
  loadDemo(state);
  persist();
  ui.message = 'Demo week loaded — synthetic data, replaceable with an import.';
}

go(location.hash.slice(1) || 'week');
