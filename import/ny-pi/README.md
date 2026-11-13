# pi-harness

A reusable harness for the [pi](https://github.com/earendil-works/pi) coding agent: wrapper (`bin/pi`), pi-code
patches, extensions, hooks, `claude-home/` (agents, skills, commands, generic contract) and an installer.
Pinned versions: **pi 1.5.2**, **pi-code 1.7.0**; third parties come from `third-party.json`.

## Install

Requirements: Linux/macOS, Node.js >= 22.19, npm, git, patch, jq, curl.

```bash
./install.sh                  # pi 1.5.2 + pi-code 1.7.0 + required third parties; --with-optional adds the rest
./install.sh --link           # dry-run: prints link | replace | skip(same) per file and templates
./install.sh --link --apply   # symlinks the harness into ~/.pi/agent (and bin/pi into ~/.local/bin/pi)
~/.local/bin/pi --version     # 1.5.2
```

`install.sh` fails closed: a third-party commit or tarball hash that differs from the manifest, a LICENSE hash
mismatch, a patch that does not apply, or a pi-code pin other than 1.7.0 aborts with a non-zero exit before
anything under `~/.pi` is written. The official `pi.dev/install.sh` cannot pin a version, so the installer
reproduces its managed layout from the same release API for exactly 1.5.2 (artifact hashes pinned).
Reinstalling moves replaced directories to `~/.pi-backup/<timestamp>/`; `npm ci` rebuilds `~/.pi/agent/npm`
from `npm/` (extra packages you installed there are removed).

## Link, backup, restore

`--link --apply` moves each existing non-link target to `~/.pi-backup/<timestamp>/replaced/<path>` (mode 0700)
before creating the symlink, copies `settings.json`, `mcp.json`, `lsp.json`, `local.env` from the `*.example`
templates only when absent, and writes `link-manifest.tsv` (target, backup, sha256, kind).
`./install.sh --restore [<timestamp>]` removes those links and moves the originals back after verifying sha256.
Never touched: `auth*.json`, `mcp-auth.json`, `sessions/`, `memory/`, anything not in `publish.list`.

## Overlay (your personal layer)

Real files in `~/.pi/agent` that are not links to this repo stay yours: personal rules (`claude-home/rules/personal.md`),
extra agents/skills, credentials. `~/.pi/agent/local.env` (mode 0600, keys `PI_BYPASS_PERMISSIONS`, `PI_COMPACT_AT`,
`PONYTAIL_QUIET_STARTUP`, `PI_KNOWLEDGE_VAULT`, `PI_GRAPHS_VAULT`, ...; see `local.env.example`) configures the wrapper.
The wrapper starts with permission bypass OFF.

## Tests

`bash scripts/test_install.sh` (offline: tampered manifest, wrong pin, link/restore round trip);
`PI_HARNESS_E2E_NET=1 bash scripts/test_install.sh` adds a full install in a temp HOME.
See `CONTRIBUTING.md` and `NOTICE` (third-party licenses).
