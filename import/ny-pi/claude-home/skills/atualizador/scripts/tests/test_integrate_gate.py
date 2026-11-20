"""integrate, gate and the proof it writes."""

import json
import unittest
from pathlib import Path
from unittest import mock

from support import Base, conflict_setup, git

import gd_git


class Integrate(Base):
    def test_up_to_date(self):
        self.feature()
        out = self.ok("integrate", "--repo", self.work, "--base", "main")
        self.assertEqual((out["merged"], out["base_sha"]), (False, self.base_sha))

    def test_merges_moved_base(self):
        self.feature()
        moved = self.move_base()
        out = self.ok("integrate", "--repo", self.work, "--base", "main")
        self.assertTrue(out["merged"])
        self.assertEqual(out["base_sha"], moved)
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), out["head"])
        self.assertEqual(
            len(git(self.work, "rev-list", "--parents", "-n1", "HEAD").split()), 3
        )

    def test_conflict_exits_3_and_leaves_the_merge(self):
        conflict_setup(self)
        out = self.fails(
            3, "conflict", "integrate", "--repo", self.work, "--base", "main"
        )
        self.assertEqual(out["files"], ["README.md"])
        self.assertEqual(self.ok("status", "--repo", self.work)["operation"], "merge")
        again = self.fails(
            3, "conflict", "integrate", "--repo", self.work, "--base", "main"
        )
        self.assertEqual(again["files"], ["README.md"])

    def test_dirty_tracked_tree_blocks(self):
        self.feature()
        (self.work / "feature.txt").write_text("edited\n")
        out = self.fails(6, "dirty", "integrate", "--repo", self.work, "--base", "main")
        self.assertEqual(len(out["files"]), 1)

    def test_missing_base_and_fetch_failure(self):
        self.fails(
            6, "base_missing", "integrate", "--repo", self.work, "--base", "nope"
        )
        git(self.work, "remote", "set-url", "origin", str(self.root / "gone.git"))
        self.fails(6, "git_failed", "integrate", "--repo", self.work, "--base", "main")

    def test_unrelated_histories_is_merge_failed(self):
        other = self.other_clone()
        git(other, "switch", "-q", "--orphan", "island")
        (other / "island.txt").write_text("i\n")
        git(other, "add", "island.txt")
        git(other, "commit", "-q", "-m", "island")
        git(other, "push", "-q", "origin", "island")
        self.fails(
            6, "merge_failed", "integrate", "--repo", self.work, "--base", "island"
        )


class Gate(Base):
    def test_green_writes_proof_and_logs(self):
        self.feature()
        code, out = self.call(
            "gate",
            "--repo",
            self.work,
            "--base",
            "main",
            "--check",
            "t=echo hi",
            "--check",
            "u=true",
        )
        self.assertEqual(code, 0, out)
        self.assertEqual(
            [(c["name"], c["exit"]) for c in out["checks"]], [("t", 0), ("u", 0)]
        )
        self.assertNotIn("tail", out["checks"][0])
        proof = self.proof(self.work)
        head = git(self.work, "rev-parse", "HEAD")
        self.assertEqual(
            (
                proof["head"],
                proof["tree"],
                proof["base_ref"],
                proof["base_sha"],
                proof["dirty"],
            ),
            (
                head,
                git(self.work, "rev-parse", "HEAD^{tree}"),
                "main",
                self.base_sha,
                False,
            ),
        )
        self.assertEqual([c["exit"] for c in proof["checks"]], [0, 0])
        self.assertEqual(Path(out["logs"], "t.log").read_text().strip(), "hi")
        self.assertEqual(Path(out["proof"]).name, f"proof-{head}.json")

    def test_failing_check_runs_all_and_exits_4_with_tail(self):
        self.feature()
        code, out = self.gate(
            self.work, check="bad=for i in 1 2 3; do echo line$i; done; exit 3"
        )
        self.assertEqual((code, out["reason"]), (4, "checks_failed"))
        code, out = self.call(
            "gate",
            "--repo",
            self.work,
            "--base",
            "main",
            "--check",
            "bad=echo oops; exit 3",
            "--check",
            "good=true",
        )
        self.assertEqual(code, 4)
        self.assertEqual([c["exit"] for c in out["checks"]], [3, 0])
        self.assertIn("oops", out["checks"][0]["tail"])
        self.assertEqual([c["exit"] for c in self.proof(self.work)["checks"]], [3, 0])

    def test_dirty_tree_blocks(self):
        (self.work / "README.md").write_text("dirty\n")
        self.fails(6, "dirty", "gate", "--repo", self.work, "--check", "t=true")

    def test_allow_dirty_runs_and_marks_proof_dirty(self):
        (self.work / "README.md").write_text("dirty\n")
        code, out = self.gate(self.work, "--allow-dirty")
        self.assertEqual((code, out["ok"], out["dirty"]), (0, True, True))
        self.assertTrue(self.proof(self.work, dirty=True)["dirty"])
        self.assertFalse(self.proof_file(self.work).exists())

    def test_check_that_modifies_the_tree_is_dirty(self):
        out = self.fails(
            6,
            "dirty",
            "gate",
            "--repo",
            self.work,
            "--base",
            "main",
            "--check",
            "gen=echo x >> README.md",
        )
        self.assertEqual(out["detail"], "checks_modified_tree")
        self.assertTrue(self.proof(self.work, dirty=True)["dirty"])

    def test_untracked_file_blocks_the_gate(self):
        (self.work / "notes.txt").write_text("n\n")
        out = self.fails(6, "dirty", "gate", "--repo", self.work, "--check", "t=true")
        self.assertEqual(out["files"], ["?? notes.txt"])
        self.assertFalse(self.proof_file(self.work).exists())

    def test_keep_local_leaves_untracked_paths_out_of_the_dirty_check(self):
        (self.work / "notes.txt").write_text("n\n")
        (self.work / "scratch").mkdir()
        (self.work / "scratch" / "a.txt").write_text("a\n")
        self.fails(6, "dirty", "gate", "--repo", self.work, "--check", "t=true")
        out = self.ok(
            "gate", "--repo", self.work, "--check", "t=true",
            "--keep-local", "notes.txt", "--keep-local", "scratch",
        )  # fmt: skip
        self.assertFalse(out["dirty"])
        self.assertFalse(self.proof(self.work)["dirty"])

    def test_ignored_and_secret_named_untracked_paths_do_not_block(self):
        self.commit(self.work, ".gitignore", "out/\n", "ignore out")
        (self.work / "out").mkdir()
        (self.work / "out" / "x.bin").write_text("x")
        (self.work / ".env").write_text("K=v\n")
        self.assertFalse(self.gate(self.work)[1]["dirty"])

    def test_an_untracked_source_file_with_a_credential_word_blocks_the_gate(self):
        self.feature()
        (self.work / "src").mkdir()
        (self.work / "src" / "token.py").write_text("X = 1\n")
        out = self.fails(6, "dirty", "gate", "--repo", self.work, "--check", "t=true")
        self.assertEqual(out["files"], ["?? src/token.py"])
        self.assertFalse(self.proof_file(self.work).exists())

    def test_untracked_secret_named_paths_are_listed_as_kept_local(self):
        (self.work / ".env").write_text("K=v\n")
        (self.work / "deploy").mkdir()
        (self.work / "deploy" / "server.pem").write_text("p\n")
        out = self.ok("gate", "--repo", self.work, "--check", "t=true")
        self.assertEqual(out["kept_local"], [".env", "deploy/server.pem"])
        with mock.patch.object(gd_git, "LIST_CAP", 1):
            out = self.ok("gate", "--repo", self.work, "--check", "t=true")
        self.assertEqual(out["kept_local"], [".env"])

    def test_check_leaving_an_untracked_file_is_dirty(self):
        out = self.fails(
            6, "dirty", "gate", "--repo", self.work, "--base", "main",
            "--check", "gen=echo x > generated.txt",
        )  # fmt: skip
        self.assertEqual(out["detail"], "checks_modified_tree")

    def test_dirty_proof_never_replaces_the_clean_proof(self):
        self.feature()
        self.assertEqual(self.gate(self.work)[0], 0)
        clean = self.proof_file(self.work).read_bytes()
        (self.work / "feature.txt").write_text("wip\n")
        code, _ = self.gate(self.work, "--allow-dirty", check="u=true")
        self.assertEqual(code, 0)
        self.assertEqual(self.proof_file(self.work).read_bytes(), clean)
        self.assertEqual(
            [c["name"] for c in self.proof(self.work, dirty=True)["checks"]], ["u"]
        )

    def test_timeout_kills_the_check(self):
        code, out = self.call(
            "gate",
            "--repo",
            self.work,
            "--base",
            "main",
            "--timeout-min",
            "0.01",
            "--check",
            "slow=sleep 30",
        )
        self.assertEqual((code, out["checks"][0]["exit"]), (4, 124))
        self.assertIn("timeout", out["checks"][0]["tail"])

    def test_default_base_comes_from_origin_head(self):
        out = self.ok("gate", "--repo", self.work, "--check", "t=true")
        self.assertEqual(self.proof(self.work)["base_ref"], "main")
        self.assertEqual(out["checks"][0]["exit"], 0)

    def test_proof_lands_in_the_linked_worktree_git_dir(self):
        wt = self.worktree()
        out = self.ok("gate", "--repo", wt, "--base", "main", "--check", "t=true")
        self.assertIn("worktrees", out["proof"])
        self.assertTrue(Path(out["proof"]).is_file())
        self.assertEqual(
            json.loads(Path(out["proof"]).read_text())["head"],
            git(wt, "rev-parse", "HEAD"),
        )


if __name__ == "__main__":
    unittest.main()
