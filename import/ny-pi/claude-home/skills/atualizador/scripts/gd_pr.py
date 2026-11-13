"""Pull request lifecycle: gh helpers, publish (push and PR) and cleanup after the merge."""

import os
import re

from gd_common import BLOCKED, NEEDS_LLM, USAGE, Fail, loads, ref, tail
from gd_gate import require_proof
from gd_git import (
    current_branch,
    default_branch,
    head,
    secret_named,
    porcelain,
    scan_secrets,
)

PR_FIELDS = "number,url,state,headRefOid,baseRefName"
BODY_COMMITS = 30


def gh_fail(proc):
    """Map a failed gh call to a blocked reason; an unknown failure never reads as success."""
    text = f"{proc.err}\n{proc.out}".lower()
    if proc.rc == 127:
        reason = "gh_missing"
    elif any(
        s in text
        for s in ("gh auth login", "not logged in", "http 401", "bad credentials")
    ):
        reason = "auth"
    elif "head branch was modified" in text or "match-head" in text:
        reason = "head_moved"
    elif any(
        s in text
        for s in (
            "protected branch",
            "required status check",
            "policy prohibits",
            "approving review",
            "review is required",
        )
    ):
        reason = "protection"
    elif any(s in text for s in ("not mergeable", "merge conflict")):
        reason = "not_mergeable"
    else:
        reason = "gh_failed"
    return Fail(BLOCKED, reason, detail=tail(proc.err or proc.out))


def pr_view(ctx, number, fields):
    proc = ctx.gh("pr", "view", str(number), "--json", fields)
    if proc.rc != 0:
        raise gh_fail(proc)
    return loads(proc.out)


def find_pr(ctx, branch):
    proc = ctx.gh(
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "all",
        "--limit",
        "30",
        "--json",
        PR_FIELDS,
    )
    if proc.rc != 0:
        raise gh_fail(proc)
    return loads(proc.out)


def _subjects(ctx, base):
    out = ctx.must("log", "--no-merges", "--format=%s", f"origin/{base}..HEAD")
    return out.splitlines()


def _default_body(ctx, base, proof, attribution):
    lines = ["## Changes", ""]
    lines += [f"- {s}" for s in _subjects(ctx, base)[:BODY_COMMITS]]
    lines += ["", "## Verification (local gate)", "", "| check | exit |", "|---|---|"]
    lines += [f"| {c['name']} | {c['exit']} |" for c in proof["checks"]]
    lines += [
        "",
        f"Proof head `{proof['head']}` on base `{(proof.get('base_sha') or 'unknown')[:12]}`.",
        "",
        "## Not run",
        "",
        "- Remote CI: not reported when the PR opened (see the `ci` result).",
        "- Anything outside the gate checks listed above.",
    ]
    if attribution:
        lines += [""] + list(attribution)
    return "\n".join(lines) + "\n"


def publish(ctx, args):
    base = ref(args.base, "base")
    branch = current_branch(ctx)
    if not branch:
        raise Fail(BLOCKED, "detached_head")
    if branch == base:
        raise Fail(BLOCKED, "on_base_branch", branch=branch)
    sha = head(ctx)
    proof = require_proof(ctx, sha)
    prs = find_pr(ctx, branch)
    for pr in prs:
        if (
            pr["state"] == "MERGED"
            and pr["headRefOid"] == sha
            and pr["baseRefName"] == base
        ):
            return {
                "pr": pr["number"],
                "url": pr["url"],
                "head": sha,
                "state": "MERGED",
                "created": False,
            }
    open_pr = next((p for p in prs if p["state"] == "OPEN"), None)
    if open_pr and open_pr["baseRefName"] != base:
        raise Fail(
            BLOCKED,
            "base_mismatch",
            pr=open_pr["number"],
            pr_base=open_pr["baseRefName"],
        )
    if ctx.git("rev-parse", "--verify", "--quiet", f"origin/{base}^{{commit}}").rc != 0:
        raise Fail(BLOCKED, "scan_failed", detail="base_ref_missing", base=base)
    title = body_file = None
    if not open_pr:
        subjects = _subjects(ctx, base)
        if not subjects:
            raise Fail(BLOCKED, "nothing_to_publish", base=base)
        title = args.title or (subjects[0] if len(subjects) == 1 else None)
        if not title:
            raise Fail(NEEDS_LLM, "no_message", subjects=subjects[:BODY_COMMITS])
        body_file = args.body_file
        if not body_file:
            body_file = str(ctx.scratch(f"{ctx.stamp}-{ctx.cmd}.body.md"))
            with open(body_file, "w", encoding="utf-8") as fh:
                fh.write(_default_body(ctx, base, proof, args.attribution))
    # --remerge-diff: a plain log shows nothing for the content a merge commit adds itself
    scan_secrets(ctx, f"--log-opts=--remerge-diff origin/{base}..HEAD")
    push = ctx.git("push", "-u", "origin", f"HEAD:{branch}", timeout=300)
    if push.rc != 0:
        raise Fail(BLOCKED, "push_rejected", detail=tail(push.err or push.out))
    created = open_pr is None
    if created:
        argv = [
            "pr",
            "create",
            "--base",
            base,
            "--head",
            branch,
            "--title",
            title,
            "--body-file",
            body_file,
        ]
        if args.draft:
            argv.append("--draft")
        proc = ctx.gh(*argv)
        if proc.rc != 0:
            raise gh_fail(proc)
        found = re.search(r"/pull/(\d+)", proc.out)
        if not found:
            raise Fail(BLOCKED, "gh_failed", detail="pr_number_not_in_output")
        number = int(found.group(1))
    else:
        number = open_pr["number"]
    view = pr_view(ctx, number, "number,url,headRefOid")
    if view["headRefOid"] != sha:
        raise Fail(
            BLOCKED, "head_moved", pr=number, pr_head=view["headRefOid"], local_head=sha
        )
    return {
        "pr": number,
        "url": view["url"],
        "head": sha,
        "state": "OPEN",
        "created": created,
    }


def _worktree_paths(ctx):
    out = ctx.must("worktree", "list", "--porcelain")
    return [
        os.path.realpath(line[9:])
        for line in out.splitlines()
        if line.startswith("worktree ")
    ]


def _remote_branch(ctx, branch, head_sha, kept):
    """Delete origin's branch only while it still points at the merged head (exact ref, never forced)."""
    proc = ctx.git("ls-remote", "origin", f"refs/heads/{branch}", timeout=60)
    if proc.rc != 0:
        kept.append({"remote_branch": branch, "why": tail(proc.err or proc.out)})
        return False
    tips = dict(
        reversed(line.split("\t", 1)) for line in proc.out.splitlines() if "\t" in line
    )
    tip = tips.get(f"refs/heads/{branch}")  # ls-remote patterns also match deeper refs
    if tip is None:
        # The host may auto-delete the head branch after the merge, after sync's fetch --prune.
        stale = f"refs/remotes/origin/{branch}"
        if ctx.git("rev-parse", "--verify", "-q", stale).rc == 0:
            ctx.git("update-ref", "-d", stale)
        return False
    if tip != head_sha:
        kept.append({"remote_branch": branch, "why": "moved"})
        return False
    proc = ctx.git("push", "origin", "--delete", f"refs/heads/{branch}", timeout=120)
    if proc.rc != 0:
        kept.append({"remote_branch": branch, "why": tail(proc.err or proc.out)})
    return proc.rc == 0


def _remove_worktree(ctx, wt, discard_ignored):
    if wt == ctx.repo:
        raise Fail(USAGE, "usage", detail="run_cleanup_from_the_main_checkout")
    if wt not in _worktree_paths(ctx)[1:]:
        raise Fail(BLOCKED, "not_a_worktree", worktree=wt)
    rows = porcelain(ctx, cwd=wt, ignored=True)
    dirty = [f"{xy} {path}" for xy, path in rows if xy != "!!"]
    if dirty:
        raise Fail(BLOCKED, "dirty", worktree=wt, files=dirty[:50])
    secrets = [path for xy, path in rows if xy == "!!" and secret_named(path)]
    if secrets and not discard_ignored:
        raise Fail(
            BLOCKED,
            "dirty",
            detail="keep_local_ignored",
            worktree=wt,
            files=secrets[:50],
        )
    ctx.must("worktree", "remove", wt)  # never --force


def cleanup(ctx, args):
    view = pr_view(
        ctx, args.pr, "state,headRefOid,headRefName,baseRefName,isCrossRepository"
    )
    if view["state"] != "MERGED":
        raise Fail(BLOCKED, "not_merged", state=view["state"])
    branch = view["headRefName"]
    removed = {"worktree": None, "branch": False, "remote_branch": False}
    kept = []
    if args.worktree:
        wt = os.path.realpath(args.worktree)
        _remove_worktree(ctx, wt, args.discard_ignored)
        removed["worktree"] = wt
    ref(branch, "branch")
    result = {"pr": args.pr, "removed": removed, "kept": kept, "branch_kept": None}
    if args.keep_branch:
        result["branch_kept"] = "requested"
    elif branch in (view["baseRefName"], default_branch(ctx)):
        result["branch_kept"] = "protected"
    if result["branch_kept"]:
        return result
    local = ctx.git("rev-parse", "--verify", "-q", f"refs/heads/{branch}")
    if local.rc == 0 and local.out.strip() != view["headRefOid"]:
        result["branch_kept"] = "moved"
    elif local.rc == 0:
        proc = ctx.git("branch", "-D", branch)  # -D only for the merged head itself
        removed["branch"] = proc.rc == 0
        if proc.rc != 0:
            kept.append({"branch": branch, "why": tail(proc.err or proc.out)})
    if not view.get("isCrossRepository", True):
        removed["remote_branch"] = _remote_branch(ctx, branch, view["headRefOid"], kept)
    return result
