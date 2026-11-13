---
name: lane-integration
description: "Merge parallel agent lanes into one integration branch without losing work: ordered cherry-picks, regenerated files, conflict scan, one verification. Use when 2+ lanes or worktrees edited a repo. Not for git-workflow."
---

# Lane integration

The repository's own files win: its `AGENTS.md` or `CLAUDE.md`, its project skills and its gate script (they
set branch, commit and verification rules). This skill fills gaps and defers to them on any conflict. You
combine finished lanes; you do not redo their work.

## Setup
1. Use one integration branch off the base. Keep a state table in the task's record:
   lane | owned paths | head SHA | last green head | status.
2. Before each commit or pick, compare `git rev-parse HEAD` with the table. A head you did not write means
   another writer is active: re-read `git status` and the log before acting.

## Per lane, in dependency order
1. Bring the lane in with `git cherry-pick -x <sha>`, or `git merge --ff-only` for linear history, or
   `git merge --no-ff` to keep the lane visible.
2. Generated files: never hand-merge. Take either side, regenerate from the sources, keep the generator's
   output. Artifacts copied to consumers (embedded or vendored copies): copy them wholesale and re-record their
   digests.
3. Changelog: union the entries of both sides. Recompute counted lists, totals and tables from source; never
   merge the numbers.
4. Scan: `rg -n '^(<<<<<<<|=======|>>>>>>>)'` for conflict markers, then the generator `--check` and the lint
   or formatter on the touched files only.
5. Update the state table. A lane that fails its check stops there: fix it in place or return it.

A conflict that needs a product decision (two valid behaviours, two competing contracts): stop and return
`blocked` with both hunks, the file:line and the lanes. Decide nothing.

## Stopped lanes
Save the work as a WIP commit or a patch bundle (`git format-patch`, or `git diff` into a file). Resume with a
fresh `subagent` call (e.g. `lane-integrator` or `swarm-worker`) briefed from `git status`, the diff and the
logs, never from memory of the old session or by `resume` of the stopped run.

## Never
`git stash`, `git rebase`, `--no-verify`, `rm -rf`, push. Commit only when the brief authorizes it.

## Verify once
Note a pre-existing failure only after reproducing it on the base commit. Run no gate per lane: hand the exact
integrated head SHA to `gate-runner` (`subagent` `{agent: "gate-runner", task: ...}`, pinned to `haiku`) for one
verification.

## Handback
- Per-lane result and head SHA.
- Resolution table: file, conflict, resolution, source of truth.
- Regenerations run, with `--check` results.
- Pre-existing failures proven on the base, and unverified scope.
- Final integrated head SHA.
