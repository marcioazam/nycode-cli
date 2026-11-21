"""Plumbing, parser, entry point, status and commit."""

import fcntl
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

from support import (  # first: puts the scripts dir on sys.path
    REAL_HOME,
    SCRIPTS,
    Base,
    conflict_setup,
    git,
    have_gitleaks,
    pr_json,
)

import gd_common
import gd_git
import gd_pr
import git_deliver
from gd_common import Ctx, Fail, Proc


class Plumbing(Base):
    def test_run_timeout_missing_binary_and_log(self):
        ctx = Ctx(self.work, "t")
        self.assertEqual(ctx.run(["sleep", "5"], timeout=0.2).rc, 124)
        self.assertEqual(ctx.run(["definitely-not-a-binary-xyz"]).rc, 127)
        self.assertIn("rc=124", ctx.log_path.read_text())
        self.assertIn(
            str(self.root / "cache" / "git-deliver" / "work"), str(ctx.log_path)
        )

    def test_log_dir_falls_back_to_the_temp_dir_then_to_no_log(self):
        blocked = self.root / "blocked"
        blocked.write_text("a file: nothing can be created under it")
        tmp = self.root / "tmp"
        tmp.mkdir()
        gettemp = mock.patch.object(gd_common.tempfile, "gettempdir")
        cache = mock.patch.dict(os.environ, {"XDG_CACHE_HOME": str(blocked)})
        with cache, gettemp as temp_dir:
            temp_dir.return_value = str(tmp)
            out = self.ok("status", "--repo", self.work)
            self.assertTrue(out["log"].startswith(str(tmp / "git-deliver" / "work")))
            temp_dir.return_value = str(blocked)
            ctx = Ctx(self.work, "t")
            self.assertIsNone(ctx.log_path)
            self.assertEqual(ctx.run(["true"]).rc, 0)
            ctx.log("dropped")
            self.assertNotIn("log", self.ok("status", "--repo", self.work))

    def test_must_raises_blocked(self):
        with self.assertRaises(Fail) as caught:
            Ctx(self.work, "t").must("rev-parse", "--verify", "nope")
        self.assertEqual(
            (caught.exception.code, caught.exception.reason), (6, "git_failed")
        )

    def test_ref_validation(self):
        self.assertEqual(gd_common.ref("feat/x-1.2"), "feat/x-1.2")
        for bad in ("", "-x", "a..b", "x.lock", "a/", "a b"):
            with self.assertRaises(Fail, msg=bad):
                gd_common.ref(bad)

    def test_at_and_run_file_errors(self):
        ctx = Ctx(self.work, "t")
        self.assertEqual(ctx.at(self.root).repo, str(self.root))
        self.assertEqual(
            ctx.run_file(["/nonexistent/binary"], self.root / "out.log", 1), 127
        )
        with self.assertRaises(Fail):
            Ctx(self.root / "missing", "t")

    def test_loads_rejects_bad_json(self):
        with self.assertRaises(Fail):
            gd_common.loads("not json")

    def test_gh_fail_reasons(self):
        cases = [
            (Proc(127, "", ""), "gh_missing"),
            (Proc(1, "", "To get started, please run: gh auth login"), "auth"),
            (
                Proc(
                    1, "", "Head branch was modified. Review and try the merge again."
                ),
                "head_moved",
            ),
            (Proc(1, "", "the base branch policy prohibits the merge"), "protection"),
            (Proc(1, "", "At least 1 approving review is required"), "protection"),
            (Proc(1, "", "Pull request is not mergeable"), "not_mergeable"),
            (Proc(1, "", "boom"), "gh_failed"),
        ]
        for proc, reason in cases:
            self.assertEqual(gd_pr.gh_fail(proc).reason, reason, proc)


class Entry(Base):
    def test_usage_errors_exit_2(self):
        readme = ["--repo", self.work, "--path", "README.md"]
        cases = [
            [],
            ["bogus"],
            ["status", "--nope"],
            ["status", "--repo", self.root / "missing"],
            ["commit", "--repo", self.work, "--path", ".", "-m", "x"],
            ["commit", *readme, "-m", "x", "--trailer", "no colon here"],
            ["commit", *readme, "-m", "x", "--message-file", self.root / "m.txt"],
            ["commit", *readme, "--message-file", self.root / "absent.txt"],
            ["integrate", "--repo", self.work, "--base", "-x"],
            ["gate", "--repo", self.work],
            ["gate", "--repo", self.work, "--check", "novalue"],
            ["gate", "--repo", self.work, "--check", "a=true", "--check", "a=true"],
            ["merge", "--repo", self.work, "--pr", "x"],
            ["-h"],
            ["--help"],
            ["status", "-h"],
            ["gate", "--help"],
        ]
        (self.root / "m.txt").write_text("m")
        for argv in cases:
            code, out = self.call(*argv)
            self.assertEqual(
                (code, out["ok"], out["reason"]), (2, False, "usage"), argv
            )

    def test_option_abbreviations_are_not_accepted(self):
        wt = self.root / "wt"
        for argv in (
            ["cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt, "--disc"],
            ["cleanup", "--repo", self.work, "--pr", "7", "--keep-b"],
            ["ship", "--repo", self.work, "--base", "main", "--no-m"],
            ["--rep", self.work, "status"],
        ):
            code, out = self.call(*argv)
            self.assertEqual((code, out["reason"]), (2, "usage"), argv)

    def test_a_held_lock_blocks_mutating_commands_but_not_status(self):
        folder = Path(git(self.work, "rev-parse", "--absolute-git-dir"), "git-deliver")
        folder.mkdir(parents=True, exist_ok=True)
        holder = open(folder / "lock", "a", encoding="utf-8")
        self.addCleanup(holder.close)
        fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
        mutating = (
            ("commit", "--path", "x", "-m", "m"),
            ("integrate", "--base", "main"),
            ("gate", "--check", "t=true"),
            ("publish", "--base", "main"),
            ("merge", "--pr", "7"),
            ("sync", "--main-checkout", self.work),
            ("cleanup", "--pr", "7"),
            ("ship", "--base", "main"),
        )
        for cmd, *rest in mutating:
            out = self.fails(6, "locked", cmd, "--repo", self.work, *rest)
            self.assertEqual(out["lock"], str(folder / "lock"))
        self.ok("status", "--repo", self.work)
        holder.close()
        self.ok("sync", "--repo", self.work, "--main-checkout", self.work)
        self.ok("sync", "--repo", self.work, "--main-checkout", self.work)

    def test_internal_error_has_no_traceback_on_stdout(self):
        def boom(ctx, args):
            raise RuntimeError("kaput")

        with mock.patch.dict(git_deliver.COMMANDS, {"status": boom}):
            out = self.fails(6, "internal_error", "status", "--repo", self.work)
        self.assertIn("kaput", out["detail"])
        self.assertIn("Traceback", Path(out["log"]).read_text())

    def test_subprocess_isolated_mode_and_wrapper(self):
        script = SCRIPTS / "git_deliver.py"
        done = subprocess.run(
            [sys.executable, "-I", str(script), "status", "--repo", str(self.work)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(len(done.stdout.splitlines()), 1)
        bad = subprocess.run(
            [sys.executable, "-I", str(script), "bogus"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(bad.returncode, 2)
        wrapper = SCRIPTS.parents[2] / "bin" / "git-deliver"
        if wrapper.exists() and os.access(wrapper, os.X_OK):
            done = subprocess.run(
                [str(wrapper), "bogus"],
                capture_output=True,
                text=True,
                check=False,
                env={
                    **os.environ,
                    "HOME": REAL_HOME,
                },  # the wrapper resolves $HOME/.claude
            )
            self.assertEqual(done.returncode, 2)
            self.assertEqual(json.loads(done.stdout)["reason"], "usage")


class SecretNamed(unittest.TestCase):
    def test_credential_looking_names_only(self):
        secret = [
            ".env", ".env.local", "server.pem", "pkg/id_rsa", "credentials",
            "config/credentials.yaml", "app/Credentials.JSON", "gh_token.json", "token.txt",
            "tokens", "secrets.toml", "app.credentials", "deploy/auth.json",
        ]  # fmt: skip
        source = [
            "pkg/lexer/token.go", "auth/credentials.py", "src/token.py", "tokenizer.py",
            ".env.example", "tools/build/run.sh", "testdata/sample.log", "credentials.rs",
            "gh_token", ".venv/lib/python3.12/site-packages/certifi/cacert.pem",
            "node_modules/agent-base/test/ssl-cert-snakeoil.key", "target/debug/server.key",
        ]  # fmt: skip
        self.assertEqual([p for p in secret if not gd_git.secret_named(p)], [])
        self.assertEqual([p for p in source if gd_git.secret_named(p)], [])


class Status(Base):
    def test_clean_main(self):
        out = self.ok("status", "--repo", self.work)
        self.assertEqual(
            (
                out["branch"],
                out["upstream"],
                out["default_branch"],
                out["ahead"],
                out["behind"],
            ),
            ("main", "origin/main", "main", 0, 0),
        )
        self.assertEqual(
            (out["base_ahead"], out["base_behind"], out["operation"], out["clean"]),
            (0, 0, None, True),
        )
        self.assertEqual((out["stashes"]["count"], len(out["worktrees"])), (0, 1))
        self.assertEqual(out["head"], self.base_sha)

    def test_feature_branch_counts_and_worktrees(self):
        self.feature()
        self.worktree("other-wt", "wt2")
        out = self.ok("status", "--repo", self.work)
        self.assertEqual(
            (out["base_ahead"], out["base_behind"], out["upstream"]), (1, 0, None)
        )
        self.assertEqual(len(out["worktrees"]), 2)
        self.assertEqual(out["worktrees"][1]["branch"], "other-wt")

    def test_classification(self):
        w = self.work
        self.commit(w, "old.txt", "o\n", "add old")
        (w / "README.md").write_text("changed\n")
        for name in (
            ".env",
            ".env.example",
            "notes.txt",
            "node_modules/x.js",
            "id_rsa",
            "build/out.bin",
        ):
            (w / name).parent.mkdir(parents=True, exist_ok=True)
            (w / name).write_text("x")
        (w / "added.txt").write_text("a")
        (w / "added.pem").write_text("p")
        git(w, "add", "added.txt", "added.pem")
        git(w, "mv", "old.txt", "new.txt")
        files = self.ok("status", "--repo", w)["files"]
        self.assertEqual(
            sorted(files["publish"]), ["README.md", "added.txt", "new.txt"]
        )
        self.assertEqual(
            sorted(files["unknown"]),
            [".env.example", "build/out.bin", "node_modules/x.js", "notes.txt"],
        )
        self.assertEqual(sorted(files["keep_local"]), [".env", "added.pem", "id_rsa"])

    def test_tracked_modified_secret_named_file_stays_keep_local(self):
        self.commit(self.work, "server.pem", "p\n", "add pem")
        (self.work / "server.pem").write_text("rotated\n")
        (self.work / "README.md").write_text("changed\n")
        files = self.ok("status", "--repo", self.work)["files"]
        self.assertEqual(files["keep_local"], ["server.pem"])
        self.assertEqual(files["publish"], ["README.md"])

    def test_stash_names_and_truncation(self):
        git(
            self.work,
            "update-ref",
            "--create-reflog",
            "-m",
            "On main: wip",
            "refs/stash",
            "HEAD",
        )
        for name in ("a.txt", "b.txt"):
            (self.work / name).write_text("x")
        with mock.patch.object(gd_git, "LIST_CAP", 1):
            out = self.ok("status", "--repo", self.work)
        self.assertEqual(
            (out["stashes"]["count"], out["stashes"]["names"]), (1, ["On main: wip"])
        )
        self.assertEqual((out["truncated"], len(out["files"]["unknown"])), (True, 1))

    def test_merge_in_progress(self):
        conflict_setup(self)
        git(self.work, "fetch", "-q")
        subprocess.run(
            ["git", "merge", "origin/main"],
            cwd=self.work,
            capture_output=True,
            check=False,
        )
        out = self.ok("status", "--repo", self.work)
        self.assertEqual(out["operation"], "merge")
        self.assertIn("README.md", out["files"]["publish"])

    def test_detached_and_unborn(self):
        git(self.work, "checkout", "-q", "--detach")
        self.assertIsNone(self.ok("status", "--repo", self.work)["branch"])
        fresh = self.root / "fresh"
        git(self.root, "init", "-q", "-b", "main", str(fresh))
        out = self.ok("status", "--repo", fresh)
        self.assertEqual((out["head"], out["default_branch"]), (None, None))

    def test_not_a_repository(self):
        plain = self.root / "plain"
        plain.mkdir()
        self.fails(6, "git_failed", "status", "--repo", plain)

    def test_default_branch_falls_back_to_refs(self):
        git(self.work, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
        self.assertEqual(
            self.ok("status", "--repo", self.work)["default_branch"], "main"
        )


class Commit(Base):
    def setUp(self):
        super().setUp()
        git(
            self.work, "switch", "-q", "-c", "topic"
        )  # commit never runs on the default branch

    def new_files(self, *names):
        for name in names:
            (self.work / name).write_text(f"{name}\n")

    def test_stages_only_paths_and_adds_trailers(self):
        self.new_files("a.txt", "b.txt")
        out = self.ok(
            "commit", "--repo", self.work, "--path", "a.txt", "-m", "feat: a",
            "--trailer", "Co-Authored-By: X <x@example.test>", "--trailer", "Assisted-by: claude:test",
        )  # fmt: skip
        self.assertEqual(
            (out["committed"], out["sha"]), (True, git(self.work, "rev-parse", "HEAD"))
        )
        message = git(self.work, "log", "-1", "--format=%B")
        self.assertIn("Co-Authored-By: X <x@example.test>", message)
        self.assertIn("Assisted-by: claude:test", message)
        self.assertEqual(git(self.work, "status", "--porcelain"), "?? b.txt")
        self.assertEqual(
            self.gitleaks_calls(),
            [["git", "--staged", "--redact", "--no-banner", "--exit-code", "77"]],
        )

    def test_message_file(self):
        self.new_files("a.txt")
        (self.root / "msg.txt").write_text("feat: from file\n")
        self.ok(
            "commit",
            "--repo",
            self.work,
            "--path",
            "a.txt",
            "--message-file",
            self.root / "msg.txt",
        )
        self.assertEqual(git(self.work, "log", "-1", "--format=%s"), "feat: from file")

    def test_on_the_default_branch_commit_refuses_without_branch(self):
        git(self.work, "switch", "-q", "main")
        self.new_files("a.txt")
        before = git(self.work, "rev-parse", "HEAD")
        out = self.fails(
            6, "on_base_branch", "commit", "--repo", self.work, "--path", "a.txt", "-m", "x"
        )  # fmt: skip
        self.assertEqual(out["branch"], "main")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), before)
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.work, "branch", "--show-current"), "main")

    def test_branch_creates_it_from_the_default_branch_and_commits_there(self):
        git(self.work, "switch", "-q", "main")
        self.new_files("a.txt")
        out = self.ok(
            "commit", "--repo", self.work, "--path", "a.txt", "-m", "feat: a",
            "--branch", "feat/a",
        )  # fmt: skip
        self.assertEqual(out["branch_created"], "feat/a")
        self.assertEqual(git(self.work, "branch", "--show-current"), "feat/a")
        self.assertEqual(git(self.work, "rev-parse", "main"), self.base_sha)
        self.assertEqual(
            git(self.work, "log", "-1", "--format=%s", "feat/a"), "feat: a"
        )
        self.assertEqual(git(self.work, "stash", "list"), "")

    def test_branch_from_a_detached_head_and_without_one(self):
        git(self.work, "switch", "-q", "--detach", "main")
        self.new_files("a.txt")
        args = ("commit", "--repo", self.work, "--path", "a.txt", "-m", "x")
        out = self.fails(6, "on_base_branch", *args)
        self.assertEqual(out["detail"], "detached_head")
        self.assertEqual(
            self.ok(*args, "--branch", "feat/a")["branch_created"], "feat/a"
        )

    def test_branch_that_exists_or_names_the_default_is_refused(self):
        git(self.work, "switch", "-q", "main")
        git(self.work, "branch", "feat/a")
        self.new_files("a.txt")
        args = ("commit", "--repo", self.work, "--path", "a.txt", "-m", "x")
        self.fails(6, "branch_exists", *args, "--branch", "feat/a")
        out = self.fails(2, "usage", *args, "--branch", "main")
        self.assertEqual(out["detail"], "branch_is_protected")
        self.fails(2, "usage", *args, "--branch", "-x")
        self.assertEqual(git(self.work, "branch", "--show-current"), "main")
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")

    def test_branch_on_a_feature_branch_is_a_no_op_or_a_mismatch(self):
        self.new_files("a.txt")
        args = ("commit", "--repo", self.work, "--path", "a.txt", "-m", "x")
        out = self.fails(6, "branch_mismatch", *args, "--branch", "other")
        self.assertEqual((out["branch"], out["requested"]), ("topic", "other"))
        self.assertEqual(git(self.work, "branch", "--list", "other"), "")
        out = self.ok(*args, "--branch", "topic")
        self.assertNotIn("branch_created", out)

    def test_a_failure_after_the_switch_reports_the_created_branch(self):
        git(self.work, "switch", "-q", "main")
        (self.work / "server.pem").write_text("k\n")
        out = self.fails(
            6, "secret", "commit", "--repo", self.work, "--path", "server.pem", "-m", "x",
            "--branch", "feat/a",
        )  # fmt: skip
        self.assertEqual(out["branch_created"], "feat/a")

    def test_paths_that_resolve_to_the_repository_or_outside_it_are_refused(self):
        self.new_files("a.txt")
        for bad in ("sub/..", "../x", "a.txt/..", "./", "sub/../.."):
            out = self.fails(
                2, "usage", "commit", "--repo", self.work, "--path", bad, "-m", "x"
            )
            self.assertEqual(out["detail"], "explicit_paths_required", bad)
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")

    def test_no_message_exits_3_before_staging(self):
        self.new_files("a.txt")
        self.fails(3, "no_message", "commit", "--repo", self.work, "--path", "a.txt")
        self.assertEqual(git(self.work, "status", "--porcelain"), "?? a.txt")

    def test_nothing_to_commit_is_idempotent(self):
        out = self.ok(
            "commit", "--repo", self.work, "--path", "README.md", "-m", "noop"
        )
        self.assertEqual((out["committed"], out["sha"]), (False, self.base_sha))

    def test_secret_blocks_and_unstages(self):
        self.new_files("a.txt")
        with mock.patch.dict(os.environ, {"GL_RC": "77"}):
            self.fails(
                6, "secret", "commit", "--repo", self.work, "--path", "a.txt", "-m", "x"
            )
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), self.base_sha)

    def test_scanner_error_is_not_reported_as_a_secret(self):
        self.new_files("a.txt")
        with mock.patch.dict(os.environ, {"GL_RC": "1"}):
            out = self.fails(
                6,
                "scan_failed",
                "commit",
                "--repo",
                self.work,
                "--path",
                "a.txt",
                "-m",
                "x",
            )
        self.assertEqual((out["scanner_rc"], out["scanner_missing"]), (1, False))
        self.assertIn("stub gitleaks", out["detail"])
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")

    def test_stderr_error_with_exit_zero_is_scan_failed(self):
        # gitleaks#1981: it exits 0 when the underlying git command fails
        self.new_files("a.txt")
        for line in (
            "9:00AM ERR [git] boom",
            "9:00AM FTL cannot scan",
            "fatal: bad object",
        ):
            with mock.patch.dict(os.environ, {"GL_STDERR": line}):
                out = self.fails(
                    6, "scan_failed", "commit", "--repo", self.work, "--path", "a.txt", "-m", "x"
                )  # fmt: skip
            self.assertEqual((out["scanner_rc"], out["scanner_missing"]), (0, False))
            self.assertIn(line.split(" ", 1)[-1], out["detail"])
            self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), self.base_sha)

    def test_keep_local_path_under_a_directory_is_unstaged(self):
        (self.work / "pkg").mkdir()
        (self.work / "pkg" / "m.py").write_text("x\n")
        (self.work / "pkg" / "id_rsa").write_text("k\n")
        out = self.fails(
            6, "secret", "commit", "--repo", self.work, "--path", "pkg", "-m", "x"
        )
        self.assertEqual(
            (out["detail"], out["files"]), ("secret_named_path", ["pkg/id_rsa"])
        )
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), self.base_sha)
        self.assertEqual(self.gitleaks_calls(), [])

    def test_a_secret_named_file_is_refused_even_when_named(self):
        (self.work / "server.pem").write_text("p\n")
        out = self.fails(
            6,
            "secret",
            "commit",
            "--repo",
            self.work,
            "--path",
            "server.pem",
            "-m",
            "x",
        )
        self.assertEqual(
            (out["detail"], out["files"]), ("secret_named_path", ["server.pem"])
        )
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")

    def test_explicit_paths_commit_even_when_the_name_looks_local(self):
        names = (
            "pkg/lexer/token.go", "auth/credentials.py", "tools/build/run.sh", "testdata/sample.log",
        )  # fmt: skip
        for name in names:
            (self.work / name).parent.mkdir(parents=True, exist_ok=True)
            (self.work / name).write_text("x\n")
            target = self.work / name if name.endswith(".log") else name
            out = self.ok(
                "commit", "--repo", self.work, "--path", target, "-m", "feat: x"
            )
            self.assertTrue(out["committed"], name)
            shown = git(self.work, "show", "--name-only", "--format=", "HEAD")
            self.assertEqual(shown, name)

    def test_a_swept_local_looking_file_is_refused_unless_named(self):
        (self.work / "tools" / "build").mkdir(parents=True)
        (self.work / "tools" / "build" / "run.sh").write_text("x\n")
        (self.work / "tools" / "ok.sh").write_text("x\n")
        out = self.fails(
            6, "keep_local_path", "commit", "--repo", self.work, "--path", "tools", "-m", "x"
        )  # fmt: skip
        self.assertEqual(out["files"], ["tools/build/run.sh"])
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), self.base_sha)

    def test_missing_scanner_blocks(self):
        self.new_files("a.txt")
        with mock.patch.dict(os.environ, {"PATH": f"{self.bin}:/usr/bin:/bin"}):
            (self.bin / "gitleaks").unlink()
            out = self.fails(
                6,
                "scan_failed",
                "commit",
                "--repo",
                self.work,
                "--path",
                "a.txt",
                "-m",
                "x",
            )
        self.assertTrue(out["scanner_missing"])

    def test_other_staged_paths_block(self):
        self.new_files("a.txt", "b.txt")
        git(self.work, "add", "b.txt")
        out = self.fails(
            6, "dirty", "commit", "--repo", self.work, "--path", "a.txt", "-m", "x"
        )
        self.assertEqual(out["staged_other"], ["b.txt"])

    def test_directory_path_covers_staged_children(self):
        (self.work / "pkg").mkdir()
        (self.work / "pkg" / "m.py").write_text("x")
        git(self.work, "add", "pkg/m.py")
        self.assertTrue(
            self.ok("commit", "--repo", self.work, "--path", "pkg", "-m", "pkg")[
                "committed"
            ]
        )

    def test_hook_failure_reports_commit_failed(self):
        hook = self.work / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\necho nope >&2\nexit 1\n")
        hook.chmod(0o755)
        self.new_files("a.txt")
        out = self.fails(
            6,
            "commit_failed",
            "commit",
            "--repo",
            self.work,
            "--path",
            "a.txt",
            "-m",
            "x",
        )
        self.assertIn("nope", out["detail"])

    def test_concludes_a_resolved_merge(self):
        conflict_setup(self)
        self.fails(3, "conflict", "integrate", "--repo", self.work, "--base", "main")
        (self.work / "README.md").write_text("resolved\n")
        out = self.ok(
            "commit", "--repo", self.work, "--path", "README.md", "-m", "merge: resolve"
        )
        self.assertTrue(out["committed"])
        again = self.ok("integrate", "--repo", self.work, "--base", "main")
        self.assertFalse(again["merged"])


@unittest.skipUnless(have_gitleaks(), "gitleaks not installed")
class RealGitleaks(Base):
    real_gitleaks = True

    def setUp(self):
        super().setUp()
        git(
            self.work, "switch", "-q", "-c", "topic"
        )  # commit refuses the default branch

    def test_fake_aws_key_is_blocked_and_clean_file_passes(self):
        (self.work / "creds.py").write_text(
            'aws_access_key_id = "AKIAQYLPMN5HHHFPZAM2"\n'
        )
        out = self.fails(
            6, "secret", "commit", "--repo", self.work, "--path", "creds.py", "-m", "x"
        )
        self.assertNotIn("scanner_rc", out)
        (self.work / "ok.txt").write_text("fine\n")
        self.assertTrue(
            self.ok("commit", "--repo", self.work, "--path", "ok.txt", "-m", "ok")[
                "committed"
            ]
        )

    def merge_commit(self, extra=None):
        """feat plus a moved base joined by a 2-parent merge commit that may add `extra` itself."""
        self.feature()
        self.move_base()
        git(self.work, "fetch", "-q")
        git(self.work, "merge", "-q", "--no-ff", "--no-commit", "origin/main")
        if extra:
            (self.work / extra[0]).write_text(extra[1])
            git(self.work, "add", "--", extra[0])
        git(self.work, "commit", "-q", "-m", "merge origin/main")
        self.assertEqual(
            len(git(self.work, "rev-list", "--parents", "-n1", "HEAD").split()), 3
        )
        self.assertEqual(self.gate(self.work)[0], 0)
        self.gh_rules(
            {"match": ["pr", "list"], "stdout": "[]"},
            {"match": ["pr", "create"], "stdout": "https://github.test/o/r/pull/7\n"},
            {"match": ["pr", "view"], "stdout": pr_json()},
        )

    def test_secret_added_by_a_merge_commit_is_blocked_at_publish(self):
        self.merge_commit(("creds.py", 'aws_access_key_id = "AKIAQYLPMN5HHHFPZAM2"\n'))
        self.fails(6, "secret", "publish", "--repo", self.work, "--base", "main")
        self.assertEqual(git(self.origin, "branch", "--list", "feat"), "")
        self.assertEqual(self.gh_calls_of("pr", "create"), [])

    def test_clean_merge_commit_publishes(self):
        self.merge_commit(("notes.txt", "fine\n"))
        out = self.ok("publish", "--repo", self.work, "--base", "main")
        self.assertEqual((out["pr"], out["created"]), (7, True))
        self.assertEqual(git(self.origin, "rev-parse", "feat"), out["head"])


if __name__ == "__main__":
    unittest.main()
