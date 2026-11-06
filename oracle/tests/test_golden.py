"""Golden tests: the fixture corpus against committed facts documents.

These are regression anchors, not ground truth — the hand-computed
expectations live in test_metrics.py and test_detectors.py. Regenerate with:

    REGEN=1 python -m pytest tests/test_golden.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from wl_oracle.facts import build, dumps
from wl_oracle.model import load_events

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
GOLDEN = ROOT / "golden"

CASES = [
    ("desk-5weeks.jsonl", "2026-10-26", "2026-11-01", "L4", "desk-week.facts.json"),
    ("android-week.jsonl", "2026-10-26", "2026-11-01", "L2", "android-week.facts.json"),
    ("edge-cases.jsonl", "2026-10-28", "2026-10-28", "L4", "edge-cases.facts.json"),
]


@pytest.mark.parametrize("fixture,start,end,fidelity,golden_name", CASES)
def test_matches_golden(fixture, start, end, fidelity, golden_name):
    events, apps = load_events(str(FIXTURES / fixture))
    facts = build(events, apps, __import__("wl_oracle.model", fromlist=["Params"]).Params(),
                  start, end, fidelity=fidelity)
    path = GOLDEN / golden_name

    if os.environ.get("REGEN") == "1":
        path.write_text(dumps(facts), encoding="utf-8")
        pytest.skip(f"regenerated {golden_name}")

    expected = json.loads(path.read_text(encoding="utf-8"))
    assert facts == expected


def test_facts_document_shape():
    events, apps = load_events(str(FIXTURES / "desk-5weeks.jsonl"))
    from wl_oracle.model import Params

    facts = build(events, apps, Params(), "2026-10-26", "2026-11-01")

    assert facts["schema"] == "wl.facts.v3"
    assert facts["window"]["tz"] == "Asia/Kolkata"
    assert len(facts["shape"]["by_hour"]) == 24
    assert 0 <= facts["shape"]["peak_hour"] <= 23
    assert facts["coverage"]["fidelity"] == "L4"
    assert 0.0 <= facts["coverage"]["confidence"] <= 1.0
    assert facts["apps"], "expected at least one app row"

    # every pattern must cite evidence and use a known severity
    for pattern in facts["patterns"]:
        assert pattern["id"].startswith("D")
        assert pattern["severity"] in {"high", "medium", "positive", "info"}
        assert pattern["evidence"]


def test_facts_carry_no_prose_fields():
    """The document handed to the model must stay numbers and identifiers."""
    events, apps = load_events(str(FIXTURES / "desk-5weeks.jsonl"))
    from wl_oracle.model import Params

    facts = build(events, apps, Params(), "2026-10-26", "2026-11-01")
    allowed = {"schema", "window", "coverage", "totals", "shape", "days", "apps",
               "clusters", "patterns", "goals", "notes", "meta"}
    assert set(facts) <= allowed
