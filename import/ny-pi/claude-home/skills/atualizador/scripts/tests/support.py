"""Shared fixtures: real temporary git repositories with a local bare `origin`, stub gh and gitleaks."""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

import git_deliver  # noqa: E402

STUBS = Path(__file__).resolve().parent / "stubs"
REAL_HOME = os.environ.get("HOME", "")  # only the wrapper test needs it
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "T",
    "GIT_AUTHOR_EMAIL": "t@example.test",
    "GIT_COMMITTER_NAME": "T",
    "GIT_COMMITTER_EMAIL": "t@example.test",
}


def git(cwd, *args):
    done = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )
    return done.stdout.strip()


def pr_json(state="OPEN", **over):
    base = {
        "number": 7,
        "url": "https://github.test/o/r/pull/7",
        "state": state,
        "headRefOid": "{HEAD}",
        "headRefName": "feat",
        "baseRefName": "main",
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
        "mergeCommit": {"oid": "m" * 40} if state == "MERGED" else None,
        "isCrossRepository": False,
    }
    return json.dumps({**base, **over})


class Base(unittest.TestCase):
    """One sandbox per test: work (main checkout) + origin.git + other (a second clone) + stubs."""

    real_gitleaks = False

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name).resolve()
        self.stub_dir = self.root / "stub"
        self.bin = self.root / "bin"
        for d in (self.stub_dir, self.bin):
            d.mkdir()
        (self.stub_dir / "rules.json").write_text("[]")
        names = ["gh"] if self.real_gitleaks else ["gh", "gitleaks"]
        for name in names:
            text = (
                (STUBS / name)
                .read_text()
                .replace("#!/usr/bin/env python3", f"#!{sys.executable}", 1)
            )
            (self.bin / name).write_text(text)
            (self.bin / name).chmod(0o755)
        (self.root / "home").mkdir()
        env = {
            **GIT_ENV,
            "HOME": str(self.root / "home"),
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "XDG_CACHE_HOME": str(self.root / "cache"),
            "GH_STUB_DIR": str(self.stub_dir),
            "GL_RC": "0",
        }
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.origin = self.root / "origin.git"
        self.work = self.root / "work"
        git(self.root, "init", "-q", "--bare", "-b", "main", str(self.origin))
        git(self.root, "init", "-q", "-b", "main", str(self.work))
        self.commit(self.work, "README.md", "hello\n", "init")
        git(self.work, "remote", "add", "origin", str(self.origin))
        git(self.work, "push", "-q", "-u", "origin", "main")
        git(
            self.work,
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        )
        self.base_sha = git(self.work, "rev-parse", "HEAD")

    # -- repository helpers
    def commit(self, repo, name, text, message):
        path = Path(repo) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        git(repo, "add", "--", name)
        git(repo, "commit", "-q", "-m", message)
        return git(repo, "rev-parse", "HEAD")

    def feature(self, name="feat", file="feature.txt"):
        git(self.work, "switch", "-q", "-c", name)
        return self.commit(self.work, file, "feature\n", f"feat: add {file}")

    def other_clone(self):
        clone = self.root / "other"
        if not clone.exists():
            git(self.root, "clone", "-q", str(self.origin), str(clone))
        return clone

    def move_base(self, name="upstream.txt", text="up\n"):
        clone = self.other_clone()
        sha = self.commit(clone, name, text, f"base: {name}")
        git(clone, "push", "-q", "origin", "main")
        return sha

    def worktree(self, name="feat", dirname="wt"):
        path = self.root / dirname
        git(self.work, "worktree", "add", "-q", str(path), "-b", name)
        self.commit(path, f"{name}.txt", "x\n", f"feat: {name}")
        return path

    # -- stubs
    def gh_rules(self, *rules):
        (self.stub_dir / "rules.json").write_text(json.dumps(list(rules)))
        (self.stub_dir / "state.json").unlink(missing_ok=True)  # restart every `seq`

    def gh_calls(self):
        path = self.stub_dir / "calls.jsonl"
        return (
            [json.loads(line) for line in path.read_text().splitlines()]
            if path.exists()
            else []
        )

    def gh_calls_of(self, *tokens):
        return [c for c in self.gh_calls() if all(t in c for t in tokens)]

    def gitleaks_calls(self):
        path = self.stub_dir / "gitleaks.jsonl"
        return (
            [json.loads(line) for line in path.read_text().splitlines()]
            if path.exists()
            else []
        )

    # -- running the CLI in-process
    def call(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = git_deliver.main([str(a) for a in argv])
        lines = buf.getvalue().splitlines()
        self.assertEqual(len(lines), 1, buf.getvalue())
        return code, json.loads(lines[0])

    def ok(self, *argv):
        code, out = self.call(*argv)
        self.assertEqual((code, out["ok"]), (0, True), out)
        return out

    def fails(self, expected_code, reason, *argv):
        code, out = self.call(*argv)
        self.assertEqual(
            (code, out["ok"], out["reason"]), (expected_code, False, reason), out
        )
        return out

    def gate(self, repo, *extra, check="t=true"):
        return self.call(
            "gate", "--repo", repo, "--base", "main", "--check", check, *extra
        )

    def proof_file(self, repo, dirty=False):
        sha = git(repo, "rev-parse", "HEAD")
        gdir = git(repo, "rev-parse", "--absolute-git-dir")
        suffix = "-dirty" if dirty else ""
        return Path(gdir, "git-deliver", f"proof-{sha}{suffix}.json")

    def proof(self, repo, dirty=False):
        return json.loads(self.proof_file(repo, dirty).read_text())


def have_gitleaks():
    return shutil.which("gitleaks") is not None


def conflict_setup(case):
    """Feature branch and the base both edit README.md differently; returns the feature head."""
    git(case.work, "switch", "-q", "-c", "feat")
    sha = case.commit(case.work, "README.md", "feature side\n", "feat: edit readme")
    case.commit(case.other_clone(), "README.md", "base side\n", "base: edit readme")
    git(case.other_clone(), "push", "-q", "origin", "main")
    return sha
