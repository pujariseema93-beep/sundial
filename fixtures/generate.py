"""Deterministic fixture generator.

The fixtures are synthetic but shaped like real capture: a five-week desktop
stream with a deliberate late-night drift and fragmentation spike in the
final week, a one-week Android stream with no window titles (L2), and a
hand-built edge-case day. Re-running this script must produce byte-identical
output, which is what makes the golden files meaningful.
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta, timezone

TZ = timezone(timedelta(minutes=330))
MIN = timedelta(minutes=1)
SEC = timedelta(seconds=1)

APPS_DESK = [
    {"id": "vscode", "name": "Visual Studio Code", "category": "development"},
    {"id": "terminal", "name": "Terminal", "category": "development"},
    {"id": "chrome", "name": "Google Chrome", "category": "browser"},
    {"id": "slack", "name": "Slack", "category": "communication", "is_communication": True},
    {"id": "mail", "name": "Mail", "category": "communication", "is_communication": True},
    {"id": "claude", "name": "Claude", "category": "ai", "is_ai_tool": True},
    {"id": "figma", "name": "Figma", "category": "design"},
]

APPS_PHONE = [
    {"id": "instagram", "name": "Instagram", "category": "social"},
    {"id": "whatsapp", "name": "WhatsApp", "category": "communication", "is_communication": True},
    {"id": "chrome-m", "name": "Chrome", "category": "browser"},
    {"id": "youtube", "name": "YouTube", "category": "video"},
]

TITLES = {
    "vscode": [
        "wl-core/src/metrics.rs — sundial",
        "wl-core/src/intervals.rs — sundial",
        "oracle/wl_oracle/facts.py — sundial",
        "README.md — sundial",
    ],
    "terminal": ["zsh — cargo test", "zsh — git status"],
    "chrome": [
        "Rust std::collections — docs",
        "HDBSCAN parameters explained",
        "SQLite WAL mode — documentation",
    ],
    "slack": ["#sundial-dev — Slack", "#design — Slack"],
    "mail": ["Inbox — Mail", "Weekly review — Mail"],
    "claude": ["Claude — refactor help", "Claude — schema review"],
    "figma": ["Sundial dashboard — Figma"],
}


def utc_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


class Emitter:
    def __init__(self, device_id: str, collector: str, seed: int):
        self.device_id = device_id
        self.collector = collector
        self.rng = random.Random(seed)
        self.rows: list[dict] = []
        self.counter = 0

    def event(self, start: datetime, minutes: float, app: str, idle_ms: int = 0, title: str | None = None) -> None:
        self.counter += 1
        end = start + timedelta(minutes=minutes)
        row = {
            "type": "event",
            "id": f"{self.device_id}-{self.counter:05d}",
            "device_id": self.device_id,
            "kind": "app_focus",
            "ts_start": utc_ms(start),
            "ts_end": utc_ms(end),
            "local_date": start.date().isoformat(),
            "app_id": app,
            "idle_ms": idle_ms,
            "collector": self.collector,
        }
        if title:
            row["title"] = title
        self.rows.append(row)

    def barrier(self, start: datetime, minutes: float, kind: str = "lock") -> None:
        self.counter += 1
        end = start + timedelta(minutes=minutes)
        self.rows.append(
            {
                "type": "event",
                "id": f"{self.device_id}-{self.counter:05d}",
                "device_id": self.device_id,
                "kind": kind,
                "ts_start": utc_ms(start),
                "ts_end": utc_ms(end),
                "local_date": start.date().isoformat(),
                "collector": self.collector,
            }
        )


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


def desk_day(em: Emitter, day: date, week_index: int) -> None:
    """A working day. Later weeks drift later and fragment more."""
    rng = em.rng
    weekday = day.weekday()
    drift = 0 if week_index < 3 else (week_index - 2) * 25  # minutes later, week 4+
    fragment = week_index >= 3

    if weekday >= 5:  # weekend: lighter, later, more browsing
        start = at(day, 11, 10)
        em.event(start, 35, "chrome", title=rng.choice(TITLES["chrome"]))
        em.event(start + 40 * MIN, 25, "figma", title=TITLES["figma"][0])
        em.event(start + 80 * MIN, 45, "youtube" if False else "chrome", title=TITLES["chrome"][1])
        em.event(start + 140 * MIN, 20, "slack", title=TITLES["slack"][1])
        return

    # morning block
    cursor = at(day, 9, 5) + timedelta(minutes=drift)
    em.event(cursor, 95, "vscode", idle_ms=rng.choice([0, 0, 90_000]), title=rng.choice(TITLES["vscode"]))
    cursor += 95 * MIN + 18 * SEC
    em.event(cursor, 8, "slack", title=rng.choice(TITLES["slack"]))
    cursor += 8 * MIN + 12 * SEC
    em.event(cursor, 80, "vscode", title=rng.choice(TITLES["vscode"]))
    cursor += 80 * MIN + 25 * SEC
    if fragment:
        for _ in range(5):
            em.event(cursor, 1.5, "slack", title=TITLES["slack"][0])
            cursor += 1.5 * MIN + 15 * SEC
            em.event(cursor, 2.5, "chrome", title=rng.choice(TITLES["chrome"]))
            cursor += 2.5 * MIN + 15 * SEC
    else:
        em.event(cursor, 20, "chrome", title=rng.choice(TITLES["chrome"]))
        cursor += 20 * MIN + 30 * SEC

    # lunch gap, then afternoon
    cursor = at(day, 14, 0) + timedelta(minutes=drift)
    em.event(cursor, 100, "vscode", title=rng.choice(TITLES["vscode"]))
    cursor += 100 * MIN + 20 * SEC
    em.event(cursor, 12, "slack", title=TITLES["slack"][1])
    cursor += 12 * MIN + 20 * SEC
    em.event(cursor, 70, "vscode", title=rng.choice(TITLES["vscode"]))
    cursor += 70 * MIN + 15 * SEC
    em.event(cursor, 18, "claude", title=rng.choice(TITLES["claude"]))
    cursor += 18 * MIN + 20 * SEC
    em.event(cursor, 15, "mail", title=TITLES["mail"][0])
    cursor += 15 * MIN + 20 * SEC
    em.event(cursor, 25, "terminal", title=TITLES["terminal"][0])

    # late-night drift in the final two weeks, deterministically on Mon-Thu
    if week_index >= 3 and weekday in (0, 1, 2, 3):
        late = at(day, 22, 20)
        em.event(late, 45, "vscode", title=TITLES["vscode"][2])
        em.event(late + 45 * MIN + 20 * SEC, 30, "claude", title=TITLES["claude"][1])
        em.event(late + 75 * MIN + 40 * SEC, 20, "chrome", title=TITLES["chrome"][2])

    # one long unbroken session a week: exercises break-debt and focus blocks
    if weekday == 2:
        em.event(at(day, 15, 30), 150, "vscode", title=TITLES["vscode"][0])


def phone_day(em: Emitter, day: date) -> None:
    rng = em.rng
    # no titles anywhere: this is what L2 actually looks like
    em.event(at(day, 7, 40), 6, "instagram")
    em.event(at(day, 7, 46, ) + 20 * SEC, 3, "whatsapp")
    em.event(at(day, 12, 30), 9, "youtube")
    em.event(at(day, 12, 39) + 15 * SEC, 4, "whatsapp")
    em.event(at(day, 12, 43) + 30 * SEC, 1.5, "instagram")
    em.event(at(day, 18, 10), 14, "instagram")
    em.event(at(day, 18, 24) + 20 * SEC, 5, "whatsapp")
    em.event(at(day, 21, 5), 28, "youtube")
    em.event(at(day, 21, 33) + 25 * SEC, 7, "instagram")
    if rng.random() < 0.5:
        em.event(at(day, 23, 10), 11, "youtube")


def build_desk(path: str) -> None:
    start = date(2026, 9, 28)
    em = Emitter("dev-desk-1", "windows-win32@1.4.2", seed=7)
    rows = [{"type": "app", **app} for app in APPS_DESK]
    for offset in range(35):  # five weeks
        day = start + timedelta(days=offset)
        desk_day(em, day, offset // 7)
    em.rows.sort(key=lambda r: (r["ts_start"], r["id"]))
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows + em.rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_phone(path: str) -> None:
    start = date(2026, 10, 26)
    em = Emitter("dev-phone-1", "android-usagestats@1.0.0", seed=11)
    rows = [{"type": "app", **app} for app in APPS_PHONE]
    for offset in range(7):
        phone_day(em, start + timedelta(days=offset))
    em.rows.sort(key=lambda r: (r["ts_start"], r["id"]))
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows + em.rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_edges(path: str) -> None:
    """Hand-built cases the engine must survive."""
    em = Emitter("dev-edge-1", "test-harness@0.0.0", seed=1)
    day = date(2026, 10, 28)
    rows = [{"type": "app", **app} for app in APPS_DESK]

    # 1. a session that spans midnight (23:40 -> 00:30 next day)
    em.event(at(day, 23, 40), 50, "vscode", title="late session")

    # 2. a long idle period: only the first 60 s beyond the threshold is lost
    em.event(at(day, 10, 0), 45, "vscode", idle_ms=40 * 60_000, title="reading, then gone")

    # 3. a lock in the middle of a gap: must split two sessions
    em.event(at(day, 14, 0), 20, "chrome", title="before lock")
    em.barrier(at(day, 14, 21), 2)
    em.event(at(day, 14, 25), 20, "chrome", title="after lock")

    # 4. a zero-length event: ignored, never counted
    em.event(at(day, 16, 0), 0, "mail")

    # 5. two events on different apps overlapping by 5 minutes
    em.event(at(day, 17, 0), 30, "figma", title="design")
    em.event(at(day, 17, 25), 20, "slack", title="interrupt")

    # 6. a six-hour gap in the middle of the day
    em.event(at(day, 8, 0), 15, "terminal", title="morning")
    em.event(at(day, 20, 30), 15, "claude", title="evening")

    em.rows.sort(key=lambda r: (r["ts_start"], r["id"]))
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows + em.rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_desk(os.path.join(here, "fixtures", "desk-5weeks.jsonl"))
    build_phone(os.path.join(here, "fixtures", "android-week.jsonl"))
    build_edges(os.path.join(here, "fixtures", "edge-cases.jsonl"))
    print("fixtures written")
