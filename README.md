# Sundial

A local-first, cross-platform wellbeing app for attention — with a bring-your-own-key analytical layer.

Sundial records how you actually use your devices, turns that record into plain arithmetic, and — only when you ask — uses a language model that **you** pay for, with **your** own API key, to explain the pattern in words and suggest one change.

**Status: pre-alpha.** The architecture is fixed and specified; the metric engine is being built and tested against golden fixtures. Nothing here talks to a network or reads a real device yet.

## What is in this repository

| Path | What it is |
| --- | --- |
| `docs/spec.html` | The full architecture and specification, self-contained |
| `docs/event-contract.md` | The one interface every collector must speak |
| `docs/metrics.md` | Every metric, its formula, and its parameters |
| `docs/adr/` | Decisions with their reasoning, including the ones that changed |
| `oracle/` | The reference implementation of the metric engine (Python) |
| `fixtures/` | Deterministic synthetic capture streams |
| `golden/` | Committed facts documents the Rust core must reproduce |

## Why an oracle

The product's entire claim is that its numbers are trustworthy. Two implementations of an interval algebra drift apart silently, so the plan is one implementation plus a test suite that any port must satisfy:

- `fixtures/` are deterministic — `python fixtures/generate.py` reproduces them byte for byte.
- `oracle/` computes `wl.facts.v3` from a stream and is covered by hand-computed unit tests.
- `golden/` pins the output for three streams; the Rust core (`core/`, not started) will be tested against the same files.

See `docs/adr/0003-reference-implementation.md` for why M0 shipped in Python.

## Quickstart

Requires Python 3.11 or newer. No dependencies beyond the standard library for the engine itself.

```bash
cd oracle
pip install -e . pytest
python -m pytest                       # 35 tests
python -m wl_oracle.cli stats ../fixtures/desk-5weeks.jsonl \
    --start 2026-10-26 --end 2026-11-01
python -m wl_oracle.cli facts ../fixtures/desk-5weeks.jsonl \
    --start 2026-10-26 --end 2026-11-01 --out /tmp/week.json
```

`facts` emits the `wl.facts.v3` document — the only thing the AI layer is ever allowed to receive.

## Layout

```
docs/            spec, event contract, metric definitions, ADRs
fixtures/        generate.py plus three committed NDJSON streams
golden/          facts documents pinned by tests
oracle/          wl_oracle package, CLI and tests
  wl_oracle/     model · intervals · sessions · metrics · detectors · facts · cli
  tests/         hand-computed expectations, then golden regressions
```

## Principles that constrain the code

1. **Arithmetic before adjectives.** Detectors emit numbers and evidence strings; only the model writes prose, and only about facts it was given.
2. **Deterministic.** Same events plus same parameters produce byte-identical facts. A test enforces it.
3. **Degrade to useful.** Every AI feature has a deterministic fallback, and every platform declares what it can and cannot see.
4. **No telemetry, no account, no server.** The only secret in the product is the user's own API key.

## Roadmap

- [x] Event contract, metric definitions, ADRs
- [x] Reference implementation: intervals, sessions, metrics, detectors D01–D08
- [x] Fixture corpus and golden facts
- [ ] Rust core (`wl-core`) passing the same goldens
- [ ] Windows collector and Tauri shell (M1)
- [ ] Android collector and Compose shell (M2)
- [ ] BYOK gateway: redaction, payload preview, provider adapters (M3)

D09 (context churn) and D10 (goal drift) are specified but not implemented: the first needs clustering, the second needs user-stated goals.

## Licence

GPL-3.0-or-later. See `LICENSE` and `docs/adr/0001-licence-gpl-3.md`.

Sundial is a working title.
