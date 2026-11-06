# The collector event contract

Every platform collector — Android, macOS, Windows, Linux, web — translates its own OS API into this one shape. Nothing else in the system knows which platform an event came from. A collector may not compute a metric, and may not open a network connection.

Protocol identifier: `wl.collector.v1`. Transport: NDJSON over a unix socket, a pipe, a binder, or a function call. One JSON object per line.

## 1. Handshake

Sent once, when a collector connects.

```json
{
  "protocol": "wl.collector.v1",
  "collector": "windows-win32",
  "version": "1.4.2",
  "platform": "windows",
  "fidelity": "L4",
  "capabilities": {
    "app_intervals": true,
    "window_titles": true,
    "url_domains": false,
    "idle_detection": true,
    "lock_events": true,
    "backfill_days": 0,
    "granularity_ms": 1000
  },
  "limitations": ["elevated_window_titles_unreadable"]
}
```

`fidelity` is a claim, not a fact: the core cross-checks it against observed events and downgrades it if the collector cannot deliver what it declared. Capabilities a collector declares but never exercises are reported in Settings as "declared, unused".

## 2. Events

```json
{
  "type": "event",
  "id": "01J9Z4K2Q8T3R5V7X9B1D3F5H7",
  "device_id": "d3f1a7c2-...",
  "kind": "app_focus",
  "ts_start": "2026-11-04T09:12:03.220+05:30",
  "ts_end": "2026-11-04T09:31:47.910+05:30",
  "local_date": "2026-11-04",
  "app": { "platform_id": "Code.exe", "display_name": "Visual Studio Code" },
  "title": "wl-core/src/metrics.rs — sundial",
  "idle_ms": 0,
  "flags": [],
  "collector": "windows-win32@1.4.2"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | ULID | Idempotency key. Delivery is at-least-once; duplicates are dropped by this value |
| `device_id` | UUIDv4 | Random at install. Never derived from hardware, advertising id or account |
| `kind` | enum | `app_focus`, `lock`, `sleep`, `backfill` |
| `ts_start`, `ts_end` | int ms UTC | Half-open interval `[start, end)` |
| `local_date` | `YYYY-MM-DD` | Resolved by the collector at write time, with the timezone it used |
| `app.platform_id` | string | Package name, executable path, bundle id, or domain |
| `title` | string, nullable | Omitted entirely when title capture is disabled |
| `idle_ms` | int | Milliseconds without input inside the interval |
| `flags` | array | `backfilled`, `low_confidence`, `superseded` |

The oracle's fixtures carry `ts_start` and `ts_end` as integer milliseconds rather than ISO strings; the wire format uses ISO-8601 with an offset and the core normalises to epoch milliseconds on ingest. Both are the same instant.

## 3. Barriers

`lock` and `sleep` events carry no app and exist to break sessions. A session never spans one.

```json
{ "type": "event", "id": "...", "kind": "lock", "ts_start": 1762281000000, "ts_end": 1762281120000, "local_date": "2026-11-04" }
```

## 4. Rules

- **At-least-once, deduplicated by `id`.** A crashed batch is re-sent; the core drops what it has already seen.
- **Backfill is explicit.** Events older than the committed watermark are accepted only during a declared backfill (Android's history query, or a restored backup), and are flagged `backfilled` so the UI can distinguish recorded-live from reconstructed.
- **No editing.** Corrections are new rows with `supersedes` pointing at the original. Raw events are append-only.
- **No identifiers in text fields.** A title may contain a filename; it may not contain a person's name harvested from a contact database. Collectors redact before they emit, not after.
- **Titles are optional and off-switchable.** A collector that cannot get titles (Android) is still a first-class collector; it declares `window_titles: false` and the product degrades to app-level topics.
