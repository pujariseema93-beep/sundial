# 0004 — Coverage measures missing capture, not idleness

Status: accepted · 2026-11-06 · amends §6.1 of the spec

## Context

The spec defined `coverage` as `active_ms ÷ an estimate of waking wall-clock time`, flagging any day below 70 % as low-confidence.

Building it showed the definition is wrong in a way that matters. A normal working day is six to eight hours of activity inside a sixteen-hour waking window — 40–50 % coverage. Every ordinary day would be flagged incomplete, and the product would tell users its own data was unreliable when it was fine. A metric that fires on the normal case is not a confidence signal; it is noise that trains people to ignore the flag.

## Decision

Per-day coverage is `active_ms ÷ span`, where span is the interval from the first to the last activity of the day. Window confidence is the median of the daily values.

The denominator is now the day as the device saw it, so the metric answers "how much of the time you were at this machine did we actually record?" A two-hour hole between 10:00 and 12:00 lowers coverage; an evening with the laptop shut does not.

## Consequences

- Coverage now detects the failure it was meant to detect: a collector that stopped, a permission that was revoked, a crash.
- A day with two short events scores high. That is correct — we captured nearly all of the span — and the day is separately visible as low-activity.
- `wake_start_hour` / `wake_end_hour` remain in `Params` for recovery gaps, which genuinely need a waking window.
- The spec's §6.1 text is now one definition behind this document; the HTML spec carries a note pointing here.
