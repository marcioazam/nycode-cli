"""compaction_restart.py: how much of the main-thread prompt traffic is context re-sent after a compaction (pi sessions).

Run: python3 ~/.pi/agent/claude-home/skills/context-economy/scripts/compaction_restart.py [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]

Reads pi main-session files (~/.pi/agent/sessions/*/*.jsonl, aggregates only; subagents run with --no-session, so
every file there is a main session). A request's prompt is input plus cacheRead plus cacheWrite tokens of an assistant
message; the restart size is the prompt of the first request after a `compaction` entry, and every later request of
that segment carries min(prompt, restart) of restart context. restart_share is that carried context over all prompt
tokens in the window. A high restart_share is expected near the cost-optimal window, so it is no decision by itself;
the lever is the restart size, compared before and after a prefix change. pi records no auto/manual trigger, so
`under_window` counts compactions whose tokensBefore is at most 110% of --window (the 250k threshold set by
compaction.modelOverrides in ~/.pi/agent/settings.json and ~/.pi/agent/extensions/compact-at-400k.ts). Entries are read
in file order (a session file with /tree branches is treated as one stream). Dates are UTC days; --until is exclusive.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _day(text: str) -> str:
    try:
        return datetime.strptime(text, '%Y-%m-%d').strftime('%Y-%m-%d')
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f'expected YYYY-MM-DD, got {text!r}') from exc


def _parser() -> argparse.ArgumentParser:
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d')
    parser = argparse.ArgumentParser(description='Share of main-thread prompt tokens that is post-compaction restart.')
    parser.add_argument('--since', type=_day, default=week_ago, help='first UTC day (default: 7 days ago)')
    parser.add_argument('--until', type=_day, help='UTC day to stop before (default: no end)')
    parser.add_argument('--window', type=int, default=int(os.environ.get('PI_COMPACT_AT', '250000')),
                        help='compaction threshold being evaluated (default: PI_COMPACT_AT or 250000)')
    parser.add_argument('--sessions', type=Path, default=Path.home() / '.pi' / 'agent' / 'sessions',
                        help='pi sessions directory (default: ~/.pi/agent/sessions)')
    parser.add_argument('--json', action='store_true', help='print JSON instead of text')
    return parser


def main_transcripts(sessions: Path, since: str) -> list[str]:
    """Session files modified on or after the since day; each real file once (links count once)."""
    cutoff = datetime.strptime(since, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
    seen, found = set(), []
    for path in sorted(glob.glob(os.path.join(glob.escape(str(sessions)), '*', '*.jsonl'))):
        real = os.path.realpath(path)
        try:
            if real in seen or os.path.getmtime(real) < cutoff:
                continue
        except OSError:
            continue  # dangling link or a file removed after the glob
        seen.add(real)
        found.append(real)
    return found


def _prompt(usage: dict) -> int:
    return sum(int(usage.get(k) or 0) for k in ('input', 'cacheRead', 'cacheWrite'))


def measure(files: list[str], since: str, until: str | None, window: int) -> dict:
    """Aggregate requests and compactions in [since, until); response and compaction ids count once across copies."""
    in_window = lambda ts: ts[:10] >= since and (until is None or ts[:10] < until)  # noqa: E731
    seen_msgs, seen_bounds = set(), set()
    prompt_total = restart_total = requests = compactions = under_window = 0
    restarts, pres = [], []
    for path in files:
        restart, pending, counted = None, False, False
        with open(path, encoding='utf-8', errors='replace') as stream:
            for line in stream:
                if '"compaction"' not in line and '"usage"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                ts = str(row.get('timestamp') or '')
                if row.get('type') == 'compaction':
                    uid = row.get('id')
                    # A forked or copied session repeats the entry: its segment still needs a restart size, counted once.
                    restart, pending, counted = None, True, uid not in seen_bounds and in_window(ts)
                    seen_bounds.add(uid)
                    if counted:
                        compactions += 1
                        pre = int(row.get('tokensBefore') or 0)
                        pres.append(pre)
                        # shortcut: 10% slack over the window marks a compaction that the threshold triggered.
                        under_window += 0 < pre <= window * 1.1
                    continue
                if row.get('type') != 'message':
                    continue
                msg = row.get('message') or {}
                if msg.get('role') != 'assistant' or not isinstance(msg.get('usage'), dict):
                    continue
                mid = msg.get('responseId') or row.get('id')
                if not mid:
                    continue
                prompt = _prompt(msg['usage'])
                if prompt <= 0:
                    continue  # aborted or synthetic reply without a provider request
                if pending:
                    restart, pending = prompt, False
                    if counted:
                        restarts.append(prompt)
                if mid in seen_msgs or not in_window(ts):
                    continue
                seen_msgs.add(mid)
                requests += 1
                prompt_total += prompt
                restart_total += min(prompt, restart) if restart is not None else 0
    pct = lambda values, q: sorted(values)[min(len(values) - 1, int(q * len(values)))] if values else None  # noqa: E731
    return {'since': since, 'until': until, 'window': window, 'files': len(files), 'requests': requests,
            'prompt_tokens': prompt_total, 'restart_tokens': restart_total,
            'restart_share': round(restart_total / prompt_total, 4) if prompt_total else None,
            'compactions': compactions, 'under_window': under_window,
            'pre_tokens_p50': int(statistics.median(pres)) if pres else None,
            'restart_p50': pct(restarts, 0.5), 'restart_p90': pct(restarts, 0.9)}


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    report = measure(main_transcripts(args.sessions, args.since), args.since, args.until, args.window)
    if args.json:
        print(json.dumps(report))
        return 0
    print(f"{report['since']}..{report['until'] or 'now'} | {report['requests']} main requests, "
          f"{report['prompt_tokens']:,} prompt tokens | compactions {report['compactions']} (at most "
          f"{args.window:,}: {report['under_window']}) | pre p50 {report['pre_tokens_p50']} | "
          f"restart p50/p90 {report['restart_p50']}/{report['restart_p90']} | restart_share {report['restart_share']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
