"""Sundial reference implementation (oracle).

This package is the executable specification of the metric engine. The Rust
core is validated against the golden files it produces; see
docs/adr/0003-reference-implementation.md.
"""

from .facts import ALGO_VERSION, SCHEMA, build, dumps  # noqa: F401
from .metrics import compute  # noqa: F401
from .model import App, Event, Params, load_events  # noqa: F401

__all__ = ["ALGO_VERSION", "SCHEMA", "build", "dumps", "compute", "App", "Event", "Params", "load_events"]
