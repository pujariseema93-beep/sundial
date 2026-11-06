# Fixtures

Synthetic capture streams, deterministic by construction. `python fixtures/generate.py` rewrites all three files byte for byte; CI fails if the committed files drift.

| File | Shape | Exercises |
| --- | --- | --- |
| `desk-5weeks.jsonl` | 5 weeks, Windows-like, L4 with titles | baselines, late-night drift, fragmentation spike, focus blocks, break debt |
| `android-week.jsonl` | 1 week, phone, L2 with no titles | app-level metrics without text, short sessions, late-night use |
| `edge-cases.jsonl` | 1 day, hand-built | midnight-spanning session, 40 min idle, lock inside a gap, zero-length event, overlapping apps, six-hour hole |

The desk stream is deliberately built so the final week looks worse than the four before it: Tuesday to Thursday gain a 95-minute late block, and the morning gains five short Slack/Chrome cycles. That is what makes D01 and D02 fire in the golden file, which is how the detectors are tested end to end.

Nothing here is real user data, and nothing here should ever become real user data.
