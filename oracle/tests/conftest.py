"""Shared helpers: build events in memory without touching the fixtures."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from wl_oracle.model import App, Event, Params

TZ = timezone(timedelta(minutes=330))

APPS = {
    "code": App(id="code", name="Code"),
    "chat": App(id="chat", name="Chat", is_communication=True),
    "ai": App(id="ai", name="Assistant", is_ai_tool=True),
    "web": App(id="web", name="Browser"),
}


def dt(day: str, hour: int, minute: int = 0, second: int = 0) -> datetime:
    y, m, d = (int(p) for p in day.split("-"))
    return datetime(y, m, d, hour, minute, second, tzinfo=TZ)


def ev(
    app: str,
    start: datetime,
    minutes: float,
    idle_ms: int = 0,
    kind: str = "app_focus",
    idx: int = 0,
) -> Event:
    end = start + timedelta(minutes=minutes)
    return Event(
        id=f"e{idx:03d}",
        device_id="dev-test",
        kind=kind,
        ts_start=int(start.timestamp() * 1000),
        ts_end=int(end.timestamp() * 1000),
        local_date=start.date().isoformat(),
        app_id=app if kind == "app_focus" else None,
        idle_ms=idle_ms,
    )


@pytest.fixture
def params() -> Params:
    return Params()


@pytest.fixture
def apps() -> dict[str, App]:
    return APPS
