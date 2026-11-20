"""The local gate: run named checks, keep full logs on disk and write the proof that publish and merge read."""

import datetime
import json
import os
import re
import time
from pathlib import Path

from gd_common import BLOCKED, GATE_RED, USAGE, Fail, ref
from gd_git import default_branch, dirty_paths, git_dir, head, kept_local_paths

NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
TAIL_LINES = 40
TAIL_BYTES = 65536


def parse_checks(specs):
    checks, seen = [], set()
    for spec in specs or []:
        name, sep, cmd = spec.partition("=")
        if not sep or not NAME_RE.match(name) or not cmd.strip() or name in seen:
            raise Fail(USAGE, "usage", detail="bad_check", check=spec.split("=")[0])
        seen.add(name)
        checks.append((name, cmd))
    if not checks:
        raise Fail(USAGE, "usage", detail="no_checks")
    return checks


def proof_path(ctx, sha, dirty=False):
    """A dirty-tree proof has its own file so it never replaces the clean proof of the same head."""
    suffix = "-dirty" if dirty else ""
    return Path(git_dir(ctx)) / "git-deliver" / f"proof-{sha}{suffix}.json"


def load_proof(ctx, sha):
    """The clean proof only: publish, merge and ship read nothing taken on a dirty tree."""
    try:
        data = json.loads(proof_path(ctx, sha).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("head") == sha else None


def proof_green(proof):
    checks = proof.get("checks") or []
    return bool(checks) and all(c.get("exit") == 0 for c in checks)


def require_proof(ctx, sha):
    """publish and merge accept only a green, clean proof for exactly this head."""
    proof = load_proof(ctx, sha)
    if proof is None:
        if proof_path(ctx, sha, dirty=True).exists():
            raise Fail(BLOCKED, "dirty", head=sha, detail="proof_taken_on_dirty_tree")
        raise Fail(BLOCKED, "no_proof", head=sha)
    if not proof_green(proof):
        raise Fail(BLOCKED, "no_proof", head=sha, detail="proof_checks_failed")
    return proof


def proof_matches(proof, checks, base_sha):
    """True when an existing proof already covers these checks on the current base (ship resume)."""
    if (
        proof is None
        or proof.get("dirty")
        or not proof_green(proof)
        or proof.get("base_sha") != base_sha
    ):
        return False
    return [(c["name"], c["cmd"]) for c in proof["checks"]] == list(checks)


def _tail(path):
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        fh.seek(max(0, size - TAIL_BYTES))
        lines = fh.read().decode("utf-8", "replace").splitlines()[-TAIL_LINES:]
    return "\n".join(line[:300] for line in lines)[-6000:]


def _base(ctx, base):
    name = ref(base, "base") if base else default_branch(ctx)
    if not name:
        return None, None
    proc = ctx.git("rev-parse", "--verify", "-q", f"refs/remotes/origin/{name}")
    return name, (proc.out.strip() if proc.rc == 0 else None)


def gate(ctx, args):
    checks = parse_checks(args.check)
    timeout = max(1, int(args.timeout_min * 60))
    keep = args.keep_local or []
    dirty_before = dirty_paths(ctx, keep)
    if dirty_before and not args.allow_dirty:
        raise Fail(BLOCKED, "dirty", files=dirty_before[:50])
    sha = head(ctx)
    base_ref, base_sha = _base(ctx, args.base)
    logs = ctx.scratch(f"{ctx.stamp}-gate")
    logs.mkdir(parents=True, exist_ok=True)
    rows, record = [], []
    for name, cmd in checks:
        logfile = logs / f"{name}.log"
        started = time.monotonic()
        rc = ctx.run_file(["bash", "-c", cmd], logfile, timeout)
        secs = round(time.monotonic() - started, 1)
        row = {"name": name, "exit": rc, "secs": secs}
        if rc != 0:
            row["tail"] = _tail(logfile)
        rows.append(row)
        record.append({"name": name, "cmd": cmd, "exit": rc, "secs": secs})
    dirty = bool(dirty_before or dirty_paths(ctx, keep))
    proof = {
        "version": 1,
        "head": sha,
        "tree": ctx.must("rev-parse", "HEAD^{tree}"),
        "base_ref": base_ref,
        "base_sha": base_sha,
        "dirty": dirty,
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "checks": record,
    }
    target = proof_path(ctx, sha, dirty)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(proof, indent=1), encoding="utf-8")
    os.replace(tmp, target)
    info = {
        "head": sha,
        "checks": rows,
        "proof": str(target),
        "logs": str(logs),
        "dirty": dirty,
        "kept_local": kept_local_paths(ctx),
    }
    if any(r["exit"] != 0 for r in rows):
        raise Fail(GATE_RED, "checks_failed", **info)
    if dirty and not args.allow_dirty:
        raise Fail(BLOCKED, "dirty", detail="checks_modified_tree", **info)
    return info
