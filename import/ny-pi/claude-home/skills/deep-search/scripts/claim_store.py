#!/usr/bin/env python3
"""Cross-session store of verified research claims (deep-search ledger rows) with an as-of date and a TTL.

add LEDGER.json|- [--topic T] [--as-of YYYY-MM-DD]: append ledger rows whose verdict is supported or partial.
find TERM... [--fresh] [--limit N]: newest row per (url, quote) matching every term, with `stale` and `age_days`.

The store is append-only JSONL shared by Claude Code and pi: $RESEARCH_CLAIMS_FILE, else
~/.local/share/research-claims/claims.jsonl. TTL by `ttl_class`: volatile (versions, prices, news,
benchmarks) 14 days, docs 90, archival (papers, dated law) 365; a row's `ttl_days` overrides.
ponytail: flat JSONL scanned per query; move to SQLite FTS or a graph store past ~10k rows.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys

TTL_DAYS = {"volatile": 14, "docs": 90, "archival": 365}
KEPT = {"supported", "partial"}
REQUIRED = ("claim", "url", "quote", "verdict", "origin_root")
FIELDS = ("claim", "url", "quote", "verdict", "origin_root", "provider", "source_type", "published",
          "fetched_at", "sha256", "caveat")


def default_store():
    env = os.environ.get("RESEARCH_CLAIMS_FILE")
    return Path(env) if env else Path.home() / ".local/share/research-claims/claims.jsonl"


def key(url, quote):
    return hashlib.sha256(f"{url}\n{quote}".encode()).hexdigest()[:16]


def load(store):
    """Newest row per key; later lines win, so a re-check refreshes as_of and verdict."""
    rows = {}
    if store.is_file():
        for line in store.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and "key" in item:
                rows[item["key"]] = item
    return rows


def skip_reason(item):
    missing = [f for f in REQUIRED if not isinstance(item.get(f), str) or not item[f].strip()]
    if missing:
        return "missing " + ", ".join(missing)
    if item["verdict"] not in KEPT:
        return f"verdict {item['verdict']}"
    if not item["url"].startswith(("http://", "https://")):
        return "non-http url"
    return None


def add(items, store, as_of, topic):
    known, added, skipped, lines = load(store), 0, [], []
    for item in items:
        reason = skip_reason(item) if isinstance(item, dict) else "not an object"
        if reason:
            skipped.append({"id": item.get("id") if isinstance(item, dict) else None, "reason": reason})
            continue
        k = key(item["url"], item["quote"])
        old = known.get(k)
        if old and old["as_of"] >= as_of and old["verdict"] == item["verdict"]:
            continue
        ttl = item.get("ttl_days")
        ttl = ttl if isinstance(ttl, int) and ttl > 0 else TTL_DAYS.get(str(item.get("ttl_class")), TTL_DAYS["docs"])
        record = {"key": k, **{f: item[f] for f in FIELDS if item.get(f) is not None},
                  "topic": topic or item.get("topic") or "", "as_of": as_of, "ttl_days": ttl}
        known[k] = record
        lines.append(json.dumps(record, ensure_ascii=False))
        added += 1
    if lines:
        store.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(store, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as out:
            out.write("\n".join(lines) + "\n")
    return {"added": added, "skipped": skipped, "store": str(store)}


def find(terms, store, today, fresh, limit):
    terms = [t.lower() for t in terms]
    hits = []
    for record in load(store).values():
        text = " ".join(str(record.get(f, "")) for f in ("claim", "quote", "topic", "origin_root", "url")).lower()
        if not all(t in text for t in terms):
            continue
        age = (today - dt.date.fromisoformat(record["as_of"])).days
        hit = {**record, "age_days": age, "stale": age > record["ttl_days"]}
        if not (fresh and hit["stale"]):
            hits.append(hit)
    hits.sort(key=lambda h: h["as_of"], reverse=True)
    return hits[:limit]


def main(argv=None, stdin=None, stdout=None, today=None):
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    today = today or dt.date.today()
    ap = argparse.ArgumentParser(prog="claim_store.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("ledger")
    a.add_argument("--topic", default="")
    a.add_argument("--as-of", default=today.isoformat())
    a.add_argument("--store", type=Path)
    f = sub.add_parser("find")
    f.add_argument("terms", nargs="+")
    f.add_argument("--fresh", action="store_true")
    f.add_argument("--limit", type=int, default=20)
    f.add_argument("--store", type=Path)
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return 2
    store = args.store or default_store()
    try:
        if args.cmd == "find":
            for hit in find(args.terms, store, today, args.fresh, args.limit):
                stdout.write(json.dumps(hit, ensure_ascii=False) + "\n")
            return 0
        dt.date.fromisoformat(args.as_of)
        raw = stdin.read() if args.ledger == "-" else Path(args.ledger).read_text(encoding="utf-8")
        items = json.loads(raw)
        if not isinstance(items, list):
            raise ValueError("ledger must be a JSON list of claim rows")
    except (OSError, ValueError) as exc:
        json.dump({"error": str(exc)}, stdout)
        return 2
    json.dump(add(items, store, args.as_of, args.topic), stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
