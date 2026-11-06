"""Command line entry point for the oracle.

    wl-oracle facts fixtures/desk-5weeks.jsonl --start 2026-10-26 --end 2026-11-01
    wl-oracle facts ... --baseline-weeks 4 --out golden/desk.facts.json
"""

from __future__ import annotations

import argparse
import json
import sys

from .facts import build, dumps
from .metrics import compute
from .model import MINUTE, Params, load_events


def _params(args) -> Params:
    return Params(
        idle_threshold_ms=args.idle_threshold_s * 1000,
        merge_gap_ms=args.merge_gap_s * 1000,
        idle_split_ms=args.idle_split_s * 1000,
        utc_offset_min=args.utc_offset_min,
        tz=args.tz,
    )


def cmd_facts(args) -> int:
    events, apps = load_events(args.path)
    params = _params(args)
    facts = build(
        events,
        apps,
        params,
        args.start,
        args.end,
        fidelity=args.fidelity,
        baseline_weeks=args.baseline_weeks,
    )
    text = dumps(facts)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


def cmd_sessions(args) -> int:
    events, apps = load_events(args.path)
    window = compute(events, apps, _params(args), args.start, args.end)
    rows = [
        {
            "app": apps[s.app_id].name if s.app_id in apps else s.app_id,
            "start": s.start,
            "end": s.end,
            "active_min": round(s.active_ms / MINUTE, 1),
            "day": s.local_date,
        }
        for s in window.sessions
    ]
    print(json.dumps(rows, indent=2))
    return 0


def cmd_stats(args) -> int:
    events, apps = load_events(args.path)
    window = compute(events, apps, _params(args), args.start, args.end)
    print(f"active_h      {window.active_hours:.1f}")
    print(f"sessions      {len(window.sessions)}")
    print(f"switches/h    {window.switches_per_hour:.1f}")
    print(f"late_night    {window.late_night_share:.2f}")
    print(f"short_share   {window.short_session_share:.2f}")
    print(f"focus_h       {window.focus_hours:.1f}")
    print(f"ai_share      {window.ai_share:.2f}")
    print(f"coverage      {window.coverage:.2f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="wl-oracle", description="Sundial metric oracle")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p):
        p.add_argument("path", help="NDJSON fixture or collector stream")
        p.add_argument("--start", required=True, help="first local date, YYYY-MM-DD")
        p.add_argument("--end", required=True, help="last local date, inclusive")
        p.add_argument("--idle-threshold-s", type=int, default=60)
        p.add_argument("--merge-gap-s", type=int, default=90)
        p.add_argument("--idle-split-s", type=int, default=300)
        p.add_argument("--utc-offset-min", type=int, default=330)
        p.add_argument("--tz", default="Asia/Kolkata")

    p_facts = sub.add_parser("facts", help="emit the wl.facts.v3 document")
    add_common(p_facts)
    p_facts.add_argument("--fidelity", default="L4", choices=["L0", "L1", "L2", "L3", "L4"])
    p_facts.add_argument("--baseline-weeks", type=int, default=4)
    p_facts.add_argument("--out", help="write to a file instead of stdout")
    p_facts.set_defaults(func=cmd_facts)

    p_sessions = sub.add_parser("sessions", help="list sessions")
    add_common(p_sessions)
    p_sessions.set_defaults(func=cmd_sessions)

    p_stats = sub.add_parser("stats", help="print headline metrics")
    add_common(p_stats)
    p_stats.set_defaults(func=cmd_stats)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
