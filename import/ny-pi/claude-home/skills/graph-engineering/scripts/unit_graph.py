#!/usr/bin/env python3
"""Check and derive a unit graph for multi-lane delegation (stdlib only, JSON to stdout).

check UNITS.json    waves, critical path, width, warnings; exit 0 ok, 1 graph errors
suggest UNITS.json  `after` edges derived from a codegraph SQLite index, opened read-only
Exit 2 means invalid input (unreadable JSON, wrong shape, missing or broken database).
A unit is {id, goal, files: [], after?: [], tier?, acceptance?, agent?, risk?}.
"""
import argparse
import json
import posixpath
import sqlite3
import sys
from collections import defaultdict
from contextlib import closing
from functools import lru_cache
from pathlib import Path

DEFAULT_KINDS = "calls,imports,references,extends,instantiates"
MAX_FILES = 8


class InputError(Exception):
    """Unreadable or structurally invalid input (exit 2)."""


@lru_cache(maxsize=None)
def norm(path: str, root: str | None = None) -> str:
    """Repo-relative POSIX path: strip `./`, collapse separators, drop an absolute root prefix."""
    p = path.strip().replace("\\", "/")
    if root:
        prefix = root.rstrip("/") + "/"
        if p.startswith(prefix):
            p = p[len(prefix):]
    return posixpath.normpath(p)


def load_units(path: str) -> list[dict]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise InputError(f"cannot read {path}: {e}") from e
    if isinstance(data, dict):
        data = data.get("units")
    if not isinstance(data, list) or not all(isinstance(u, dict) for u in data):
        raise InputError("expected a JSON list of unit objects or an object with a `units` list")
    return data


def unit_files(u: dict, root: str | None = None) -> list[str] | None:
    f = u.get("files")
    if isinstance(f, list) and f and all(isinstance(x, str) and x.strip() for x in f):
        return [norm(x, root) for x in f]
    return None


def find_cycle(deps: dict[str, list[str]]) -> list[str] | None:
    """First cycle as [x, ..., x]; each element is `after` the next one."""
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        state[n] = 1
        stack.append(n)
        for d in deps[n]:
            if state.get(d) == 1:
                return stack[stack.index(d):] + [d]
            if d not in state and (cyc := visit(d)):
                return cyc
        state[n] = 2
        stack.pop()
        return None

    for n in deps:
        if n not in state and (cyc := visit(n)):
            return cyc
    return None


def schedule(deps: dict[str, list[str]]) -> tuple[list[list[str]], list[str]]:
    """Topological layers (producers first) and the longest `after` chain; deps must be acyclic."""
    level: dict[str, int] = {}

    def lv(n: str) -> int:
        if n not in level:
            level[n] = 1 + max((lv(d) for d in deps[n]), default=-1)
        return level[n]

    for n in deps:
        lv(n)
    waves = [[n for n in deps if level[n] == k] for k in range(max(level.values(), default=-1) + 1)]
    path = [max(deps, key=lambda n: level[n])] if deps else []
    while path and deps[path[0]]:
        path.insert(0, max(deps[path[0]], key=lambda n: level[n]))
    return waves, path


def analyze(units: list[dict], max_units: int, max_writers: int) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    owner: dict[str, str] = {}
    deps: dict[str, list[str]] = {}
    ids = {u["id"] for u in units if isinstance(u.get("id"), str) and u["id"]}
    seen: set[str] = set()
    if len(units) > max_units:
        errors.append(f"{len(units)} units exceed max {max_units}")
    for i, u in enumerate(units):
        uid = u.get("id")
        has_id = isinstance(uid, str) and bool(uid)
        label = uid if has_id else f"#{i}"
        if not has_id:
            errors.append(f"unit {label}: missing id")
        elif label in seen:
            errors.append(f"duplicate id {label}")
        seen.add(label)
        files = unit_files(u)
        if files is None:
            errors.append(f"unit {label}: missing or invalid files")
        else:
            if len(files) > MAX_FILES:
                warnings.append(f"unit {label}: {len(files)} files, over {MAX_FILES}")
            for f in files:
                if owner.setdefault(f, label) != label:
                    errors.append(f"file {f} owned by {owner[f]} and {label}")
        if not u.get("acceptance"):
            warnings.append(f"unit {label}: no acceptance")
        after = u.get("after", [])
        if not isinstance(after, list) or not all(isinstance(a, str) for a in after):
            errors.append(f"unit {label}: after must be a list of ids")
            after = []
        edges = deps.setdefault(label, [])
        for a in after:
            if a == uid:
                errors.append(f"unit {label}: after names itself")
            elif a not in ids:
                errors.append(f"unit {label}: after names unknown id {a}")
            elif a not in edges:
                edges.append(a)
    waves: list[list[str]] = []
    path: list[str] = []
    if cycle := find_cycle(deps):
        errors.append("cycle: " + " after ".join(cycle))
    else:
        waves, path = schedule(deps)
    warnings += [f"wave {k + 1} has {len(w)} units, over max-writers {max_writers}"
                 for k, w in enumerate(waves) if len(w) > max_writers]
    return {"ok": not errors, "errors": errors, "waves": waves, "critical_path": path,
            "width": max(map(len, waves), default=0), "warnings": warnings}


def suggest(units: list[dict], db: str, kinds: list[str], root: str | None) -> dict:
    owner: dict[str, str] = {}
    existing: dict[str, list[str]] = {}
    for i, u in enumerate(units):
        uid, files, after = u.get("id"), unit_files(u, root), u.get("after", [])
        if not isinstance(uid, str) or not uid or files is None:
            raise InputError(f"unit #{i}: needs id and files (run check)")
        if not isinstance(after, list) or not all(isinstance(a, str) for a in after):
            raise InputError(f"unit {uid}: after must be a list of ids")
        existing[uid] = after
        for f in files:
            owner.setdefault(f, uid)
    if not kinds:
        raise InputError("--kinds is empty")
    if not Path(db).is_file():
        raise InputError(f"no such database: {db}")
    counts: dict[tuple[str, str], int] = defaultdict(int)
    example: dict[tuple[str, str], str] = {}
    try:
        with closing(sqlite3.connect(Path(db).resolve().as_uri() + "?mode=ro", uri=True)) as con:
            indexed = {norm(r[0], root) for r in con.execute("select distinct file_path from nodes")}
            rows = con.execute(
                "select s.file_path, t.file_path, s.qualified_name, t.qualified_name, e.line "
                "from edges e join nodes s on s.id = e.source join nodes t on t.id = e.target "
                f"where e.kind in ({','.join('?' * len(kinds))}) and s.file_path <> t.file_path order by e.id", kinds)
            for sf, tf, sq, tq, line in rows:
                sf, tf = norm(sf, root), norm(tf, root)
                b, a = owner.get(sf), owner.get(tf)  # source file in B, target file in A: B after A
                if b and a and b != a:
                    counts[b, a] += 1
                    example.setdefault((b, a), f"{sq} -> {tq} ({sf}:{line})" if line else f"{sq} -> {tq} ({sf})")
    except sqlite3.Error as e:
        raise InputError(f"codegraph database {db}: {e}") from e
    mutual, evidence, added = [], [], defaultdict(list)
    for b, a in sorted(counts):
        if (a, b) in counts:
            if b < a:
                mutual.append({"units": [b, a], "edges": {f"{b} after {a}": counts[b, a], f"{a} after {b}": counts[a, b]},
                               "example": example[b, a]})
            continue
        evidence.append({"unit": b, "after": a, "edges": counts[b, a], "example": example[b, a]})
        if a not in existing[b]:
            added[b].append(a)
    out_units = []
    for u in units:
        o = {**u, "files": unit_files(u, root)}
        after = [*existing[u["id"]], *added.get(u["id"], [])]
        if after:
            o["after"] = after
        out_units.append(o)
    return {"units": out_units, "suggested_after": dict(added), "evidence": evidence, "mutual": mutual,
            "unindexed": sorted(f for f in owner if f not in indexed)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="validate the graph and print waves and critical path")
    c.add_argument("units")
    c.add_argument("--max-units", type=int, default=12)
    c.add_argument("--max-writers", type=int, default=4)  # pi subagent: 4 concurrent per parallel call
    s = sub.add_parser("suggest", help="derive `after` edges from a codegraph index")
    s.add_argument("units")
    s.add_argument("--db", required=True, help="<repo>/.codegraph/codegraph.db, opened read-only")
    s.add_argument("--kinds", default=DEFAULT_KINDS, help="comma-separated edge kinds")
    s.add_argument("--root", help="absolute repo root to strip from absolute paths")
    args = ap.parse_args(argv)
    try:
        units = load_units(args.units)
        if args.cmd == "check":
            out = analyze(units, args.max_units, args.max_writers)
            code = 0 if out["ok"] else 1
        else:
            kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
            out, code = suggest(units, args.db, kinds, args.root), 0
    except InputError as e:
        out, code = {"ok": False, "error": str(e)}, 2
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
