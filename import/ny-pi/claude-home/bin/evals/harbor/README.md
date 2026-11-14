# Harbor × pi harness (Terminal-Bench 2.0)

Runs the user's whole pi harness (`~/.pi/agent` + wrapper `~/.local/bin/pi`) inside Harbor task containers, to compare
it with the built-in `claude-code` agent on `terminal-bench@2.0`. Model: `anthropic/claude-opus-5-5`, subscription OAuth. (optional)

## Usage

```bash
./run.sh <ny-pi|claude-code> <job-name> [harbor args...]
./run.sh ny-pi smoke-pi -i fix-git -n 1      # one task, concurrency 1
```

Jobs go to `~/.local/state/harbor-jobs/<job-name>`. `hello-world` is not in the dataset (89 tasks); `fix-git` is a quick one.
Each run spends subscription quota: always bound with `-i`/`-l`.

## Arms

- `ny-pi`: `pi_harness_agent.py:PiHarnessAgent` (subclass of Harbor's `Pi`; trajectory and cost parsing are inherited).
  `run.sh` rebuilds the bundle (`bundle.sh` → `/tmp/pi-harness-bundle.tgz`), then `install()` ensures curl/tar/python3/patch
  (root, via apt/dnf/yum/apk), uploads and extracts the bundle into `/opt/pi-home`, installs node with nvm. The run calls
  `/opt/pi-home/.local/bin/pi --print --mode json --session-dir ...` with `HOME=/opt/pi-home`.
  Token: `ANTHROPIC_OAUTH_TOKEN`.
- `claude-code`: built-in agent; token `CLAUDE_CODE_OAUTH_TOKEN` + `CLAUDE_FORCE_OAUTH=1`.

The token is read at runtime from `~/.claude-2/.credentials.json` with `jq` into the process environment only; never written to disk.

## Bundle exclusions

`sessions/`, `checkpoints/`, `plans/`, `memory/`, `auth.json*`, `mcp-auth.json*`, `trust.json*`, `*.bak*`, `.env*`, `__pycache__`,
`claude-home/{backups,sessions,projects,.credentials.json}`, `claude-home/plugins/claude-hud/pi-transcripts/`.
`bundle.sh` lists the tarball afterwards and fails if any excluded or credential-looking path is inside.

## Known limits

- MCP servers have no keys in the container: they fail to connect (deferred tools, harmless).
- The bundle is ~56 MB and the harness bypass mode is on (wrapper default), as in normal use.
- Needs glibc images with network for nvm; the dataset's images satisfy this.

## Pilot results and fixes

- 2026-11-13 pilot (10 tasks, Opus 5.5): `claude-home/docs/external-eval-terminal-bench-2026-11-13.md`.
- Instructions that start with `-` are passed after `--` (pi would parse them as options).
- Arm `pi-vanilla` runs Harbor's built-in pi 1.5.2 without the harness.
- Some security tasks (`break-filter-js-from-html`, `crack-7z-hash`) are refused by the API's cyber safeguards for pi
  (with or without the harness) but not for Claude Code; count them separately.
