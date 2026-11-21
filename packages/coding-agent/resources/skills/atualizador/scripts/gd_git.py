"""Local git operations: status, commit (secret-scanned), integrate and sync, plus shared helpers."""

import fnmatch
import os

from gd_common import BLOCKED, NEEDS_LLM, USAGE, Fail, ref, tail

LIST_CAP = 200
LEAK_EXIT = 77  # gitleaks --exit-code: distinguishes a finding from a scanner failure
SCAN_ERRORS = (
    " ERR ",
    " FTL ",
    "fatal:",
)  # a clean exit 0 carrying these is still a failed scan
KEEP_DIRS = {
    "__pycache__", "node_modules", ".cache", ".venv", "venv", ".pytest_cache", ".mypy_cache",
    ".ruff_cache", ".tox", "target", "dist", "build", ".next", "coverage", ".idea",
}  # fmt: skip
DATA_STEMS = ("credentials", "*credentials*", "token", "tokens", "*_token")
DATA_EXTS = ("json", "yaml", "yml", "toml", "ini", "txt", "env", "cfg", "conf", "xml")
# A bare stem with a source extension (token.go, credentials.py) is code, not a credential.
SECRET_NAMES = (
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "id_rsa*", "id_dsa*", "id_ecdsa*",
    "id_ed25519*", "credentials", "*.credentials", ".git-credentials", "token", "tokens", "*.token",
    ".netrc", ".npmrc", ".pgpass", "auth.json", "*.secret", "*.secrets", "secrets.json",
    "secrets.yaml", "secrets.yml", "secrets.toml",
) + tuple(f"{stem}.{ext}" for stem in DATA_STEMS for ext in DATA_EXTS)  # fmt: skip
KEEP_NAMES = SECRET_NAMES + (".DS_Store", "*.pyc", "*.log", "*.swp", "*.tmp", ".coverage")  # fmt: skip
SAFE_SUFFIXES = (".example", ".sample", ".template", ".dist")
OPERATIONS = {
    "MERGE_HEAD": "merge", "CHERRY_PICK_HEAD": "cherry-pick", "REVERT_HEAD": "revert",
    "rebase-merge": "rebase", "rebase-apply": "rebase", "BISECT_LOG": "bisect",
}  # fmt: skip


def head(ctx):
    return ctx.must("rev-parse", "HEAD", cwd=ctx.repo)


def head_or_none(ctx):
    proc = ctx.git("rev-parse", "--verify", "-q", "HEAD")
    return proc.out.strip() if proc.rc == 0 else None


def current_branch(ctx):
    proc = ctx.git("symbolic-ref", "--short", "-q", "HEAD")
    return proc.out.strip() if proc.rc == 0 else None


def git_dir(ctx):
    return os.path.realpath(ctx.must("rev-parse", "--absolute-git-dir"))


def default_branch(ctx):
    proc = ctx.git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if proc.rc == 0 and proc.out.strip().startswith("origin/"):
        return proc.out.strip()[len("origin/") :]
    for name in ("main", "master"):
        if (
            ctx.git("rev-parse", "--verify", "-q", f"refs/remotes/origin/{name}").rc
            == 0
        ):
            return name
    return None


def tracked_changes(ctx):
    return ctx.must("status", "--porcelain", "--untracked-files=no").splitlines()


def unmerged(ctx):
    return ctx.must("diff", "--name-only", "--diff-filter=U").splitlines()


def operation(ctx):
    gdir = git_dir(ctx)
    for marker, name in OPERATIONS.items():
        if os.path.exists(os.path.join(gdir, marker)):
            return name
    return None


def is_ancestor(ctx, ancestor, descendant):
    return ctx.git("merge-base", "--is-ancestor", ancestor, descendant).rc == 0


def keep_local(path):
    parts = path.split("/")
    name = parts[-1].lower()
    if any(part in KEEP_DIRS for part in parts[:-1]):
        return True
    if name.endswith(SAFE_SUFFIXES):
        return False
    return any(fnmatch.fnmatch(name, pattern) for pattern in KEEP_NAMES)


def secret_named(path):
    """A credential-looking file name outside cache and dependency trees (vendored keys are not secrets)."""
    parts = path.rstrip("/").split("/")
    name = parts[-1].lower()
    if any(part in KEEP_DIRS for part in parts[:-1]) or name.endswith(SAFE_SUFFIXES):
        return False
    return any(fnmatch.fnmatch(name, pattern) for pattern in SECRET_NAMES)


def classify(xy, path):
    """Secret-named paths stay local, tracked or not; every other untracked path is unknown."""
    if secret_named(path):
        return "keep_local"
    return "unknown" if xy == "??" else "publish"


def porcelain(ctx, cwd=None, ignored=False):
    flags = ["--ignored"] if ignored else []
    raw = ctx.must(
        "status", "--porcelain=v1", "-z", "--untracked-files=all", *flags, cwd=cwd
    )
    parts, i, rows = raw.split("\0"), 0, []
    while i < len(parts):
        entry = parts[i]
        i += 1
        if len(entry) < 4:
            continue
        xy, path = entry[:2], entry[3:]
        if "R" in xy or "C" in xy:
            i += 1  # skip the original name
        rows.append((xy, path))
    return rows


def dirty_paths(ctx, keep=()):
    """Tracked changes plus untracked, non-ignored paths that are neither secret-named nor in `keep`."""
    rows = []
    for xy, path in porcelain(ctx):
        if xy == "??" and (secret_named(path) or _covered(path, keep, ctx.repo)):
            continue
        rows.append(f"{xy} {path}")
    return rows


def kept_local_paths(ctx):
    """Untracked secret-named paths the dirty check skips; results list them, never silently."""
    rows = [p for xy, p in porcelain(ctx) if xy == "??" and secret_named(p)]
    return rows[:LIST_CAP]


def scan_secrets(ctx, *args):
    """gitleaks exits 1 on a leak and on an error alike, so a leak gets its own exit code (77)."""
    argv = [
        "gitleaks",
        "git",
        *args,
        "--redact",
        "--no-banner",
        "--exit-code",
        str(LEAK_EXIT),
    ]
    proc = ctx.run(argv, timeout=300)
    if proc.rc == LEAK_EXIT:
        raise Fail(BLOCKED, "secret")
    # gitleaks#1981: it exits 0 when the underlying git command fails, so stderr must be clean too
    if proc.rc != 0 or any(
        s in line for line in proc.err.splitlines() for s in SCAN_ERRORS
    ):
        raise Fail(
            BLOCKED,
            "scan_failed",
            scanner_rc=proc.rc,
            scanner_missing=proc.rc == 127,
            detail=tail(proc.err),
        )


def _counts(ctx, other):
    proc = ctx.git("rev-list", "--left-right", "--count", f"{other}...HEAD")
    if proc.rc != 0 or len(proc.out.split()) != 2:
        return None, None
    behind, ahead = proc.out.split()
    return int(behind), int(ahead)


def _worktrees(ctx):
    rows, cur = [], {}
    for line in ctx.must("worktree", "list", "--porcelain").splitlines() + [""]:
        if not line:
            if cur:
                rows.append(cur)
            cur = {}
            continue
        key, _, value = line.partition(" ")
        if key == "worktree":
            cur["path"] = value
        elif key == "HEAD":
            cur["head"] = value
        elif key == "branch":
            cur["branch"] = value.removeprefix("refs/heads/")
    return rows


def status(ctx, args):
    up = ctx.git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    upstream = up.out.strip() if up.rc == 0 else None
    default = default_branch(ctx)
    behind, ahead = _counts(ctx, "@{upstream}") if upstream else (None, None)
    base_behind, base_ahead = (
        _counts(ctx, f"origin/{default}") if default else (None, None)
    )
    stash = ctx.git("reflog", "show", "--format=%gs", "refs/stash")
    names = stash.out.splitlines() if stash.rc == 0 else []
    files = {"publish": [], "unknown": [], "keep_local": []}
    for xy, path in porcelain(ctx):
        files[classify(xy, path)].append(path)
    truncated = any(len(v) > LIST_CAP for v in files.values())
    return {
        "branch": current_branch(ctx),
        "head": head_or_none(ctx),
        "upstream": upstream,
        "default_branch": default,
        "ahead": ahead,
        "behind": behind,
        "base_ahead": base_ahead,
        "base_behind": base_behind,
        "operation": operation(ctx),
        "clean": not any(files.values()),
        "worktrees": _worktrees(ctx),
        "stashes": {"count": len(names), "names": names[:LIST_CAP]},
        "files": {k: v[:LIST_CAP] for k, v in files.items()},
        "truncated": truncated,
    }


def _norm(path, repo):
    return (
        os.path.relpath(path, repo) if os.path.isabs(path) else os.path.normpath(path)
    )


def _covered(staged, paths, repo):
    for path in paths:
        norm = _norm(path, repo)
        if staged == norm or staged.startswith(norm.rstrip("/") + "/"):
            return True
    return False


def _message_args(args):
    if args.message and args.message_file:
        raise Fail(USAGE, "usage", detail="message_and_file")
    if args.message_file:
        if not os.path.isfile(args.message_file):
            raise Fail(USAGE, "usage", detail="message_file_missing")
        return ["-F", args.message_file]
    if not (args.message or "").strip():
        raise Fail(NEEDS_LLM, "no_message")
    return ["-m", args.message]


def explicit_paths(ctx, paths):
    """Every path must name something below the repository root: never the root, a parent or nothing."""
    bad = [
        p
        for p in paths or []
        if _norm(p.strip(), ctx.repo).split("/")[0] in (".", "..")
    ]
    if not paths or bad:
        raise Fail(USAGE, "usage", detail="explicit_paths_required")


def ensure_branch(ctx, name, protected):
    """Return the branch this call created, or None; refuse to stay on a protected branch or a detached HEAD.

    Work from a protected branch moves to NAME with `switch -c`, which carries the index and worktree as is
    (no stash); an existing NAME is never reused, and a non-protected branch only accepts its own name.
    """
    if name:
        ref(name, "branch")
        if name in protected:
            raise Fail(USAGE, "usage", detail="branch_is_protected")
    current = current_branch(ctx)
    if current and current not in protected:
        if name and name != current:
            raise Fail(BLOCKED, "branch_mismatch", branch=current, requested=name)
        return None
    if not name:
        extra = {"detail": "detached_head"} if current is None else {}
        raise Fail(BLOCKED, "on_base_branch", branch=current, **extra)
    if ctx.git("rev-parse", "--verify", "-q", f"refs/heads/{name}").rc == 0:
        raise Fail(BLOCKED, "branch_exists", branch=name)
    ctx.must("switch", "-c", name)
    return name


def commit(ctx, args):
    paths = args.path or []
    explicit_paths(ctx, paths)
    message = _message_args(args)
    default = default_branch(ctx)
    created = ensure_branch(ctx, args.branch, {default} - {None})
    try:
        result = _stage_and_commit(ctx, args, paths, message)
    except Fail as exc:
        if created:
            exc.extra["branch_created"] = created
        raise
    if created:
        result["branch_created"] = created
    return result


def _stage_and_commit(ctx, args, paths, message):
    merging = operation(ctx) == "merge"
    if not merging:
        staged = ctx.must("diff", "--cached", "--name-only", "-z").split("\0")
        other = [s for s in staged if s and not _covered(s, paths, ctx.repo)]
        if other:
            raise Fail(
                BLOCKED, "dirty", detail="other_paths_staged", staged_other=other[:50]
            )
    ctx.must("add", "--", *paths)
    if not merging:
        swept = ctx.must("diff", "--cached", "--name-only", "--diff-filter=A", "-z")
        added = [s for s in swept.split("\0") if s]
        named = {_norm(p, ctx.repo) for p in paths}
        secret = [s for s in added if secret_named(s)]
        # a cache or log path the caller named file by file is a decision; one a directory swept in is not
        local = [s for s in added if s not in named and keep_local(s)]
        if secret or local:
            ctx.git("reset", "-q", "--", *paths)
            if secret:
                raise Fail(
                    BLOCKED, "secret", detail="secret_named_path", files=secret[:50]
                )
            raise Fail(BLOCKED, "keep_local_path", files=local[:50])
    if not merging and ctx.git("diff", "--cached", "--quiet").rc == 0:
        return {"committed": False, "sha": head_or_none(ctx), "paths": paths}
    try:
        scan_secrets(ctx, "--staged")
    except Fail:
        ctx.git("reset", "-q", "--", *paths)
        raise
    argv = ["commit", *message]
    for trailer in args.trailer or []:
        argv += ["--trailer", trailer]
    proc = ctx.git(*argv, timeout=600)  # repository hooks run; never --no-verify
    if proc.rc != 0:
        raise Fail(BLOCKED, "commit_failed", detail=tail(proc.err or proc.out))
    return {"committed": True, "sha": head(ctx), "paths": paths}


def integrate(ctx, args):
    base = ref(args.base, "base")
    conflicts = unmerged(ctx)
    if conflicts:
        raise Fail(NEEDS_LLM, "conflict", files=conflicts[:LIST_CAP], base=base)
    dirty = tracked_changes(ctx)
    if dirty:
        raise Fail(BLOCKED, "dirty", files=dirty[:50])
    ctx.must("fetch", "--prune", "origin", timeout=300)
    target = f"origin/{base}"
    if ctx.git("rev-parse", "--verify", "-q", f"refs/remotes/{target}").rc != 0:
        raise Fail(BLOCKED, "base_missing", base=base)
    before = head(ctx)
    proc = ctx.git("merge", "--no-edit", target, timeout=300)
    if proc.rc == 0:
        after = head(ctx)
        return {
            "head": after,
            "before": before,
            "merged": after != before,
            "base_sha": ctx.must("rev-parse", target),
        }
    conflicts = unmerged(ctx)
    if conflicts:
        raise Fail(NEEDS_LLM, "conflict", files=conflicts[:LIST_CAP], base=base)
    raise Fail(BLOCKED, "merge_failed", detail=tail(proc.err or proc.out))


def sync(ctx, args):
    main = ctx.at(args.main_checkout)
    dirty = tracked_changes(main)
    if dirty:
        raise Fail(BLOCKED, "dirty", files=dirty[:50])
    default = default_branch(main)
    if not default:
        raise Fail(BLOCKED, "base_missing")
    main.must("switch", default)
    main.must("fetch", "--prune", "origin", timeout=300)
    before = head(main)
    proc = main.git("merge", "--ff-only", f"origin/{default}")
    if proc.rc != 0:
        raise Fail(BLOCKED, "not_fast_forward", detail=tail(proc.err or proc.out))
    local, remote = head(main), main.must("rev-parse", f"origin/{default}")
    return {
        "branch": default,
        "before": before,
        "local": local,
        "origin": remote,
        "equal": local == remote,
    }
