<!-- Public pi-harness safety contract. pi has no permission engine: the wrapper's bypass setting plus hooks/guard.py are
the only technical controls. pi's subagent has no isolation field (see rules-ref/research-and-tools.md, Delegation). -->
# Safety and authorization (pi)

The wrapper `bin/pi` starts in safe mode by default (`PI_BYPASS_PERMISSIONS=0`). Opt in to bypass with
`PI_BYPASS_PERMISSIONS=1` in `~/.pi/agent/local.env` (mode 0600) or `pi --bypass`; `pi --safe` or `/bypass` turns it
off. The only technical control is the PreToolUse hook `$CLAUDE_CONFIG_DIR/hooks/guard.py` (matcher
`Bash|Edit|Write|Read`). It always denies the catastrophic cases (forced recursive `rm`, `mkfs`, `dd` or redirects to a
disk device, `curl|wget` piped to a shell, force push to main/master, fork bombs, recursive `chmod`/`chown` on `/`) and
the `read` tool on secrets (SSH keys, secret config directories, credential and auth token files, every `.env`,
`.env.local`, `.env.*.local`, `.env.production`; the full list is in `guard.py`). Its "ask" list (sudo, `rm -r`, pushes,
rebase, edits outside the project or to sensitive files) prompts in safe mode, is blocked where there is no UI
(`pi -p`, subagents) and is auto-approved under bypass. Nothing else is enforced, and `bash` can still read what `read`
cannot: follow this policy however a command is written; security controls never block beyond the hook.

- Forbidden: forced recursive deletion (`rm -rf`, `rm -fr`). Inspect and remove narrowly scoped targets without force.
- Never bypass branch protection, required checks or hooks to save time (`--no-verify`, `gh pr merge --admin`); report the blocker instead.
- Local destructive commands (`rm -r`, `dd`, `mkfs*`, `shred`, `chmod -R`, `git reset --hard`, `git branch -D`) are permitted only where bypass is on or the user approves the prompt. Look at the target first (path, size, what it holds) and run `git clean -n` before any `git clean -f`.
- Confirm target and recovery path first, outside a disposable local cluster, for commands that mutate shared or live infrastructure: `terraform`/`tofu` `apply|destroy|import|state …|force-unlock`, `kubectl apply|create|delete|patch|replace|scale|drain` and `helm install|upgrade|uninstall|rollback`; deployment stays under each repository's own authorization rule.
- Subagents (custom and built-in) never publish, send external messages, schedule, upload local files or drive the user's logged-in browser or desktop; they return content to the parent. Exception: `linear-operator` (optional) changes Linear only inside the parent's explicit write authorization.
- Needs explicit task authorization: `git rebase`; `gh release create|edit|delete`; `npm|pnpm|yarn|bun publish`; `wrangler deploy|delete`.
- CodeQL CLI (`codeql database create|analyze`) runs only on codebases under an OSI-approved licence, for academic research, or with a paid GitHub Advanced Security or Code Security licence (github/codeql-cli-binaries `LICENSE.md`). On private or unlicensed code use Semgrep, `gitleaks` and `trivy`.
- Third-party intake: before installing or enabling a skill, pi package (`pi install`), pi extension, MCP server (`mcp.json`) or CI agent action, or opening a cloned repository that carries agent config (`.pi/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), vet it first (read its files, local scan; skill `presente-de-grego` (optional) when installed) and install from the reviewed clone. Never `/trust` a repository or `~` to get its config: the wrapper keeps project `.claude` off on purpose.
- Never mutate live data through a diagnostic command.
- Don't repeat a possibly completed side effect just because an observation timed out; inspect the current state first.
