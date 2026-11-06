# 0002 — Platform scope: five targets, no iOS

Status: accepted · 2026-11-05

## Context

"Universal" was the requirement. The first draft listed six targets: Android, iOS, Windows, macOS, Linux, web/PWA.

iOS is structurally different from the others. Apple's Screen Time API gives an app no readable dataset: `DeviceActivityReport` renders usage inside your own extension view but the numbers never leave that view, `DeviceActivityMonitor` yields threshold events rather than history, and `ManagedSettings` can shield apps but cannot report on them. Two further obstacles pointed the same way: the Family Controls entitlement is granted per-developer at Apple's discretion, and the App Store's terms conflict with strong copyleft.

## Decision

Drop iOS. Target Android, Windows, macOS, Linux and web/PWA.

## Consequences

- An iOS build would have been a different product — a rendered report plus shields plus manual entry — sharing none of the core's per-app timeline. Not shipping it is more honest than shipping a second-class one.
- The licence could become GPL-3.0 (ADR 0001).
- The capability matrix, distribution table, CI matrix, milestone plan and permission checklist all lost their iOS row; the architecture diagram lost its sixth collector.
- If iOS returns, it returns as a separate permissively licensed client that imports an exported bundle — never as a sixth collector.

## What is still universal

Collection is not uniform, and cannot be. What is uniform is the shape: the same event contract, the same metric definitions, the same reflection ritual, and a visible statement of what this device can and cannot see.
