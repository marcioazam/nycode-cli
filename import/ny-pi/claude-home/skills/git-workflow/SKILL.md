---
name: git-workflow
description: Inspect git state and commit, integrate the base, gate, push, open a PR, sync or clean up through the git-delivery agent, with safety checks. Not for code review, rebases, history rewrites, tags or releases.
context: fork
agent: git-delivery
model: haiku
---

# Git workflow

Invoked as `/skill:git-workflow <args>`, pi-code runs this expanded body in a forked `git-delivery` subagent (Haiku): it does not see the conversation and cannot ask the user; in the interactive UI it runs in the background and its result arrives as a message. When you (the main thread) loaded this file with `read`, nothing was forked: read-only inspection (`git status -sb`, `git log`, `git diff`) is fine here, but every git write goes through `subagent` `{agent: "git-delivery", task: ...}`. The arguments carry everything: repository, branches, the authorization in force verbatim, one `--check NAME=CMD` per gate, the base, the main checkout, the trailers; a missing item stops it `blocked`. Task: $ARGUMENTS

Run `$CLAUDE_CONFIG_DIR/bin/git-deliver <cmd> --repo R` for the one step needed (`status` inventories read-only), or `ship` for the whole chain (skill `atualizador`, same exit codes and flags). Return its last JSON line and one status line, never logs.

Exit 3 `conflict` returns `needs_sonnet`; pi's `subagent` has no per-call model and `git-delivery` is pinned to Haiku, so the main thread dispatches `subagent` `{agent: "swarm-worker", task: ...}` (Sonnet) with `resolve_conflicts: true`, the authorization verbatim, the conflicted files and the instruction to follow `~/.pi/agent/claude-home/agents/git-delivery.md`; it reads `~/.pi/agent/claude-home/skills/git-workflow/references/worktrees-and-conflicts.md` and, for a PR description, `~/.pi/agent/claude-home/skills/git-workflow/references/pr-body.md`. Exit 4, 5, 6: `blocked` with its reason.

Conventional commits, never force push, prove a suspicious ref merged before calling it lost. Rebase, stash drop and history rewrites run only under explicit authorization, outside the main chat, in a Sonnet `swarm-worker` whose brief quotes that authorization (git-deliver has no rewrite command and git-delivery never rewrites); tags and releases follow the repository's rule and need explicit authorization.
