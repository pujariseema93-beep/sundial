# Metric definitions

Everything the AI says rests on this page. Definitions are fixed here, parameterised in `Params` (`oracle/wl_oracle/model.py`), and covered by hand-computed tests in `oracle/tests/test_metrics.py`.

All durations are computed over half-open intervals `[start, end)` in integer milliseconds and attributed to local dates. The engine is deterministic: the same events with the same parameters produce byte-identical output.

## Parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| `idle_threshold_ms` | 60 s | Input silence after which an interval stops accruing time |
| `merge_gap_ms` | 90 s | Gap that ends a session |
| `idle_split_ms` | 5 min | Idle period that ends a session |
| `focus_min_ms` | 20 min | Shortest run that counts as a focus block |
| `focus_gap_ms` | 5 min | Gap that breaks a focus block |
| `focus_max_apps` | 2 | Distinct apps allowed inside one focus block |
| `short_ms` | 2 min | Below this, a session is "short" |
| `break_min_ms` | 5 min | Silence that counts as a break |
| `late_start_hour` / `late_end_hour` | 22 → 06 | The late-night band |
| `wake_start_hour` / `wake_end_hour` | 07 → 23 | Waking window, used for recovery gaps |

## Metrics

| Identifier | Definition |
| --- | --- |
| `active_ms` | Sum over the day of the union of credited intervals, attributed to the app that had focus |
| `credited(e)` | `[s, min(e, s + (e − s) − max(0, i − τ)))` — the event minus the idle time beyond the threshold |
| `session` | Maximal run of activity on one app, broken by another app, a gap > `merge_gap_ms`, or a lock/sleep event |
| `focus_block` | Run ≥ `focus_min_ms` over ≤ `focus_max_apps` distinct apps, no communication app, no gap > `focus_gap_ms` |
| `switches` | Foreground app changes between consecutive sessions, excluding returns after a gap > `merge_gap_ms` |
| `switches_per_hour` | `switches ÷ (active_ms ÷ 3 600 000)` |
| `short_session_share` | Sessions shorter than `short_ms`, by count |
| `late_night_share` | `active_ms` in hours 22–05 ÷ total `active_ms` |
| `break_debt` (per day) | Longest run of consecutive sessions with no gap ≥ `break_min_ms` |
| `recovery_gap` (per day) | Longest no-input gap inside the waking window |
| `coverage` (per day) | `active_ms ÷ span`, where span is first-to-last activity — see ADR 0004 |
| `ai_share` | `active_ms` in apps flagged `is_ai_tool` ÷ total `active_ms` |
| `week_delta` | Change against the trailing four-week median, not the mean |

## Two rules that look pedantic and are not

**Attribution is by focus, not visibility.** A window that is open but not focused accrues nothing. This is why Sundial's numbers are usually lower than an OS "screen time" counter, which sums visibility.

**Midnight splits rollups, never sessions.** A 23:40–00:30 session stays one session in `sessions`, but its time lands on two dates in the daily rollups. Both facts are true; the UI says which one it is showing.

## What we deliberately do not compute

No focus score, no productivity percentage, no percentile against other users, no "attention span" in minutes. Composite scores hide their weights, ranking invites optimising the metric instead of the goal, and the research basis for single-number attention scores is thin enough that shipping one would be a false claim of precision.

## Detectors

| ID | Fires when | Needs |
| --- | --- | --- |
| D01 | `late_night_share` up ≥ 10 pts vs trailing median, on ≥ 3 days | baseline |
| D02 | `switches_per_hour` up ≥ 25 % with `short_session_share` also up | baseline |
| D03 | ≥ 4 apps cycling inside 10 min, ≥ 3 blocks in a day | window |
| D04 | ≥ 2 days with ≥ 90 min in focus blocks | window |
| D05 | ≥ 3 days with an unbroken run > 120 min | window |
| D06 | `ai_share` > 25 % | window |
| D07 | ≥ 4 days with a 45+ min gap, where the baseline was < 30 min | baseline |
| D08 | Weekend daily mean ≥ 2 h above weekday mean | window |
| D09 | Cluster churn > 30 % with ≥ 5 clusters | clustering (not implemented) |
| D10 | A stated goal's metric moved the wrong way for two weeks | goals (not implemented) |

Detectors never fire on a single unusual day; every threshold has a minimum-sample condition, and every emitted fact carries the numbers behind it.
