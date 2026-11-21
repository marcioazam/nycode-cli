"""git-deliver plumbing: exit codes, Fail, the single subprocess helper and the per-run log.

Every external call goes through Ctx.run (argument list, timeout, captured output, logged); gate
checks are the one exception and go through Ctx.run_file (`bash -c`, output streamed to a file).
"""

import contextlib
import copy
import datetime
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from typing import NamedTuple

USAGE, NEEDS_LLM, GATE_RED, CI_RED, BLOCKED = 2, 3, 4, 5, 6
REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
LOG_CAP = 20000  # characters of stdout/stderr kept per logged call
ENV_OVERRIDES = {
    "LC_ALL": "C",  # stable git/gh messages for substring matching
    "GIT_TERMINAL_PROMPT": "0",
    "GH_PROMPT_DISABLED": "1",
    "GH_NO_UPDATE_NOTIFIER": "1",
    "NO_COLOR": "1",
    "GIT_MERGE_AUTOEDIT": "no",
}


class Fail(Exception):
    """A mapped failure: `code` is the process exit status, `extra` joins the JSON line."""

    def __init__(self, code, reason, **extra):
        super().__init__(reason)
        self.code, self.reason, self.extra = code, reason, extra


class Proc(NamedTuple):
    rc: int
    out: str
    err: str


def tail(text, n=400):
    return (text or "").strip()[-n:]


def ref(value, what="ref"):
    """Reject anything that could be read as an option or escape a ref namespace."""
    if not REF_RE.match(value or "") or ".." in value or value.endswith((".lock", "/")):
        raise Fail(USAGE, "usage", detail=f"bad_{what}")
    return value


def loads(text):
    try:
        return json.loads(text)
    except ValueError as exc:
        raise Fail(BLOCKED, "gh_failed", detail="bad_json") from exc


def cache_root():
    base = os.environ.get("XDG_CACHE_HOME") or os.path.join(
        os.path.expanduser("~"), ".cache"
    )
    return Path(base) / "git-deliver"


def _log_dir(name):
    """The cache dir, else the temp dir; None when neither is writable (the run goes unlogged)."""
    for base in (cache_root(), Path(tempfile.gettempdir()) / "git-deliver"):
        path = base / name
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        if os.access(path, os.W_OK):
            return path
    return None


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value or ""


class Ctx:
    def __init__(self, repo, cmd):
        path = os.path.realpath(repo)
        if not os.path.isdir(path):
            raise Fail(USAGE, "usage", detail="repo_not_found")
        self.repo, self.cmd = path, cmd
        self.stamp = datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y%m%dT%H%M%SZ"
        )
        name = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(path)) or "repo"
        self.log_dir = _log_dir(name)
        self.log_path = (
            self.log_dir / f"{self.stamp}-{cmd}.log" if self.log_dir else None
        )

    def at(self, path):
        """Same run and log, another repository path (the main checkout)."""
        other = copy.copy(self)
        other.repo = os.path.realpath(path)
        return other

    def log(self, text):
        if self.log_path is None:
            return
        try:
            with open(self.log_path, "a", encoding="utf-8") as fh:
                fh.write(text)
        except OSError:
            self.log_path = None  # best effort: the JSON result must still reach stdout

    def log_error(self):
        self.log(traceback.format_exc())

    def scratch(self, name):
        """A per-run path beside the log; a fresh temp dir when no log dir is writable."""
        return (self.log_dir or Path(tempfile.mkdtemp(prefix="git-deliver-"))) / name

    def run(self, argv, cwd=None, timeout=120):
        cwd = cwd or self.repo
        env = {**os.environ, **ENV_OVERRIDES}
        try:
            done = subprocess.run(
                argv,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=timeout,
                stdin=subprocess.DEVNULL,
                check=False,
            )
            proc = Proc(done.returncode, done.stdout, done.stderr)
        except subprocess.TimeoutExpired as exc:
            proc = Proc(124, _text(exc.stdout), f"timeout after {timeout}s")
        except OSError as exc:
            proc = Proc(127, "", f"{type(exc).__name__}: {exc}")
        self.log(
            f"$ {' '.join(argv)}  (cwd={cwd})\nrc={proc.rc}\n"
            f"--- stdout\n{proc.out[-LOG_CAP:]}\n--- stderr\n{proc.err[-LOG_CAP:]}\n\n"
        )
        return proc

    def git(self, *args, cwd=None, timeout=120):
        return self.run(["git", *args], cwd=cwd, timeout=timeout)

    def gh(self, *args, cwd=None, timeout=120):
        return self.run(["gh", *args], cwd=cwd, timeout=timeout)

    def must(self, *args, cwd=None, timeout=120):
        proc = self.git(*args, cwd=cwd, timeout=timeout)
        if proc.rc != 0:
            raise Fail(
                BLOCKED,
                "git_failed",
                cmd=" ".join(args[:2]),
                detail=tail(proc.err or proc.out),
            )
        return proc.out.rstrip("\n")

    def run_file(self, argv, path, timeout):
        """Run argv with output streamed to `path`; the process group dies on timeout."""
        with open(path, "wb") as fh:
            try:
                child = subprocess.Popen(
                    argv,
                    cwd=self.repo,
                    stdout=fh,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    start_new_session=True,
                )
            except OSError as exc:
                fh.write(f"{type(exc).__name__}: {exc}\n".encode())
                return 127
            try:
                rc = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)  # a group we started ourselves
                child.wait()
                fh.write(f"\n[git-deliver] timeout after {timeout}s\n".encode())
                rc = 124
        self.log(f"$ {' '.join(argv[:2])} <check>  rc={rc}  output={path}\n\n")
        return rc


@contextlib.contextmanager
def repo_lock(ctx):
    """One mutating run per worktree: a non-blocking flock in its own git dir (lanes in other worktrees run)."""
    folder = Path(ctx.must("rev-parse", "--absolute-git-dir")) / "git-deliver"
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / "lock", "a", encoding="utf-8") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Fail(BLOCKED, "locked", lock=str(folder / "lock")) from exc
        yield
