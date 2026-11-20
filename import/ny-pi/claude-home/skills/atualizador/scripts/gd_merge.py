"""Merge a PR only against its local-gate proof, then verify it reached MERGED."""

import json
import os
import re
from time import monotonic, sleep

from gd_ci import ci_outcome, ci_status
from gd_common import BLOCKED, CI_RED, USAGE, Fail
from gd_gate import require_proof
from gd_git import head, is_ancestor
from gd_pr import gh_fail, pr_view

POLL_SECS = 15  # gh 2.46 enqueues on a merge queue and still exits 0: poll the PR state
METHOD_FLAGS = {"squash": "--squash", "merge": "--merge", "rebase": "--rebase"}
TRAILER_LINE = re.compile(r"^[A-Za-z][A-Za-z0-9-]*\s*:\s*\S")
FIELDS = "number,url,state,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,mergeCommit"


def _trailers(ctx, sha):
    """Trailer lines of the merge commit's message (GitHub may append Co-authored-by); None when unreadable."""
    if not sha:
        return None
    proc = ctx.gh("api", f"repos/{{owner}}/{{repo}}/git/commits/{sha}")
    if proc.rc != 0:
        return None
    try:
        data = json.loads(proc.out)
    except ValueError:
        return None
    message = data.get("message") if isinstance(data, dict) else None
    if not isinstance(message, str):
        return None
    found = []
    for para in reversed(message.strip().split("\n\n")[1:]):  # [0] is the subject
        lines = para.splitlines()
        if not all(TRAILER_LINE.match(line) for line in lines):
            break
        found = lines + found
    return found


def _merged(ctx, view):
    commit = (view.get("mergeCommit") or {}).get("oid")
    return {
        "merged": True,
        "pr": view["number"],
        "merge_commit": commit,
        "head": view.get("headRefOid"),
        "merge_commit_trailers": _trailers(ctx, commit),
    }


def _message_argv(args):
    """--subject/--body-file for gh, validated before any remote call; [] when neither is given."""
    subject, body = args.subject, args.body_file
    if subject is not None and (
        not subject.strip() or "\n" in subject or "\r" in subject
    ):
        raise Fail(USAGE, "usage", detail="subject_invalid")
    if body is not None:
        if not os.path.isfile(body):
            raise Fail(USAGE, "usage", detail="body_file_missing")
        try:
            with open(body, encoding="utf-8") as fh:
                fh.read()
        except (OSError, UnicodeDecodeError) as exc:
            raise Fail(USAGE, "usage", detail="body_file_unreadable") from exc
    if (subject is not None or body is not None) and args.method == "rebase":
        raise Fail(
            USAGE, "usage", detail="message_needs_squash_or_merge"
        )  # a rebase writes no commit message
    return [
        *(["--subject", subject] if subject is not None else []),
        *(["--body-file", body] if body is not None else []),
    ]


def _wait_merged(ctx, pr, seconds):
    deadline = monotonic() + seconds
    while True:
        view = pr_view(ctx, pr, FIELDS)
        if view["state"] == "MERGED":
            return view
        if (
            view["state"] != "OPEN"
        ):  # closed (or otherwise gone) while we waited: never merges
            raise Fail(BLOCKED, "not_mergeable", state=view["state"], pr=pr)
        if monotonic() >= deadline:
            return None
        sleep(POLL_SECS)


def merge(ctx, args, ci=None):
    message = _message_argv(args)
    view = pr_view(ctx, args.pr, FIELDS)
    if view["state"] == "MERGED":
        return _merged(ctx, view)
    if (
        view["state"] != "OPEN"
        or view.get("mergeable") == "CONFLICTING"
        or view.get("mergeStateStatus") == "DIRTY"
    ):
        raise Fail(
            BLOCKED,
            "not_mergeable",
            state=view["state"],
            mergeable=view.get("mergeable"),
        )
    sha = view["headRefOid"]
    local = head(ctx)
    if local != sha:
        raise Fail(BLOCKED, "head_moved", pr_head=sha, local_head=local)
    proof = require_proof(ctx, sha)
    base = view["baseRefName"]
    if proof.get("base_ref") != base:
        raise Fail(
            BLOCKED, "base_moved", base=base, proof_base_ref=proof.get("base_ref")
        )
    ctx.must("fetch", "--prune", "origin", timeout=300)
    base_sha = ctx.must("rev-parse", f"origin/{base}")
    if not is_ancestor(ctx, f"origin/{base}", local):
        raise Fail(
            BLOCKED,
            "base_moved",
            base=base,
            base_sha=base_sha,
            proof_base_sha=proof.get("base_sha"),
        )
    status = ci
    if status is None:
        status = ci_status(
            ctx,
            args.pr,
            watch=False,
            interval=args.interval,
            grace_min=args.checks_grace_min,
        )
    if (
        status["status"] in ("not_started_billing", "no_checks")
        and args.require_remote_ci
    ):
        raise Fail(
            CI_RED, "ci_required", **{k: v for k, v in status.items() if k != "reason"}
        )
    ci_outcome(status)
    flag = METHOD_FLAGS[args.method]
    argv = ["pr", "merge", str(args.pr), flag, "--match-head-commit", sha, *message]
    proc = ctx.gh(*argv)
    if proc.rc != 0:
        raise gh_fail(proc)
    final = _wait_merged(ctx, args.pr, args.budget_min * 60)
    if final is None:
        raise Fail(CI_RED, "pending_timeout", queued=True, pr=args.pr)
    return _merged(ctx, final)
