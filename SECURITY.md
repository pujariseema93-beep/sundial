# Security policy

Sundial is designed so that a compromise of the app cannot leak your history to anyone but you.

## Reporting

Email the maintainer rather than opening a public issue. Expect an acknowledgement within seven days and a coordinated disclosure after 90 days, or sooner if a fix ships first.

## In scope

- Any path by which captured data (events, titles, facts) leaves the device without an explicit, previewed user action.
- Any way a third party can read the local database, the IPC socket, or a stored API key.
- Prompt-injection routes: text that reaches the model and can alter its behaviour or exfiltrate data.

## Out of scope

- The user's own choice of model provider, or that provider's retention policy.
- Whole-disk encryption, screen locks, and other OS-level controls.

## Standing guarantees

- No telemetry, no analytics, no crash reporting service, no update ping without consent.
- No account, no server, no sync endpoint operated by this project.
- The API key lives in the OS secret store, never in the database, logs, or a crash dump.
