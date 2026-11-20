"""Cruza perdas totais de cache do pi (cacheRead == 0 no meio da sessão) com a sonda de prefixo, para achar o gatilho.

Uso: python3 cache_probe_join.py [desde, AAAA-MM-DD]. Só leitura: ~/.pi/agent/sessions e ~/.cache/pi-cache-probe.
Spec: claude-home/docs/pi-memory-cache-sota-2026-11-13.md (passo 6). Uma linha JSON por perda, ordenada pela pausa;
`trigger` resume a causa: compaction, model_change, tools_changed (modo plano etc.), prefix_diff ou provider (prefixo
idêntico, perda do lado do provedor).
"""
import bisect
import glob
import json
import os
import sys
from datetime import datetime

MIN_WRITE = 5000  # tokens: abaixo disso é preâmbulo pequeno, não perda de contexto


def ts(value) -> float:
    if isinstance(value, (int, float)):
        return value / 1000
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def trigger(events: list[str], probe: dict | None) -> str:
    if any(e.startswith('compaction') for e in events):
        return 'compaction'
    if any(e.startswith('model_change') for e in events):
        return 'model_change'
    if probe and probe.get('first'):
        return 'session_restart'
    if probe and (probe.get('toolsChanged') or probe.get('systemChanged')):
        return 'tools_changed'
    if probe and probe.get('firstDiff') is not None:
        return 'prefix_diff'
    return 'provider' if probe else 'unknown'


def losses(lines, probes: list[tuple[float, dict]], since: str) -> list[dict]:
    """lines: entradas JSON de um arquivo de sessão; probes: (tempo, registro) da sonda dessa sessão, ordenados."""
    out, seen, last_t, events = [], False, None, []
    times = [p[0] for p in probes]
    for e in lines:
        if e.get('type') != 'message':
            events.append(f"{e.get('type')}:{e.get('customType', '')}")
            continue
        m = e.get('message') or {}
        if m.get('role') != 'assistant' or not m.get('usage'):
            events.append(f"msg:{m.get('role')}")
            continue
        u, t = m['usage'], ts(e['timestamp'])
        if seen and str(e['timestamp']) >= since and u.get('cacheRead', 0) == 0 and u.get('cacheWrite', 0) > MIN_WRITE:
            i = bisect.bisect_right(times, t) - 1
            probe = probes[i][1] if i >= 0 and t - probes[i][0] < 600 else None
            out.append({'gap_min': round((t - last_t) / 60, 1), 'cost': round((u.get('cost') or {}).get('total', 0), 2),
                        'model': m.get('model'), 'trigger': trigger(events, probe), 'before': events[-4:]})
        seen, last_t, events = True, t, []
    return out


def main() -> int:
    since = sys.argv[1] if len(sys.argv) > 1 else '2026-11-13'
    probes: dict[str, list] = {}
    for f in glob.glob(os.path.expanduser('~/.cache/pi-cache-probe/*.jsonl')):
        for line in open(f):
            try:
                r = json.loads(line)
                probes.setdefault(r.get('session'), []).append((ts(r['t']), r))
            except (ValueError, KeyError):
                continue
    for v in probes.values():
        v.sort(key=lambda p: p[0])
    rows = []
    for f in glob.glob(os.path.expanduser('~/.pi/agent/sessions/**/*.jsonl'), recursive=True):
        if os.path.getmtime(f) < ts(since + 'T00:00:00+00:00'):
            continue
        entries = []
        for line in open(f):
            try:
                entries.append(json.loads(line))
            except ValueError:
                continue
        sid = next((e.get('id') for e in entries if e.get('type') == 'session'), None)
        rows += losses([e for e in entries if e.get('type') != 'session'], probes.get(sid, []), since)
    for row in sorted(rows, key=lambda r: r['gap_min']):
        print(json.dumps(row))
    by: dict[str, list] = {}
    for row in rows:
        by.setdefault(row['trigger'], []).append(row['cost'])
    print(json.dumps({'summary': {k: {'n': len(v), 'cost': round(sum(v), 2)} for k, v in sorted(by.items())}}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
