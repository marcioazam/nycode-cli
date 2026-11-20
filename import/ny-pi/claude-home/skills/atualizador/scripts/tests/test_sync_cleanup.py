"""sync and cleanup."""

import subprocess
import unittest
from unittest import mock

from support import Base, git, pr_json

from gd_common import Ctx


class Sync(Base):
    def test_fast_forwards_main_to_origin(self):
        moved = self.move_base()
        out = self.ok("sync", "--repo", self.work, "--main-checkout", self.work)
        self.assertEqual(
            (out["branch"], out["before"], out["local"], out["origin"]),
            ("main", self.base_sha, moved, moved),
        )
        self.assertTrue(out["equal"])

    def test_switches_from_a_feature_branch(self):
        self.feature()
        out = self.ok("sync", "--repo", self.work, "--main-checkout", self.work)
        self.assertEqual(git(self.work, "branch", "--show-current"), "main")
        self.assertTrue(out["equal"])

    def test_dirty_checkout_blocks(self):
        (self.work / "README.md").write_text("dirty\n")
        out = self.fails(
            6, "dirty", "sync", "--repo", self.work, "--main-checkout", self.work
        )
        self.assertEqual(len(out["files"]), 1)

    def test_diverged_main_is_not_fast_forward(self):
        self.commit(self.work, "local.txt", "l\n", "local only")
        self.move_base()
        self.fails(
            6,
            "not_fast_forward",
            "sync",
            "--repo",
            self.work,
            "--main-checkout",
            self.work,
        )

    def test_unknown_default_branch(self):
        git(self.work, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
        git(self.work, "update-ref", "-d", "refs/remotes/origin/main")
        self.fails(
            6, "base_missing", "sync", "--repo", self.work, "--main-checkout", self.work
        )


class Cleanup(Base):
    def merged(self, sha, branch="feat", **over):
        self.gh_rules(
            {
                "match": ["pr", "view"],
                "stdout": pr_json("MERGED", headRefOid=sha, headRefName=branch, **over),
            }
        )

    def cleanup(self, *extra):
        return self.call("cleanup", "--repo", self.work, "--pr", "7", *extra)

    def branches(self, repo):
        return git(repo, "branch", "--list", "feat")

    def test_only_a_merged_pr_is_cleaned(self):
        wt = self.worktree()
        self.gh_rules({"match": ["pr", "view"], "stdout": pr_json("OPEN")})
        out = self.fails(
            6,
            "not_merged",
            "cleanup",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--worktree",
            wt,
        )
        self.assertEqual(out["state"], "OPEN")
        self.assertTrue(wt.exists())

    def test_removes_worktree_branch_and_remote_branch(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        self.merged(git(wt, "rev-parse", "HEAD"))
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual(
            out["removed"], {"worktree": str(wt), "branch": True, "remote_branch": True}
        )
        self.assertEqual((out["kept"], out["branch_kept"]), ([], None))
        self.assertFalse(wt.exists())
        self.assertEqual(
            (self.branches(self.work), self.branches(self.origin)), ("", "")
        )

    def test_remote_branch_is_deleted_by_exact_ref_and_never_forced(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        self.merged(git(wt, "rev-parse", "HEAD"))
        real, seen = Ctx.git, []

        def spy(ctx, *args, **kw):
            seen.append(args)
            return real(ctx, *args, **kw)

        with mock.patch.object(Ctx, "git", spy):
            self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertIn(("ls-remote", "origin", "refs/heads/feat"), seen)
        self.assertIn(("push", "origin", "--delete", "refs/heads/feat"), seen)
        flags = [a for args in seen for a in args if a.startswith(("--force", "-f"))]
        self.assertEqual(flags, [])

    def test_a_remote_branch_that_moved_is_kept(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        merged_head = git(wt, "rev-parse", "HEAD")
        other = self.other_clone()
        git(other, "fetch", "-q", "origin", "feat")
        git(other, "switch", "-q", "-c", "feat", "origin/feat")
        self.commit(other, "later.txt", "l\n", "pushed after the merge")
        git(other, "push", "-q", "origin", "feat")
        self.merged(merged_head)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual(
            (out["removed"]["branch"], out["removed"]["remote_branch"]), (True, False)
        )
        self.assertEqual(out["kept"], [{"remote_branch": "feat", "why": "moved"}])
        self.assertNotEqual(self.branches(self.origin), "")

    def tracking(self, name):
        proc = subprocess.run(
            ["git", "rev-parse", "--verify", "-q", f"refs/remotes/origin/{name}"],
            cwd=self.work,
            capture_output=True,
            text=True,
        )
        return proc.stdout.strip() if proc.returncode == 0 else None

    def test_a_remote_branch_auto_deleted_by_the_host_drops_only_its_stale_tracking_ref(
        self,
    ):
        wt = self.worktree()
        sha = git(wt, "rev-parse", "HEAD")
        git(wt, "push", "-q", "origin", "feat", "HEAD:refs/heads/sibling")
        self.merged(sha)
        git(self.origin, "branch", "-D", "feat", "sibling")  # the host's auto-delete
        self.assertEqual(self.tracking("feat"), sha)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual((out["removed"]["remote_branch"], out["kept"]), (False, []))
        self.assertIsNone(self.tracking("feat"))
        self.assertEqual(self.tracking("sibling"), sha)  # other refs are never touched

    def test_a_moved_remote_branch_keeps_its_tracking_ref(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        merged_head = git(wt, "rev-parse", "HEAD")
        other = self.other_clone()
        git(other, "fetch", "-q", "origin", "feat")
        git(other, "switch", "-q", "-c", "feat", "origin/feat")
        self.commit(other, "later.txt", "l\n", "pushed after the merge")
        git(other, "push", "-q", "origin", "feat")
        self.merged(merged_head)
        self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual(self.tracking("feat"), merged_head)

    def test_a_deeper_remote_ref_matching_the_ls_remote_pattern_is_not_the_branch(self):
        wt = self.worktree()
        sha = git(wt, "rev-parse", "HEAD")
        deeper = (
            "refs/heads/x/refs/heads/feat"  # `ls-remote refs/heads/feat` lists it too
        )
        git(wt, "push", "-q", "origin", f"HEAD:{deeper}")
        self.merged(sha)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual((out["removed"]["remote_branch"], out["kept"]), (False, []))
        self.assertEqual(git(self.origin, "rev-parse", "--verify", deeper), sha)

    def test_only_the_exact_remote_ref_is_deleted_beside_a_deeper_one(self):
        wt = self.worktree()
        sha = git(wt, "rev-parse", "HEAD")
        deeper = "refs/heads/x/refs/heads/feat"
        git(wt, "push", "-q", "origin", "HEAD:refs/heads/feat", f"HEAD:{deeper}")
        self.merged(sha)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertTrue(out["removed"]["remote_branch"])
        self.assertEqual(self.branches(self.origin), "")
        self.assertEqual(git(self.origin, "rev-parse", "--verify", deeper), sha)

    def test_a_fork_pr_never_touches_the_remote(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        self.merged(git(wt, "rev-parse", "HEAD"), isCrossRepository=True)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual(
            (out["removed"]["branch"], out["removed"]["remote_branch"]), (True, False)
        )
        self.assertNotEqual(self.branches(self.origin), "")

    def test_default_and_base_branches_are_protected(self):
        git(self.work, "branch", "release")
        sha = git(self.work, "rev-parse", "HEAD")
        for head, base in (("main", "develop"), ("release", "release")):
            self.merged(sha, branch=head, baseRefName=base)
            out = self.ok("cleanup", "--repo", self.work, "--pr", "7")
            self.assertEqual(
                (out["branch_kept"], out["removed"]["branch"]), ("protected", False)
            )
            self.assertNotEqual(git(self.work, "branch", "--list", head), "")

    def test_keep_branch_removes_the_worktree_only(self):
        wt = self.worktree()
        git(wt, "push", "-q", "origin", "feat")
        self.merged(git(wt, "rev-parse", "HEAD"))
        out = self.ok(
            "cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt, "--keep-branch"
        )  # fmt: skip
        self.assertEqual(out["branch_kept"], "requested")
        self.assertFalse(wt.exists())
        self.assertNotEqual(self.branches(self.work), "")
        self.assertNotEqual(self.branches(self.origin), "")

    def ignored_env(self):
        wt = self.worktree()
        self.commit(wt, ".gitignore", ".env\nout.bin\n", "ignore local files")
        (wt / ".env").write_text("K=v\n")
        (wt / "out.bin").write_text("x")
        self.merged(git(wt, "rev-parse", "HEAD"))
        return wt

    def test_ignored_secret_file_in_the_worktree_blocks_unless_discarded(self):
        wt = self.ignored_env()
        out = self.fails(
            6, "dirty", "cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt
        )
        self.assertEqual(
            (out["detail"], out["files"]), ("keep_local_ignored", [".env"])
        )
        self.assertTrue((wt / ".env").exists())
        self.assertNotEqual(self.branches(self.work), "")
        self.ok(
            "cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt, "--discard-ignored"
        )  # fmt: skip
        self.assertFalse(wt.exists())

    def test_ignored_files_that_are_not_secrets_do_not_block(self):
        wt = self.ignored_env()
        (wt / ".env").unlink()
        self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertFalse(wt.exists())

    def test_ignored_caches_and_build_output_do_not_block(self):
        wt = self.worktree()
        self.commit(
            wt, ".gitignore", "__pycache__/\nnode_modules/\n*.log\n", "ignore caches"
        )
        (wt / "__pycache__").mkdir()
        (wt / "__pycache__" / "m.cpython-312.pyc").write_bytes(b"x")
        (wt / "node_modules").mkdir()
        (wt / "node_modules" / "x.js").write_text("x")
        (wt / "app.log").write_text("x")
        self.merged(git(wt, "rev-parse", "HEAD"))
        self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertFalse(wt.exists())

    def dependency_trees(self, wt, ignore):
        """Ignored vendor trees that hold key-looking files no human wrote."""
        self.commit(wt, ".gitignore", ignore, "ignore dependency trees")
        certs = wt / ".venv/lib/python3.12/site-packages/pip/_vendor/certifi"
        snake = wt / "node_modules/agent-base/test"
        for folder, name in ((certs, "cacert.pem"), (snake, "ssl-cert-snakeoil.key")):
            folder.mkdir(parents=True)
            (folder / name).write_text("x\n")

    def test_key_named_files_inside_ignored_dependency_trees_do_not_block(self):
        wt = self.worktree()
        self.dependency_trees(wt, ".venv/\nnode_modules/\n")
        self.merged(git(wt, "rev-parse", "HEAD"))
        self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertFalse(wt.exists())

    def test_a_root_env_still_blocks_beside_ignored_dependency_trees(self):
        wt = self.worktree()
        self.dependency_trees(wt, ".venv/\nnode_modules/\n.env\n")
        (wt / ".env").write_text("K=v\n")
        self.merged(git(wt, "rev-parse", "HEAD"))
        out = self.fails(
            6, "dirty", "cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt
        )
        self.assertEqual(
            (out["detail"], out["files"]), ("keep_local_ignored", [".env"])
        )
        self.assertTrue((wt / ".env").exists())

    def test_untracked_files_in_the_worktree_block_everything(self):
        wt = self.worktree()
        (wt / "scratch.txt").write_text("keep me\n")
        self.merged(git(wt, "rev-parse", "HEAD"))
        out = self.fails(
            6, "dirty", "cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt
        )
        self.assertEqual(out["files"], ["?? scratch.txt"])
        self.assertTrue((wt / "scratch.txt").exists())
        self.assertNotEqual(self.branches(self.work), "")

    def test_branch_is_deleted_only_when_it_still_points_at_the_merged_head(self):
        wt = self.worktree()
        self.merged("a" * 40)
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7", "--worktree", wt)
        self.assertEqual(
            (out["removed"]["worktree"], out["removed"]["branch"]), (str(wt), False)
        )
        self.assertEqual((out["branch_kept"], out["kept"]), ("moved", []))
        self.assertNotEqual(self.branches(self.work), "")

    def test_branch_without_a_worktree_and_missing_branch(self):
        sha = self.feature()
        git(self.work, "switch", "-q", "main")
        self.merged(sha)
        self.assertTrue(
            self.ok("cleanup", "--repo", self.work, "--pr", "7")["removed"]["branch"]
        )
        self.assertEqual(self.branches(self.work), "")
        self.merged(sha, branch="ghost")
        out = self.ok("cleanup", "--repo", self.work, "--pr", "7")
        self.assertEqual((out["removed"]["branch"], out["kept"]), (False, []))

    def test_worktree_argument_is_validated(self):
        self.merged("a" * 40)
        self.fails(
            2,
            "usage",
            "cleanup",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--worktree",
            self.work,
        )
        plain = self.root / "plain"
        plain.mkdir()
        self.fails(
            6,
            "not_a_worktree",
            "cleanup",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--worktree",
            plain,
        )

    def test_gh_failure_is_blocked(self):
        self.gh_rules({"match": ["pr", "view"], "rc": 1, "stderr": "boom"})
        self.fails(6, "gh_failed", "cleanup", "--repo", self.work, "--pr", "7")


if __name__ == "__main__":
    unittest.main()
