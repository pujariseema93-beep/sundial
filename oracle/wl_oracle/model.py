"""Core types for the Sundial oracle.

Everything here mirrors the event contract in docs/event-contract.md.
Timestamps are integer milliseconds since the Unix epoch, UTC. Local dates
are resolved by the collector (or by the fixture generator) and carried on
the event, exactly as the contract requires.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone

MINUTE = 60_000
HOUR = 60 * MINUTE


@dataclass(frozen=True)
class App:
    id: str
    name: str
    category: str | None = None
    is_ai_tool: bool = False
    is_communication: bool = False


@dataclass(frozen=True)
class Event:
    id: str
    device_id: str
    kind: str  # app_focus | lock | sleep | backfill
    ts_start: int
    ts_end: int
    local_date: str
    app_id: str | None = None
    title: str | None = None
    domain: str | None = None
    idle_ms: int = 0
    flags: tuple[str, ...] = ()
    collector: str = ""

    @property
    def duration_ms(self) -> int:
        return max(0, self.ts_end - self.ts_start)

    @property
    def is_activity(self) -> bool:
        return self.kind == "app_focus" and self.app_id is not None

    @property
    def is_barrier(self) -> bool:
        """A lock or a sleep ends any session it falls inside."""
        return self.kind in ("lock", "sleep")


@dataclass(frozen=True)
class Params:
    """Metric parameters. Every value is user-visible and user-editable."""

    idle_threshold_ms: int = 60_000
    merge_gap_ms: int = 90_000
    idle_split_ms: int = 300_000
    focus_min_ms: int = 20 * MINUTE
    focus_gap_ms: int = 5 * MINUTE
    focus_max_apps: int = 2
    short_ms: int = 2 * MINUTE
    break_min_ms: int = 5 * MINUTE
    late_start_hour: int = 22
    late_end_hour: int = 6
    wake_start_hour: int = 7
    wake_end_hour: int = 23
    utc_offset_min: int = 330
    tz: str = "Asia/Kolkata"

    def hash(self) -> str:
        blob = json.dumps(self.__dict__, sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()[:16]

    # ---- timezone helpers (fixed offset; DST is out of scope for the oracle)
    @property
    def tzinfo(self) -> timezone:
        return timezone(timedelta(minutes=self.utc_offset_min))

    def to_local(self, ms: int) -> datetime:
        return datetime.fromtimestamp(ms / 1000, tz=UTC).astimezone(self.tzinfo)

    def to_utc_ms(self, dt: datetime) -> int:
        return int(dt.timestamp() * 1000)

    def day_bounds(self, day: str) -> tuple[int, int]:
        y, m, d = (int(part) for part in day.split("-"))
        start = datetime(y, m, d, tzinfo=self.tzinfo)
        end = start + timedelta(days=1)
        return self.to_utc_ms(start), self.to_utc_ms(end)

    def days_between(self, start: str, end: str) -> list[str]:
        first = date.fromisoformat(start)
        last = date.fromisoformat(end)
        return [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]


def load_events(path: str) -> tuple[list[Event], dict[str, App]]:
    """Read an NDJSON stream of wl.collector.v1 events plus app records."""
    events: list[Event] = []
    apps: dict[str, App] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            rec = json.loads(line)
            if rec.get("type") == "app":
                app = App(
                    id=rec["id"],
                    name=rec["name"],
                    category=rec.get("category"),
                    is_ai_tool=bool(rec.get("is_ai_tool", False)),
                    is_communication=bool(rec.get("is_communication", False)),
                )
                apps[app.id] = app
                continue
            if rec.get("type") not in (None, "event"):
                continue
            events.append(
                Event(
                    id=rec["id"],
                    device_id=rec["device_id"],
                    kind=rec["kind"],
                    ts_start=int(rec["ts_start"]),
                    ts_end=int(rec["ts_end"]),
                    local_date=rec["local_date"],
                    app_id=rec.get("app_id"),
                    title=rec.get("title"),
                    domain=rec.get("domain"),
                    idle_ms=int(rec.get("idle_ms", 0)),
                    flags=tuple(rec.get("flags", ())),
                    collector=rec.get("collector", ""),
                )
            )
    events.sort(key=lambda e: (e.ts_start, e.id))
    return events, apps


def window_events(events: Sequence[Event], start_day: str, end_day: str) -> list[Event]:
    """Events overlapping the half-open window [start_day 00:00, end_day+1 00:00)."""
    lo = start_day
    hi = end_day
    return [e for e in events if lo <= e.local_date <= hi]
