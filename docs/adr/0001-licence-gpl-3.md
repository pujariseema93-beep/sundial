# 0001 — Licence: GPL-3.0-or-later

Status: accepted · 2026-11-05

## Context

Sundial is a privacy tool that people must be able to audit, and it has no server component. Three licences were realistic: a permissive one (MIT/Apache-2.0), file-level copyleft (MPL-2.0), or strong copyleft (GPL-3.0 / AGPL-3.0).

The decisive constraint in the first draft was the App Store: Apple's DRM terms add restrictions the GPL forbids, so a GPL iOS app cannot be distributed there. That forced MPL-2.0.

## Decision

GPL-3.0-or-later for the whole project.

The iOS target was dropped (ADR 0002) for reasons that had nothing to do with licensing, and with it went the only reason to weaken the licence. A closed fork of a privacy tool is the specific harm a copyleft licence prevents: someone takes the code, adds a telemetry SDK, and ships it under the same name.

AGPL-3.0 was rejected as well. Its network clause defends against a hosted closed fork, and there is no hosted anything here to defend.

## Consequences

- A fork must publish its source. That is the point.
- No App Store distribution, for any platform. macOS ships as a notarised direct download.
- An iOS client, if ever wanted, cannot be built from this codebase; it would be a separate, permissively licensed client reading an exported bundle.
- The collector plugin boundary is a process boundary (socket or pipe), not a linked library, so third-party collectors are separate works and need not be GPL-compatible. The ecosystem stays open without weakening the licence on the app.
