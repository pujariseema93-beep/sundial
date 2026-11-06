# Contributing

Sundial is pre-alpha. The most useful contributions right now are disagreements with the metric definitions and new fixture streams, not new features.

## Before you change a number

Any change to `oracle/wl_oracle/metrics.py`, `intervals.py` or `sessions.py` must come with:

1. a hand-computed expectation in `oracle/tests/test_metrics.py` (a number you worked out on paper, not the number the code produced);
2. a regenerated golden file **and** a sentence in the pull request explaining why each moved number is correct.

Golden files are regression anchors, not ground truth. Regenerate with:

```bash
cd oracle && REGEN=1 python -m pytest tests/test_golden.py
```

## Adding a fixture stream

Add a builder to `fixtures/generate.py`, keep it deterministic (seeded, no clock reads), commit the generated `.jsonl`, and add a golden case in `oracle/tests/test_golden.py`. A stream is interesting if it breaks an assumption: a device that was off for two days, a session that spans a DST boundary, an app with a hundred one-second sessions.

## Code

- Python 3.11+, standard library only in `wl_oracle`.
- `ruff check oracle` must pass.
- No network calls, ever. A pull request that adds an outbound request to the oracle is rejected on sight.

## Commits

Conventional-ish prefixes (`core:`, `docs:`, `fixtures:`, `test:`) and a body that says what moved and why.
