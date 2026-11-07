# Sundial web build

A static, single-page dashboard that computes everything in your browser. No build step, no dependencies, no server: `index.html` and the folders beside it are the whole app.

```bash
cd web
python3 -m http.server 8080     # any static server will do
# open http://localhost:8080
```

Opening `index.html` straight from disk works in some browsers, but `file://` blocks ES modules and local storage in most, so a local server is the reliable path. There is also a demo week behind the button on the empty screen, or `?demo=1` in the URL.

## What it is, honestly

The browser cannot see your desktop. This build is the L0–L1 end of the fidelity ladder from the spec:

- **L0** — log a block by hand (Settings → Log a block).
- **L1** — import a collector's NDJSON stream, or a bundle this app exported, and read the dashboard.
- It is also the dashboard for a machine where a real collector is running, and the reference implementation of the shared UI kit.

It is **not** a capture agent, and it says so on the Settings screen rather than after a week of empty charts.

## What is here

| File | What it does |
| --- | --- |
| `engine/` | The metric engine, ported from the Python oracle. Same intervals, same sessions, same detectors, same facts document |
| `app/main.js` | Views and routing: Week, Reflect, Topics, Goals, Settings |
| `app/store.js` | One JSON blob in local storage, import, export, delete, manual entry |
| `app/template.js` | The template writer — what the app says with no model at all |
| `app/insight.js` | The BYOK layer: payload assembly, preview, provider adapters, response validation |
| `app/demo.js` | Synthetic demo week, generated from the calendar date |
| `tests/` | Node tests that prove the JS engine reproduces the committed golden facts |
| `sw.js` | Service worker: the shell works offline |

## The engine is the same engine

`web/engine` is a port of `oracle/wl_oracle`, not a rewrite. The contract between them is the golden facts in `/golden`:

```bash
node --test web/tests/      # must match all three goldens, byte for byte after a parse
```

That test is the reason the port is trustworthy: it caught a rounding difference (`0.15` rounds to `0.1` in Python because the double is really `0.1499…`, and naive JavaScript rounding said `0.2`), and a formatting difference in evidence strings. Both are now exact.

## The AI layer, in a browser

Four constraints are enforced in code rather than documented:

1. **Nothing leaves the page** until you press Send, on a payload you have already seen. `insight.js` builds the preview from the same object it sends.
2. **The key is session-only.** It lives in memory for the tab and is gone on reload — a browser has no keyring, so the honest options were session-only or plaintext, and plaintext is not an option.
3. **A reply that invents a number is rejected.** `validate()` checks that every cited fact exists, that every numeral appears in the facts, and that the banned lexicon is absent. On failure the template narrative stands and the app says why.
4. **The kill switch works.** With it on, no payload can be built at all.

Two caveats worth knowing before you blame the app:

- **CORS.** Most providers refuse cross-origin calls from a page. OpenAI-compatible endpoints and Anthropic work with the headers this build sends; Gemini puts the key in a query string, so it can land in logs. For a local Ollama, start it with `OLLAMA_ORIGINS=*` or the browser will block the request — the error message says this.
- **Cost.** A reflection is roughly 3–4 k input tokens. The preview shows the estimate before you send, and there are no background calls, retries or batching.

## Privacy, precisely

Everything is in one local-storage key, `sundial.v1.state`. There is no account, no analytics, no crash reporting, no update check, and no Sundial server to send anything to. Export is a button; delete is a button. If the browser refuses storage (`file://`, private mode) the app falls back to memory and tells you that nothing will survive a reload.

## Design notes

Serif for the numbers you are meant to read, mono for identifiers and fact references, one accent for anything computed. Every chart has a table view behind a `<details>` so the accessible alternative is the same data rather than a summary. Dark mode follows the OS. Print drops the chrome and keeps the cards.
