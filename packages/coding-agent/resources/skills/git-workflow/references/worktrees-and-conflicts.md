# Worktrees, conflict intent and integration

Read for isolation, an in-progress conflict, or branch cleanup. Inspect status, tracked and untracked changes, current operation, branch/remotes and existing worktrees first. An existing isolated checkout may suffice. When isolation is useful and authorized, use the project's established worktree location; ensure a project-local location is ignored. Do not commit an ignore change automatically or install dependencies merely to create isolation.

For every conflict, inspect the merge base, both sides, relevant commit messages and task/spec. Consult accessible issue or review context when needed; missing external evidence remains a limitation. Preserve both intents when compatible. Where they conflict, use the task's stated goal and document the tradeoff; ask only for a material unresolved product decision. Do not invent behavior just to remove markers.

Run the project's relevant checks on the resolved content. Inspect the complete intended diff and unresolved paths. Stage only reviewed in-scope paths when authorized, through `git-deliver commit --path <resolved files> -m ...` (it secret-scans and concludes the merge), never a bare `git commit` or `git add -A`. Continuing a rebase, committing a merge, publishing or rewriting history requires the existing explicit task authorization. There is no universal never-abort rule: stopping or an authorized abort can be the correct recovery, after checking whether it would lose work.

Before deleting a worktree or branch, inspect untracked/ignored files, repository location and content reachable only there. Preserve unfinished work and report its location if cleanup is not authorized or safe. Do not force-remove a checkout to finish a workflow. Verify resulting refs and relevant checks after authorized integration.

Conflict-intent technique adapted from mattpocock/skills at `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`, `engineering/resolving-merge-conflicts/SKILL.md` (MIT). The upstream never-abort, stage-everything and automatic-commit steps are deliberately excluded. [Pinned source and license]($CLAUDE_CONFIG_DIR/docs/third-party/mattpocock-skills/LICENSE).

Adapted from obra/superpowers, revision `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT). The upstream license is kept in [a local copy]($CLAUDE_CONFIG_DIR/docs/third-party/obra-superpowers/LICENSE); this reference replaces the selected techniques, not the upstream orchestration policy.
