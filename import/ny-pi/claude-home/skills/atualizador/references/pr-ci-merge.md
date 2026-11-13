# PR, CI and merge: judgment only

`git-deliver` waits for CI, detects billing, merges and polls the queue. Read this only when its JSON stops on `ci_red`,
`not_mergeable`, `protection` or a queue failure, or when the repository has no PR host.

## Red CI (exit 5)

- Read the earliest failing job (`gh run view <run> --log-failed`) on the tested head SHA; separate code defects from
  runner, cache, permission and flaky causes. An unknown cause goes to `ci-triage` with the run URL, job and head SHA.
- Fix delivery-caused failures, push, `git-deliver ship` again. One attempt, one informed retry, one materially
  different approach; then report blocked.
- A rerun is not a fix: never rerun a red job hoping for green, disable a test or weaken a gate.
- Billing counts only when the script reports `not_started_billing`: every non-green check has 0 steps or no log, and a
  run or check annotation contains "payments have failed" or "spending limit" (the only phrases it matches). An
  unexplained queue or a job that started and failed is not billing; unproven billing blocks.

## Merge (exit 6 `protection`, `not_mergeable`)

- Respect branch protection and rulesets (both apply): missing required reviews or checks mean blocked, reported with
  `gh pr view <pr> --json mergeStateStatus,reviewDecision`. Never self-approve, never `--admin`.
- Method: the repository's convention (`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`);
  the script's default is squash, so pass `--method` when only another one is allowed.
- Exact squash message: `git-deliver merge --pr N --subject "one line" --body-file F` (UTF-8 file; not with `--method rebase`) passes both to `gh pr merge`; read `merge_commit_trailers` in the JSON for a stray `Co-authored-by`. `ship` does not take them.

## Merge queue

- Exit 5 `pending_timeout` with `queued: true`: gh enqueued the PR and it is still waiting; report it with the PR URL
  and resume later with `git-deliver merge` (it re-reads the PR state; gh answers "already queued" for a queued PR),
  never a raw `gh pr merge`. A PR closed while queued stops exit 6 `not_mergeable`.
- The queue evicted the PR (failed check, conflict, timeout): blocked, with the `merge_group` run link. That run tests a
  `gh-readonly-queue/<default>/...` branch, not the PR head. Do not resume with `git-deliver merge` until the cause is
  fixed and the gate ran on the new head.
- A required check that never reports because its workflow lacks the `merge_group` trigger blocks the queue: report
  blocked; edit the workflow only when it is in the delivery scope.

## No PR host (plain git remote or local-only origin)

The local gate is the CI and `git-deliver publish` does not apply. The git-delivery agent returns `blocked`
here; a Sonnet worker (`swarm-worker` via `subagent`) given the authorization runs it. In the main checkout: `git fetch --prune`,
`git merge --ff-only origin/<default>`, `git merge --ff-only <branch>` (if it cannot fast-forward, merge
`origin/<default>` into the branch in its worktree and gate again), rerun the gate if the base moved,
`git push origin <default>`, then `git branch -d <branch>` locally and on the remote if it was pushed. A rejected push
means the base moved: fetch, merge `origin/<default>` into the branch, gate again, fast-forward and push; never force.

## Sources

- `merge_group` trigger, `gh-readonly-queue/{base_branch}` branches, removal on failed checks, conflicts or timeout:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue,
  read 2026-10-25.
- Rulesets and branch protection apply together:
  https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets,
  read 2026-10-25.
