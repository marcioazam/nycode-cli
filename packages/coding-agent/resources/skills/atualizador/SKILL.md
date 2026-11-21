---
name: atualizador
description: "Publish local repo work end to end via git-delivery: commit, push, PR, CI or local gate, merge when green, main synced, branch removed. Use to ship everything. Not for pr-review, ci-triage or releases/deploys."
context: fork
agent: git-delivery
model: haiku
---

# Atualizador

Invoked as `/skill:atualizador <args>`, pi-code runs this expanded body in a forked `git-delivery` subagent (Haiku, from its agent file) that does not see the conversation and cannot ask the user; in the interactive UI the fork runs in the background and its result arrives as a message when it ends. When you (the main thread) loaded this file with `read` instead, nothing was forked: do not run `git-deliver` in the main chat; call `subagent` `{agent: "git-delivery", task: "<everything below, filled in>"}` and relay its handback. The arguments carry everything, and a missing item stops it `blocked`. Pass the repository path, base branch, the authorization in force verbatim, one `--check NAME=CMD` per gate command, `--path` for each publish path (unlisted changes stay local and are reported), the commit message and PR title, the trailers and the main checkout path. Task: $ARGUMENTS

Run exactly:
`$CLAUDE_CONFIG_DIR/bin/git-deliver ship --repo R --base B --check NAME=CMD... [--branch NAME] [--path P... -m MSG] [--message-file F] [--title T] [--body-file F] [--attribution LINE...] [--keep-local P...] [--trailer T...] [--method M] [--main-checkout PATH (default: the main worktree)] [--require-remote-ci] [--no-merge] [--keep-branch] [--discard-ignored]`

On the default or base branch (or a detached HEAD) pass `--branch type/short-topic`: the script switches to it with the changes before committing, and without it stops `on_base_branch` before touching anything. Untracked files that are not secret-named and not under `--path` or `--keep-local` stop it `unknown_paths`. The script commits, merges the base, gates, pushes, opens the PR, waits for CI, merges with `--match-head-commit`, syncs the main checkout and cleans up. It stops at the first failing step and resumes on the next call. Return its last JSON line and one status line, never logs.

- Exit 3 `conflict`: status `needs_sonnet`. pi's `subagent` takes no per-call model or effort and `git-delivery` is pinned to Haiku, so the main thread dispatches `subagent` `{agent: "swarm-worker", task: ...}` (Sonnet) with `resolve_conflicts: true`, the authorization verbatim, the conflicted files, the original `ship` flags and the instruction to follow `~/.pi/agent/claude-home/agents/git-delivery.md` and `~/.pi/agent/claude-home/skills/git-workflow/references/worktrees-and-conflicts.md`; it resolves keeping both intents, concludes with `git-deliver commit --path <files> -m ...`, and reruns `ship`. `no_message`: the agent writes the subject. `unknown_paths`: `blocked` with the list; the caller reruns with `--path` or `--keep-local`.
- Exit 4, 5, 6: `blocked`, reported with its reason; never bypassed. An unknown CI cause goes to `ci-triage` with the run URL and head SHA. Judgment on CI, billing or the queue: `~/.pi/agent/claude-home/skills/atualizador/references/pr-ci-merge.md`. PR body: `~/.pi/agent/claude-home/skills/git-workflow/references/pr-body.md` (absolute paths: the fork gets no base directory).

Green means every check passes on the tested head: any red check, required or not, blocks the merge (fail closed, exit 5) and is reported with its name and run URL.

Authorization covers commit, push, PR and merge in the requested repository; release, deploy, tags, rebase and force push are excluded. Never: `--no-verify`, `--admin`, any force push, rebasing a pushed branch, `git stash`, `reset --hard`, `clean -f`, `worktree remove --force`, `gh pr merge --delete-branch`, `branch -D` outside `cleanup`, committing `.env*`, keys, tokens, caches or build output. The script runs `gitleaks git --staged --redact` before each commit and scans `origin/B..HEAD` (merge commits included) before the push, failing closed; it removes a branch with `-D` only when `git rev-parse <branch>` equals the merged PR's `headRefOid`, never the default or base branch, and keeps a worktree holding ignored secret files unless `--discard-ignored`. After a timeout, inspect the remote before repeating a push or merge. Report blockers; never bypass them. One PR per concern.
