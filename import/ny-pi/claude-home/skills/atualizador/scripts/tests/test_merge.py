"""merge: proof, head and base checks, CI policy, argv hygiene, queued merges."""

import json
import unittest
from pathlib import Path
from unittest import mock

from support import Base, git, pr_json  # first: puts the scripts dir on sys.path

import gd_merge

GREEN = "build\tpass\t1m\thttps://ci.test/build\t\n"
RED = "build\tfail\t1m\thttps://ci.test/build\t\n"
BILLING = "payments have failed"


class MergeBase(Base):
    def setUp(self):
        super().setUp()
        self.feature()
        self.sha = git(self.work, "rev-parse", "HEAD")

    def proven(self, *extra):
        code, out = self.gate(self.work, *extra)
        self.assertEqual(code, 0, out)

    def rules(self, views=None, merge=None, checks=None, extra=()):
        self.gh_rules(
            *extra,
            {"match": ["pr", "checks"], **(checks or {"stdout": GREEN})},
            {"match": ["pr", "merge"], **(merge or {})},
            {
                "match": ["pr", "view"],
                "seq": [
                    {"stdout": v} for v in (views or [pr_json(), pr_json("MERGED")])
                ],
            },
        )

    def merge(self, *extra):
        return self.call("merge", "--repo", self.work, "--pr", "7", *extra)


class Merge(MergeBase):
    def test_merges_with_match_head_commit_and_no_forbidden_flags(self):
        self.proven()
        self.rules()
        code, out = self.merge()
        self.assertEqual(
            (code, out["merged"], out["merge_commit"], out["head"]),
            (0, True, "m" * 40, self.sha),
        )
        (call,) = self.gh_calls_of("pr", "merge")
        self.assertEqual(call[:4], ["pr", "merge", "7", "--squash"])
        self.assertEqual(call[call.index("--match-head-commit") + 1], self.sha)
        for flag in ("--admin", "--delete-branch", "--force", "-d", "--auto"):
            self.assertNotIn(flag, call)
        (checks,) = self.gh_calls_of("pr", "checks")
        self.assertNotIn("--watch", checks)

    def test_methods(self):
        self.proven()
        for method in ("merge", "rebase"):
            self.rules()
            self.ok("merge", "--repo", self.work, "--pr", "7", "--method", method)
            self.assertIn(f"--{method}", self.gh_calls_of("pr", "merge")[-1])

    def test_already_merged_is_idempotent(self):
        self.rules(views=[pr_json("MERGED")])
        out = self.ok("merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["merge_commit"], "m" * 40)
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])

    def test_unmergeable_states(self):
        self.proven()
        for view in (
            pr_json("CLOSED"),
            pr_json(mergeable="CONFLICTING"),
            pr_json(mergeStateStatus="DIRTY"),
        ):
            self.rules(views=[view])
            self.fails(6, "not_mergeable", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])

    def test_no_proof(self):
        self.rules()
        self.fails(6, "no_proof", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])

    def test_failed_proof_blocks(self):
        self.gate(self.work, check="bad=exit 1")
        self.rules()
        out = self.fails(6, "no_proof", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["detail"], "proof_checks_failed")

    def test_dirty_proof_blocks_merge(self):
        (self.work / "feature.txt").write_text("wip\n")
        self.proven("--allow-dirty")
        self.assertTrue(self.proof(self.work, dirty=True)["dirty"])
        git(self.work, "checkout", "--", "feature.txt")
        self.rules()
        self.fails(6, "dirty", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])

    def test_pr_head_moved(self):
        self.proven()
        self.rules(views=[pr_json(headRefOid="e" * 40)])
        out = self.fails(6, "head_moved", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["pr_head"], "e" * 40)

    def test_local_head_moved_after_the_proof(self):
        self.proven()
        self.commit(self.work, "later.txt", "l\n", "later")
        self.rules(views=[pr_json(headRefOid=self.sha)])
        out = self.fails(6, "head_moved", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["pr_head"], self.sha)
        self.assertNotEqual(out["local_head"], self.sha)

    def test_base_moved(self):
        self.proven()
        moved = self.move_base()
        self.rules()
        out = self.fails(6, "base_moved", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(
            (out["base_sha"], out["proof_base_sha"]), (moved, self.base_sha)
        )

    def test_branch_behind_a_fetched_base_is_base_moved(self):
        # the gate ran after a fetch, so the proof's base_sha equals origin/main although HEAD lacks it
        moved = self.move_base()
        git(self.work, "fetch", "-q")
        self.proven()
        self.assertEqual(self.proof(self.work)["base_sha"], moved)
        self.rules()
        out = self.fails(6, "base_moved", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual((out["base_sha"], out["proof_base_sha"]), (moved, moved))
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])

    def test_base_moved_but_already_contained_in_head_is_fine(self):
        self.move_base()
        git(self.work, "fetch", "-q")
        git(self.work, "merge", "-q", "--no-edit", "origin/main")
        code, out = self.gate(self.work)
        self.assertEqual(code, 0, out)
        path = Path(out["proof"])
        data = json.loads(path.read_text())
        data["base_sha"] = self.base_sha  # recorded before the base moved
        path.write_text(json.dumps(data))
        self.rules()
        self.ok("merge", "--repo", self.work, "--pr", "7")

    def test_proof_for_another_base_is_stale(self):
        self.proven()
        self.rules(views=[pr_json(baseRefName="develop"), pr_json("MERGED")])
        self.fails(6, "base_moved", "merge", "--repo", self.work, "--pr", "7")

    def test_ci_policy(self):
        self.proven()
        self.rules(
            checks={"rc": 1, "stdout": RED}, extra=[{"match": ["api"], "stdout": "[]"}]
        )
        out = self.fails(5, "ci_unknown", "merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["status"], "red")
        self.assertEqual(self.gh_calls_of("pr", "merge"), [])
        self.rules(
            checks={"rc": 8, "stdout": "build\tpending\t1m\thttps://ci.test/build\t\n"}
        )
        self.fails(5, "pending_timeout", "merge", "--repo", self.work, "--pr", "7")

    def billing_extra(self):
        run = {"id": 11, "conclusion": "failure", "output": {}}
        return [
            {
                "match": ["api", "~annotations"],
                "stdout": json.dumps([{"message": BILLING}]),
            },
            {"match": ["api", "~actions/jobs"], "stdout": json.dumps({"steps": []})},
            {
                "match": ["api", "~check-runs"],
                "stdout": json.dumps({"check_runs": [run]}),
            },
        ]

    def test_billing_allows_the_merge_unless_remote_ci_is_required(self):
        self.proven()
        views = [pr_json(), pr_json(), pr_json("MERGED")]
        self.rules(
            views=views, checks={"rc": 1, "stdout": RED}, extra=self.billing_extra()
        )
        with mock.patch.object(gd_merge, "POLL_SECS", 0):
            out = self.ok("merge", "--repo", self.work, "--pr", "7")
        self.assertEqual(out["merged"], True)
        self.rules(
            views=[pr_json()],
            checks={"rc": 1, "stdout": RED},
            extra=self.billing_extra(),
        )
        out = self.fails(
            5,
            "ci_required",
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--require-remote-ci",
        )
        self.assertEqual(out["status"], "not_started_billing")

    def test_no_checks_is_allowed_unless_required(self):
        self.proven()
        self.rules(
            checks={"rc": 1, "stderr": "no checks reported on the 'feat' branch"}
        )
        self.ok("merge", "--repo", self.work, "--pr", "7")
        self.rules(
            views=[pr_json()],
            checks={"rc": 1, "stderr": "no checks reported on the 'feat' branch"},
        )
        self.fails(
            5,
            "ci_required",
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--require-remote-ci",
        )

    def test_gh_merge_errors_are_classified(self):
        self.proven()
        cases = {
            "protection": "the base branch policy prohibits the merge",
            "auth": "gh auth login",
            "head_moved": "Head branch was modified",
            "gh_failed": "boom",
        }
        for reason, message in cases.items():
            self.rules(views=[pr_json()], merge={"rc": 1, "stderr": message})
            self.fails(6, reason, "merge", "--repo", self.work, "--pr", "7")

    def test_method_and_budget_reach_gh(self):
        self.proven()
        self.rules()
        self.ok(
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--method",
            "rebase",
            "--budget-min",
            "1",
        )
        self.assertIn("--rebase", self.gh_calls_of("pr", "merge")[-1])


class MergeMessage(MergeBase):
    """--subject/--body-file reach gh; the merged commit's trailers come back in the JSON."""

    def body(self, text="body\n\nAssisted-by: claude-code:claude-sonnet-5-5\n"):
        path = self.root / "squash.md"
        path.write_text(text, encoding="utf-8")
        return path

    def test_subject_and_body_file_are_forwarded_with_every_guard(self):
        self.proven()
        self.rules()
        body = self.body()
        self.ok(
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--subject",
            "feat: x",
            "--body-file",
            body,
        )
        (call,) = self.gh_calls_of("pr", "merge")
        self.assertEqual(call[call.index("--subject") + 1], "feat: x")
        self.assertEqual(call[call.index("--body-file") + 1], str(body))
        self.assertEqual(call[call.index("--match-head-commit") + 1], self.sha)
        self.assertEqual(call[:4], ["pr", "merge", "7", "--squash"])

    def test_without_the_options_the_command_line_is_unchanged(self):
        self.proven()
        self.rules()
        self.ok("merge", "--repo", self.work, "--pr", "7")
        (call,) = self.gh_calls_of("pr", "merge")
        self.assertEqual(
            call, ["pr", "merge", "7", "--squash", "--match-head-commit", self.sha]
        )

    def test_invalid_options_are_usage_errors_before_any_gh_call(self):
        self.proven()
        self.rules()
        (self.root / "bad.md").write_bytes(b"\xff\xfe\x00bad")
        cases = [
            ("body_file_missing", ["--body-file", self.root / "absent.md"]),
            ("body_file_unreadable", ["--body-file", self.root / "bad.md"]),
            ("subject_invalid", ["--subject", "one\ntwo"]),
            ("subject_invalid", ["--subject", "one\rtwo"]),
            ("subject_invalid", ["--subject", "  "]),
            ("message_needs_squash_or_merge", ["--subject", "s", "--method", "rebase"]),
        ]
        for detail, extra in cases:
            out = self.fails(
                2, "usage", "merge", "--repo", self.work, "--pr", "7", *extra
            )
            self.assertEqual(out["detail"], detail)
        self.assertEqual(self.gh_calls(), [])

    def test_merge_method_accepts_the_message(self):
        self.proven()
        self.rules()
        self.ok(
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--method",
            "merge",
            "--subject",
            "s",
        )
        self.assertIn("--subject", self.gh_calls_of("pr", "merge")[-1])

    def trailers(self, api, views=None):
        self.proven()
        self.rules(
            views=views, extra=[{"match": ["api", "~git/commits/" + "m" * 40], **api}]
        )
        return self.ok("merge", "--repo", self.work, "--pr", "7")[
            "merge_commit_trailers"
        ]

    def test_trailers_of_the_merge_commit_are_reported(self):
        message = "feat: x\n\nbody\n\nAssisted-by: claude-code:claude-sonnet-5-5\n\nCo-authored-by: A <a@x.test>\n"
        self.assertEqual(
            self.trailers({"stdout": json.dumps({"message": message})}),
            [
                "Assisted-by: claude-code:claude-sonnet-5-5",
                "Co-authored-by: A <a@x.test>",
            ],
        )
        (call,) = self.gh_calls_of("api")
        self.assertEqual(
            call, ["api", f"repos/{{owner}}/{{repo}}/git/commits/{'m' * 40}"]
        )

    def test_a_message_without_trailers_gives_an_empty_list(self):
        for message in (
            "feat: x\n\nplain body: with colon\n",
            "feat: x\n\nAssisted-by: a\n\ntext\n",
            "feat: x",
        ):
            self.assertEqual(
                self.trailers({"stdout": json.dumps({"message": message})}), [], message
            )

    def test_unreadable_commit_message_gives_null(self):
        replies = [
            {"rc": 1, "stderr": "HTTP 404"},
            {"stdout": "not json"},
            {"stdout": json.dumps(["x"])},
            {"stdout": json.dumps({"message": 3})},
        ]
        for api in replies:
            self.assertIsNone(self.trailers(api), api)

    def test_no_merge_commit_oid_gives_null_without_an_api_call(self):
        out = self.trailers(
            {"stdout": "{}"}, views=[pr_json("MERGED", mergeCommit=None)]
        )
        self.assertIsNone(out)
        self.assertEqual(self.gh_calls_of("api"), [])


class MergeQueue(MergeBase):
    """gh 2.46 enqueues on a merge queue and still exits 0: the PR state decides."""

    def test_rc0_then_merged_on_a_later_poll(self):
        self.proven()
        self.rules(views=[pr_json(), pr_json(), pr_json(), pr_json("MERGED")])
        with mock.patch.object(gd_merge, "POLL_SECS", 0):
            out = self.ok("merge", "--repo", self.work, "--pr", "7")
        self.assertTrue(out["merged"])
        (call,) = self.gh_calls_of("pr", "merge")
        self.assertNotIn("--auto", call)
        self.assertEqual(len(self.gh_calls_of("pr", "view")), 4)

    def test_state_never_reaching_merged(self):
        self.proven()
        self.rules(views=[pr_json()])
        out = self.fails(
            5,
            "pending_timeout",
            "merge",
            "--repo",
            self.work,
            "--pr",
            "7",
            "--budget-min",
            "0",
        )
        self.assertEqual((out["queued"], out["pr"]), (True, 7))
        (call,) = self.gh_calls_of("pr", "merge")
        self.assertNotIn("--auto", call)

    def test_a_pr_closed_while_waiting_stops_at_once(self):
        self.proven()
        self.rules(views=[pr_json(), pr_json("CLOSED")])
        with mock.patch.object(gd_merge, "POLL_SECS", 0):
            code, out = self.merge("--budget-min", "0.01")
        self.assertEqual(
            (code, out["reason"], out["state"]), (6, "not_mergeable", "CLOSED"), out
        )
        self.assertEqual(len(self.gh_calls_of("pr", "view")), 2)

    def test_the_poll_budget_ends_in_pending_timeout_after_sleeping_between_polls(self):
        self.proven()
        self.rules(views=[pr_json()])
        clock = iter([0.0, 10.0, 70.0])  # deadline 60s: one sleep, then past it
        with (
            mock.patch.object(gd_merge, "POLL_SECS", 7),
            mock.patch.object(gd_merge, "monotonic", side_effect=lambda: next(clock)),
            mock.patch.object(gd_merge, "sleep") as sleep,
        ):
            code, out = self.merge("--budget-min", "1")
        self.assertEqual(
            (code, out["reason"], out["queued"], out["pr"]),
            (5, "pending_timeout", True, 7),
        )
        self.assertEqual([c.args for c in sleep.call_args_list], [(7,)])
        self.assertEqual(len(self.gh_calls_of("pr", "view")), 3)

    def test_pr_view_failure_blocks(self):
        self.gh_rules(
            {
                "match": ["pr", "view"],
                "rc": 1,
                "stderr": "Could not resolve to a PullRequest",
            }
        )
        self.fails(6, "gh_failed", "merge", "--repo", self.work, "--pr", "7")


if __name__ == "__main__":
    unittest.main()
