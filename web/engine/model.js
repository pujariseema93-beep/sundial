// Core types: parameters, apps and events, plus the NDJSON reader.

import { DAY, MINUTE, daysBetween, dayBounds, isoDate, isoHour } from './util.js';

export class Params {
  constructor(overrides = {}) {
    Object.assign(
      this,
      {
        idle_threshold_ms: 60_000,
        merge_gap_ms: 90_000,
        idle_split_ms: 300_000,
        focus_min_ms: 20 * MINUTE,
        focus_gap_ms: 5 * MINUTE,
        focus_max_apps: 2,
        short_ms: 2 * MINUTE,
        break_min_ms: 5 * MINUTE,
        late_start_hour: 22,
        late_end_hour: 6,
        wake_start_hour: 7,
        wake_end_hour: 23,
        utc_offset_min: 330,
        tz: 'Asia/Kolkata',
      },
      overrides,
    );
  }

  // Python hashes json.dumps(vars(self), sort_keys=True); the key order and
  // separators below reproduce that string exactly, so the hash matches.
  hash() {
    const keys = Object.keys(this).sort();
    const body = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(this[k])}`).join(', ');
    return sha256Hex(`{${body}}`).slice(0, 16);
  }

  toLocal(ms) {
    return { date: isoDate(ms, this.utc_offset_min), hour: isoHour(ms, this.utc_offset_min) };
  }

  dayBounds(day) {
    return dayBounds(day, this.utc_offset_min);
  }

  daysBetween(start, end) {
    return daysBetween(start, end);
  }
}

/** Small synchronous SHA-256, so the engine has no dependencies at all. */
export function sha256Hex(text) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 2 ** 32), false);

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map((x) => x >>> 0);
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

export function windowEvents(events, start, end) {
  return events.filter((e) => e.local_date >= start && e.local_date <= end);
}

/** Build an event with the accessors the engine relies on. */
export function makeEvent(rec) {
  const start = typeof rec.ts_start === 'string' ? Date.parse(rec.ts_start) : rec.ts_start;
  const end = typeof rec.ts_end === 'string' ? Date.parse(rec.ts_end) : rec.ts_end;
  const appId = rec.app_id ?? rec.app?.platform_id ?? null;
  return {
    id: rec.id,
    device_id: rec.device_id,
    kind: rec.kind,
    ts_start: start,
    ts_end: end,
    local_date: rec.local_date,
    app_id: appId,
    title: rec.title ?? null,
    domain: rec.domain ?? null,
    idle_ms: rec.idle_ms ?? 0,
    flags: rec.flags ?? [],
    collector: rec.collector ?? '',
    get is_activity() {
      return this.kind === 'app_focus' && this.app_id !== null;
    },
    get is_barrier() {
      return this.kind === 'lock' || this.kind === 'sleep';
    },
    get duration_ms() {
      return Math.max(0, this.ts_end - this.ts_start);
    },
  };
}

/** Parse an NDJSON stream (collector output or a fixture file). */
export function loadEvents(text) {
  const events = [];
  const apps = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type === 'app') {
      apps[rec.id] = {
        id: rec.id,
        name: rec.name,
        category: rec.category ?? null,
        is_ai_tool: Boolean(rec.is_ai_tool),
        is_communication: Boolean(rec.is_communication),
      };
      continue;
    }
    if (rec.type && rec.type !== 'event') continue;
    const event = makeEvent(rec);
    events.push(event);
    const appId = event.app_id;
    if (appId && !apps[appId]) {
      apps[appId] = { id: appId, name: rec.app?.display_name ?? appId, category: null, is_ai_tool: false, is_communication: false };
    }
  }
  events.sort((a, b) => a.ts_start - b.ts_start || String(a.id).localeCompare(String(b.id)));
  return { events, apps };
}

export { DAY, MINUTE };
