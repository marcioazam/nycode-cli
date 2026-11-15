# ny-pi

A measured harness for the [pi](https://github.com/earendil-works/pi) coding agent: wrapper, extensions, hooks,
skills, agents and an installer, with a benchmark gate on every pull request.

[![ci-static](../../actions/workflows/ci-static.yml/badge.svg)](../../actions/workflows/ci-static.yml)
[![ci-security](../../actions/workflows/ci-security.yml/badge.svg)](../../actions/workflows/ci-security.yml)
[![instruction-budget](../../actions/workflows/instruction-budget.yml/badge.svg)](../../actions/workflows/instruction-budget.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pinned versions: **pi 1.5.2**, **pi-code 1.7.0**; third parties come from `third-party.json`.
Formerly `pi-harness` (renamed 2026-11-14); runtime identifiers keep the old name (`PI_HARNESS_*` variables,
`pi_harness_*.py` modules, the Harbor bundle `/tmp/pi-harness-bundle.tgz`, `~/.config/pi-harness/identifiers`).

## Contents

- [Benchmark](#benchmark)
- [What you get](#what-you-get)
- [Install](#install)
- [Configuration](#configuration)
- [Quality gates](#quality-gates)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)

## Benchmark

Same model for every harness (Claude Sonnet 5.5), same 42 tasks, results of 2026-11-15.

| Harness | Tasks solved | Cost per task | Cost per solved task | Repetitions |
|---|---|---|---|---|
| **ny-pi** (this repository) | **97.8%** | US$ 0.046 | US$ 0.047 | 12 |
| pi 1.5.2, no harness | 94.0% | US$ 0.038 | US$ 0.040 | 12 |
| Claude Code, no configuration | 95.2% | US$ 0.081 | US$ 0.085 | 2 |
| oh-my-pi 18.20.0 | 90.5% | US$ 0.107 | US$ 0.118 | 2 |

| ny-pi against | Difference in tasks solved | 90% interval (paired by task) | ny-pi cost |
|---|---|---|---|
| pi, no harness | +3.8 points | +1.2 to +10.5 | 1.23x |
| Claude Code | +2.6 points | -1.4 to +9.9 | 0.57x |
| oh-my-pi | +7.3 points | +2.2 to +15.3 | 0.43x |

What these numbers support, and what they do not:

- ny-pi solves more tasks than plain pi and oh-my-pi, and costs about half of Claude Code and oh-my-pi.
- Against Claude Code the interval crosses zero: the advantage shown here is cost, not accuracy.
- ny-pi costs 23% more per task than plain pi (a larger fixed prompt, read from cache on every turn).
- The task set is close to saturated (most tasks are solved by every harness), so differences under about
  6 points cannot be resolved. Claude Code and oh-my-pi have 2 repetitions only.
- One model, one machine, Python-heavy tasks. No task was solved by ny-pi alone.

The tasks: harness evaluations (tool use, refusals, output discipline), 12 plan-first tasks, 10 multi-module
tasks with hidden tests, and 4 [Terminal-Bench 2.0](https://www.tbench.ai/) tasks. Raw runs, per-suite tables and
method: [`docs/bench/BASELINE-VANILLA-2026-11.md`](docs/bench/BASELINE-VANILLA-2026-11.md); the frozen ny-pi
round every pull request is compared with: [`docs/bench/baseline-main/`](docs/bench/baseline-main/).
Reproduce with `python3 bench/run.py run --arm ny-pi --tier baseline --model claude-sonnet-5-5 --budget-usd 40`
([runbook](docs/bench/RUNBOOK.md)).

## What you get

| Area | What it does |
|---|---|
| Wrapper `bin/pi` | Starts pi with the harness loaded, permission bypass off by default, patches applied at start |
| Shell safety | `bash-timeout` (600 s default, 1800 s cap), `bash-clamp` (large output cut to head and tail, full log on disk), a guard hook that denies destructive commands |
| Unattended runs | `headless-lean`: with no terminal attached, tools that need a person are removed, a plan request is planned and executed in the same turn, and the result is checked against each rule of the request |
| Cost | Prompt cache kept stable across directories, 1 h cache on the fixed prefix, compaction at a fixed token count, docs section replaced by a pointer |
| Recovery | `auto-resume` after transient provider failures, `completion-gate` when a turn edited code, `syntax-check` right after an edit |
| Planning | `plan-gate`: an approved plan runs to the end and closes with a reviewer agent |
| Agents and skills | 17 agents and 30 skills under `claude-home/`, loaded on demand; 17 slash commands |
| Interface | Sticky last prompt, queued-message recall, footer, sound on turn end, themes |

Each extension is one directory or file under [`extensions/`](extensions/), with its reason, measurement and
how to revert in the header comment. Deleting the directory removes the feature.

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

## Configuration

| Variable | Effect |
|---|---|
| `PI_BYPASS_PERMISSIONS=1` | Auto-approve the guard's "ask" list (the always-deny list still blocks) |
| `PI_COMPACT_AT` | Token count that triggers compaction (default 250000) |
| `PI_HEADLESS_LEAN=0` (environment only) | Turn off the unattended-run behaviour |
| `PI_KNOWLEDGE_VAULT`, `PI_GRAPHS_VAULT` | Optional knowledge and code-graph vaults |

The first two and the vault variables go in `~/.pi/agent/local.env` (mode 0600), which accepts only the keys
listed in `local.env.example`. `pi --bypass` and `pi --safe` switch the permission mode for one session.

## Quality gates

Every pull request must pass four required checks before merge:

| Check | What it blocks |
|---|---|
| `ci-static` | Lint, format and types (ruff, mypy strict, shellcheck, shfmt, biome, markdownlint), unit tests, 80% coverage on changed lines, file and directory size limits |
| `ci-security` | Secrets (gitleaks), static analysis (semgrep), dependency advisories (osv-scanner), unpinned GitHub Actions |
| `instruction-budget` | Growth of the always-loaded prompt beyond the recorded token budget |
| `bench-pr` | The benchmark: the pull request head is run and compared with the frozen round of `main`; the gate fails a drop in tasks solved beyond the margin, a cost increase above 10%, an increase in model round trips (turns) above 10%, or a security regression; wall-clock time is published for information only |

The same checks run locally with `bash scripts/ci/local.sh` (under 15 minutes; [details](docs/ci-local.md)).
The benchmark gate rule, its statistics and the evidence kept for each run are in the
[runbook](docs/bench/RUNBOOK.md).

## Repository layout

| Path | Content |
|---|---|
| `bin/` | The `pi` wrapper and its tests |
| `extensions/` | pi extensions (TypeScript), one feature each |
| `claude-home/` | Contract (`CLAUDE.md`), rules, agents, skills, commands, hooks |
| `bench/` | Benchmark runner, suites, arms, gate and statistics |
| `docs/` | Benchmark results, runbook, specs |
| `scripts/` | Installer library, CI scripts, leak and reference checks |
| `npm/`, `third-party.json` | Pinned dependencies and vendored third parties |

## Documentation

- Benchmark results and method: [`docs/bench/BASELINE-VANILLA-2026-11.md`](docs/bench/BASELINE-VANILLA-2026-11.md)
- Running the benchmark and the gate: [`docs/bench/RUNBOOK.md`](docs/bench/RUNBOOK.md)
- Local CI: [`docs/ci-local.md`](docs/ci-local.md)
- Specs: [`docs/specs/`](docs/specs/)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md); third-party licenses: [`NOTICE`](NOTICE); license: [MIT](LICENSE)
