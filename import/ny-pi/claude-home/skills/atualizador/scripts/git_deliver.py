#!/usr/bin/env python3
"""git-deliver: deterministic git/GitHub delivery steps; an LLM only handles judgment.

Run as `python3 -I git_deliver.py <cmd> ...`. stdout is exactly one compact JSON object
({"ok","cmd","reason",...}); logs of every git/gh/gitleaks call go under ~/.cache/git-deliver/.
Exit codes: 0 ok, 2 usage, 3 needs_llm, 4 gate_red, 5 ci_red, 6 blocked.
"""

import argparse
import contextlib
import os
import re
import sys

sys.path.insert(
    0, os.path.dirname(os.path.realpath(__file__))
)  # -I drops the script dir from sys.path

import gd_ci  # noqa: E402
import gd_gate  # noqa: E402
import gd_git  # noqa: E402
import gd_merge  # noqa: E402
import gd_pr  # noqa: E402
from gd_common import (  # noqa: E402
    BLOCKED,
    NEEDS_LLM,
    USAGE,
    Ctx,
    Fail,
    emit,
    ref,
    repo_lock,
    tail,
)

TRAILER_RE = r"^[A-Za-z][A-Za-z0-9-]*\s*[:=]\s*\S"


class Parser(argparse.ArgumentParser):
    def __init__(self, **kwargs):
        kwargs.setdefault(
            "allow_abbrev", False
        )  # --disc must never mean --discard-ignored
        super().__init__(**kwargs)

    def error(self, message):
        raise Fail(USAGE, "usage", detail=message)


def _trailer(value):
    if "\n" in value or not re.match(TRAILER_RE, value):
        raise argparse.ArgumentTypeError("trailer must look like 'Key: value'")
    return value


def _abs(value):
    return os.path.abspath(value)


def _common(sub, name, help_text):
    p = sub.add_parser(name, help=help_text, add_help=False)
    p.add_argument(
        "--repo", default=argparse.SUPPRESS, help="repository path (default: cwd)"
    )
    return p


def _ci_opts(p):
    p.add_argument("--interval", type=int, default=30, help="seconds between polls")
    p.add_argument(
        "--checks-grace-min",
        type=float,
        default=5,
        help="minutes to wait for the first check when the repository has workflows",
    )


def _branch_opts(p):
    p.add_argument("--keep-branch", action="store_true")
    p.add_argument(
        "--discard-ignored",
        action="store_true",
        help="remove the worktree although ignored secret-looking files remain in it",
    )


def _new_branch_opt(p):
    p.add_argument(
        "--branch",
        metavar="NAME",
        help="when HEAD is detached or on a protected branch, create NAME and work there",
    )


def _keep_local_opt(p):
    p.add_argument(
        "--keep-local",
        action="append",
        default=[],
        metavar="PATH",
        help="untracked path to leave out of the dirty check (repeatable)",
    )


def _message_opts(p):
    p.add_argument("-m", "--message")
    p.add_argument("--message-file", type=_abs)
    p.add_argument("--trailer", action="append", type=_trailer, default=[])


def _publish_opts(p):
    p.add_argument("--title")
    p.add_argument("--body-file", type=_abs)
    p.add_argument(
        "--attribution",
        action="append",
        default=[],
        help="line appended to the generated PR body",
    )


def build_parser():
    parser = Parser(
        prog="git-deliver", description=__doc__.splitlines()[0], add_help=False
    )
    parser.add_argument("--repo", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True, parser_class=Parser)
    _common(
        sub,
        "status",
        "branch, divergence, operation, worktrees, stashes, classified paths",
    )
    p = _common(sub, "commit", "stage explicit paths, scan for secrets, commit")
    p.add_argument("--path", action="extend", nargs="+")
    _new_branch_opt(p)
    _message_opts(p)
    p = _common(sub, "integrate", "fetch and merge origin/BASE")
    p.add_argument("--base", required=True)
    p = _common(sub, "gate", "run named checks and write the proof")
    p.add_argument("--check", action="append", default=[], metavar="NAME=CMD")
    p.add_argument("--timeout-min", type=float, default=60, help="per check")
    _keep_local_opt(p)
    p.add_argument(
        "--base", help="base branch recorded in the proof (default: origin/HEAD)"
    )
    p.add_argument(
        "--allow-dirty",
        action="store_true",
        help="run on a dirty tree; the proof is marked dirty",
    )
    p = _common(sub, "publish", "push and open or reuse the PR")
    p.add_argument("--base", required=True)
    p.add_argument("--draft", action="store_true")
    _publish_opts(p)
    p = _common(sub, "ci", "wait for remote CI and classify the outcome")
    p.add_argument("--pr", type=int, required=True)
    p.add_argument("--budget-min", type=float, default=45)
    p.add_argument("--required", action="store_true")
    _ci_opts(p)
    p = _common(sub, "merge", "merge a PR that matches its gate proof")
    p.add_argument("--pr", type=int, required=True)
    p.add_argument("--method", choices=sorted(gd_merge.METHOD_FLAGS), default="squash")
    p.add_argument("--require-remote-ci", action="store_true")
    p.add_argument("--subject", help="exact squash/merge commit title (one line)")
    p.add_argument(
        "--body-file",
        type=_abs,
        help="file holding the exact squash/merge commit message",
    )
    p.add_argument(
        "--budget-min", type=float, default=45, help="wait for MERGED after gh accepts"
    )
    _ci_opts(p)
    p = _common(sub, "sync", "fast-forward the main checkout to origin")
    p.add_argument("--main-checkout", type=_abs, required=True)
    p = _common(sub, "cleanup", "remove the merged worktree and branch")
    p.add_argument("--pr", type=int, required=True)
    p.add_argument("--worktree", type=_abs)
    _branch_opts(p)
    p = _common(
        sub, "ship", "commit, integrate, gate, publish, ci, merge, sync, cleanup"
    )
    p.add_argument("--base", required=True)
    p.add_argument("--check", action="append", default=[], metavar="NAME=CMD")
    p.add_argument("--path", action="extend", nargs="+")
    p.add_argument("--require-remote-ci", action="store_true")
    p.add_argument("--main-checkout", type=_abs)
    p.add_argument("--no-merge", action="store_true", help="stop after publish")
    p.add_argument("--timeout-min", type=float, default=60)
    p.add_argument("--budget-min", type=float, default=45)
    p.add_argument("--method", choices=sorted(gd_merge.METHOD_FLAGS), default="squash")
    _keep_local_opt(p)
    _new_branch_opt(p)
    _branch_opts(p)
    _ci_opts(p)
    _message_opts(p)
    _publish_opts(p)
    return parser


def _ns(**kw):
    return argparse.Namespace(**kw)


def _is_linked_worktree(ctx):
    common = os.path.realpath(
        os.path.join(ctx.repo, ctx.must("rev-parse", "--git-common-dir"))
    )
    return gd_git.git_dir(ctx) != common


def _main_worktree(ctx):
    """The first `git worktree list` entry is the main worktree; None when the common dir is bare."""
    first = ctx.must("worktree", "list", "--porcelain").split("\n\n", 1)[0].splitlines()
    return None if "bare" in first else os.path.realpath(first[0][len("worktree ") :])


def ship(ctx, args):
    """Chain the steps; each one checks state first, so a rerun resumes at the step that stopped."""
    base, steps, held, extra = ref(args.base, "base"), {}, {}, {}

    def step(name, fn, *a, **kw):
        try:
            result = fn(*a, **kw)
        except Fail as exc:
            raise Fail(
                exc.code,
                exc.reason,
                **{**exc.extra, **extra, "stopped_at": name, "steps": steps},
            ) from exc
        steps[name] = result
        return result

    checks = gd_gate.parse_checks(args.check)
    if args.path:
        gd_git.explicit_paths(ctx, args.path)
    main_checkout = args.main_checkout or _main_worktree(ctx)  # before any mutation
    protected = {base, gd_git.default_branch(ctx)} - {None}
    created = gd_git.ensure_branch(ctx, args.branch, protected)
    if created:
        extra["branch_created"] = created
    keep = (args.path or []) + args.keep_local
    unknown = [r[3:] for r in gd_git.dirty_paths(ctx, keep) if r.startswith("?? ")]
    if unknown:
        raise Fail(
            NEEDS_LLM, "unknown_paths", files=unknown[: gd_git.LIST_CAP], **extra
        )
    kept_local = gd_git.kept_local_paths(ctx)
    if args.path:
        step(
            "commit",
            gd_git.commit,
            ctx,
            _ns(
                path=args.path,
                message=args.message,
                message_file=args.message_file,
                trailer=args.trailer,
                branch=None,
            ),
        )
    sha, branch = gd_git.head(ctx), gd_git.current_branch(ctx)
    prior = [
        p
        for p in (gd_pr.find_pr(ctx, branch) if branch else [])
        if p["state"] == "MERGED"
        and p["headRefOid"] == sha
        and p["baseRefName"] == base
    ]
    if prior:
        steps["publish"] = {
            "pr": prior[0]["number"],
            "state": "MERGED",
            "skipped": "already_merged",
        }
        number = prior[0]["number"]
    else:
        step("integrate", gd_git.integrate, ctx, _ns(base=base))
        base_sha = ctx.must("rev-parse", f"origin/{base}")
        if gd_gate.proof_matches(
            gd_gate.load_proof(ctx, gd_git.head(ctx)), checks, base_sha
        ):
            steps["gate"] = {"skipped": "proof_valid"}
        else:
            step(
                "gate",
                gd_gate.gate,
                ctx,
                _ns(
                    check=args.check,
                    timeout_min=args.timeout_min,
                    base=base,
                    allow_dirty=False,
                    keep_local=args.keep_local,
                ),
            )
        pub = step(
            "publish",
            gd_pr.publish,
            ctx,
            _ns(
                base=base,
                title=args.title,
                body_file=args.body_file,
                draft=False,
                attribution=args.attribution,
            ),
        )
        number = pub["pr"]
        if args.no_merge:
            return {
                "stopped_at": None,
                "pr": number,
                "url": pub["url"],
                "steps": steps,
                "kept_local": kept_local,
                "skipped": ["ci", "merge", "sync", "cleanup"],
                **extra,
            }

        def ci_step():
            held["ci"] = gd_ci.ci_status(
                ctx,
                number,
                args.budget_min,
                False,
                interval=args.interval,
                grace_min=args.checks_grace_min,
            )
            return gd_ci.ci_outcome(held["ci"])

        step("ci", ci_step)
        step(
            "merge",
            gd_merge.merge,
            ctx,
            _ns(
                pr=number,
                method=args.method,
                subject=None,  # ship keeps GitHub's PR_TITLE/PR_BODY squash message
                body_file=None,
                require_remote_ci=args.require_remote_ci,
                budget_min=args.budget_min,
                interval=args.interval,
                checks_grace_min=args.checks_grace_min,
            ),
            ci=held["ci"],
        )
    if main_checkout:
        main = ctx.at(main_checkout)
        step("sync", gd_git.sync, ctx, _ns(main_checkout=main_checkout))
        wt = ctx.repo if _is_linked_worktree(ctx) else None
        step(
            "cleanup",
            gd_pr.cleanup,
            main,
            _ns(
                pr=number,
                worktree=wt,
                keep_branch=args.keep_branch,
                discard_ignored=args.discard_ignored,
            ),
        )
    merged = steps.get("merge") or {}
    return {
        "stopped_at": None,
        "pr": number,
        "merge_commit": merged.get("merge_commit"),
        "steps": steps,
        "kept_local": kept_local,
        **({} if main_checkout else {"skipped": ["sync", "cleanup"]}),
        **extra,
    }


READ_ONLY = {"status", "ci"}  # every other command takes the repository lock
COMMANDS = {
    "status": gd_git.status,
    "commit": gd_git.commit,
    "integrate": gd_git.integrate,
    "gate": gd_gate.gate,
    "publish": gd_pr.publish,
    "ci": gd_ci.ci,
    "merge": gd_merge.merge,
    "sync": gd_git.sync,
    "cleanup": gd_pr.cleanup,
    "ship": ship,
}


def main(argv=None):
    cmd, ctx = "usage", None
    try:
        args = build_parser().parse_args(argv)
        cmd = args.cmd
        ctx = Ctx(args.repo, cmd)
        with repo_lock(ctx) if cmd not in READ_ONLY else contextlib.nullcontext():
            result = COMMANDS[cmd](ctx, args)
        out, code = {"ok": True, "cmd": cmd, "reason": None, **result}, 0
    except Fail as exc:
        out, code = (
            {"ok": False, "cmd": cmd, "reason": exc.reason, **exc.extra},
            exc.code,
        )
    except Exception as exc:  # noqa: BLE001 - no traceback may reach stdout; it goes to the log
        if ctx:
            ctx.log_error()
        out, code = (
            {
                "ok": False,
                "cmd": cmd,
                "reason": "internal_error",
                "detail": tail(f"{type(exc).__name__}: {exc}"),
            },
            BLOCKED,
        )
    if ctx and ctx.log_path and ctx.log_path.exists():
        out["log"] = str(ctx.log_path)
    emit(out)
    return code


if __name__ == "__main__":
    sys.exit(main())
