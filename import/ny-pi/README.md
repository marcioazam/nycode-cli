# ny-pi

A measured harness for the [pi](https://github.com/earendil-works/pi) coding agent: it solved the most tasks of the
three harnesses tested here and cost less than Claude Code on both suites, and a benchmark gate on every pull request
keeps it that way.
Wrapper, extensions, hooks, skills, agents and an installer.

[![ci-static](../../actions/workflows/ci-static.yml/badge.svg)](../../actions/workflows/ci-static.yml)
[![ci-security](../../actions/workflows/ci-security.yml/badge.svg)](../../actions/workflows/ci-security.yml)
[![instruction-budget](../../actions/workflows/instruction-budget.yml/badge.svg)](../../actions/workflows/instruction-budget.yml)
[![Scorecard](https://api.securityscorecards.dev/projects/github.com/marcioazam/ny-pi/badge)](https://scorecard.dev/viewer/?uri=github.com/marcioazam/ny-pi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pinned versions: **pi 1.5.2**, **pi-code 1.7.0**; third parties come from `third-party.json`.
Formerly `pi-harness` (renamed 2026-11-14); runtime identifiers keep the old name (`PI_HARNESS_*` variables,
`pi_harness_*.py` modules, the Harbor bundle `/tmp/pi-harness-bundle.tgz`, `~/.config/pi-harness/identifiers`).

## Contents

- [Why ny-pi](#why-ny-pi) · [Results at a glance](#results-at-a-glance) · [Benchmarks](#benchmarks)
- [What you get](#what-you-get) · [Install](#install) · [Configuration](#configuration)
- [Quality gates](#quality-gates) · [Comparison](#comparison-with-other-harnesses) · [Community](#community)
- [Repository layout](#repository-layout) · [Documentation](#documentation) · [License](#license)

## Why ny-pi

- **Accurate:** 97.8% of 42 tasks solved, against 94.0% for plain pi (+3.8 points, 90% interval +1.2 to +10.5).
- **Cheaper than Claude Code:** 0.57x the cost per task on the 42 tasks, 0.82x on the harder multi-file suite.
- **Measured, not claimed:** every extension carries its reason and measurement; every pull request is benchmarked
  against a frozen round of `main`.
- **Safe by default:** permission bypass is off, a guard hook keeps an always-deny list, and the installer fails
  closed on any hash mismatch.
- **Reversible:** each extension is one directory; deleting it removes the feature.

## Results at a glance

Same model (Claude Sonnet 5.5) for every harness, results of 2026-11-15.

| Suite | ny-pi | pi 1.5.2, no harness | Claude Code, no configuration |
|---|---|---|---|
| 42 tasks: solved | **97.8%** | 94.0% | 95.2% |
| 42 tasks: cost per solved task | US$ 0.047 | US$ 0.040 | US$ 0.085 |
| 12 harder tasks (36 runs): solved | **36 of 36** | 34 of 36 | 36 of 36 |
| 12 harder tasks: cost per solved task | US$ 0.178 | US$ 0.156 | US$ 0.219 |

## Benchmarks

### 42 tasks

Same model for every harness (Claude Sonnet 5.5), same 42 tasks, results of 2026-11-15.

| Harness | Tasks solved | Cost per task | Cost per solved task | Repetitions |
|---|---|---|---|---|
| **ny-pi** (this repository) | **97.8%** | US$ 0.046 | US$ 0.047 | 12 |
| pi 1.5.2, no harness | 94.0% | US$ 0.038 | US$ 0.040 | 12 |
| Claude Code, no configuration | 95.2% | US$ 0.081 | US$ 0.085 | 2 |

| ny-pi against | Difference in tasks solved | 90% interval (paired by task) | ny-pi cost |
|---|---|---|---|
| pi, no harness | +3.8 points | +1.2 to +10.5 | 1.23x |
| Claude Code | +2.6 points | -1.4 to +9.9 | 0.57x |

The 42 tasks: harness evaluations (tool use, refusals, output discipline), 12 plan-first tasks, 10 multi-module
tasks with hidden tests, and 4 [Terminal-Bench 2.0](https://www.tbench.ai/) tasks. Raw runs, per-suite tables and
method: [`docs/bench/BASELINE-VANILLA-2026-11.md`](docs/bench/BASELINE-VANILLA-2026-11.md); the frozen ny-pi
round every pull request is compared with: [`docs/bench/baseline-main/`](docs/bench/baseline-main/).

### Harder, multi-file tasks

12 tasks in repositories of 20 to 40 files (a bug far from its symptom, a cross-cutting change with many rules,
long and wide work), hidden tests, 3 repetitions each, same model, results of 2026-11-15.

| Harness | Tasks solved | Cost per solved task | Turns per run |
|---|---|---|---|
| **ny-pi** | 36 of 36 | US$ 0.178 | 6.2 |
| Claude Code, no configuration | 36 of 36 | US$ 0.219 | 6.6 |
| pi 1.5.2, no harness | 34 of 36 | US$ 0.156 | 5.6 |

- This suite does not separate accuracy either: all three harnesses are at or near the ceiling.
- It separates cost: paired by task, ny-pi costs 0.82x Claude Code (90% interval 0.73 to 0.91) and about 1.2x
  plain pi.
- The ny-pi row was measured without the shell-output clamp, which was removed the same day because of this
  measurement: with it, ny-pi needed twice the tool calls and cost 0.97x Claude Code (0.86 to 1.09).
- The hidden tests were audited by reviewers who did not write the tasks; 23 demands that neither the prompt
  nor the spec stated were relaxed, and every stored run was re-scored.

### Cost per solved task

| Suite | ny-pi | Claude Code | pi, no harness | ny-pi vs Claude Code |
|---|---|---|---|---|
| 42 tasks | US$ 0.047 | US$ 0.085 | US$ 0.040 | 0.57x per task (paired) |
| 12 harder tasks | US$ 0.178 | US$ 0.219 | US$ 0.156 | 0.82x (90% interval 0.73 to 0.91) |

Plain pi is the cheapest per task: ny-pi spends 23% more on the 42 tasks (a larger fixed prompt, read from cache on
every turn) and about 1.2x on the harder suite, and buys accuracy on the first and a large saving against Claude
Code on both.

### What the numbers do not show

- Against Claude Code the 42-task interval (-1.4 to +9.9 points) crosses zero: the advantage shown here is cost, not
  accuracy.
- Claude Code has 2 repetitions on the 42 tasks; ny-pi and plain pi have 12.
- Both task sets are close to saturated (most tasks are solved by every harness), so differences under about
  6 points cannot be resolved.
- One model, one machine, Python-heavy tasks. No task was solved by ny-pi alone.
- The remaining Terminal-Bench 2.0 tasks are registered in the `full` tier and have not been run; the 42-task set
  holds only 4 of them.

### How the gate works on every PR

The `bench-pr` check runs the pull request head and compares it with the frozen round of `main`. It fails on:

- a drop in tasks solved beyond -10 points (paired 90% interval);
- cost above 1.10x;
- turns (model round trips) above 1.10x;
- a security regression.

Wall-clock time is published for information only since 2026-11-15: it depended on API load and machine load, not on
the change. The rule, the statistics and the evidence kept per run are in the
[runbook](docs/bench/RUNBOOK.md).

### Reproduce

```bash
python3 bench/run.py run --arm ny-pi --tier baseline --model claude-sonnet-5-5 --budget-usd 40  # the 42 tasks
python3 bench/run.py run --arm ny-pi --tier hard --model claude-sonnet-5-5 --budget-usd 40      # the harder suite
```

Both spend model tokens (the budget flag caps it) and need the credentials described in the
[runbook](docs/bench/RUNBOOK.md).

## What you get

| Area | What it does |
|---|---|
| Wrapper `bin/pi` | Starts pi with the harness loaded, permission bypass off by default, patches applied at start |
| Shell safety | `bash-timeout` (600 s default, 1800 s cap); large shell output uses pi's own cut (2000 lines or 50 KB, keeping the end, full log in a file); a guard hook that denies destructive commands |
| Unattended runs | `headless-lean`: with no terminal attached, `auto-resume` stops at once at the account limit, tools that need a person are removed, a plan request is planned and executed in the same turn, and the result is checked against each rule of the request |
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
| `bench-pr` | The benchmark: a drop in tasks solved beyond -10 points (paired 90% interval), cost above 1.10x, turns above 1.10x, or a security regression fails it; wall-clock time is informational |

OpenSSF Scorecard and CodeQL (Python, JavaScript/TypeScript, Actions) run weekly and on pushes to `main`, never on a
pull request, so they add no time to one.

The same checks run locally with `bash scripts/ci/local.sh` (under 15 minutes; [details](docs/ci-local.md)).

## Comparison with other harnesses

Only what is measured here: same model, same tasks, results of 2026-11-15.

| | ny-pi | Claude Code, no configuration | pi 1.5.2, no harness |
|---|---|---|---|
| Tasks solved (42 tasks) | **97.8%** | 95.2% | 94.0% |
| Tasks solved (12 harder tasks, 36 runs) | 36 of 36 | 36 of 36 | 34 of 36 |
| Cost per solved task (42 tasks) | US$ 0.047 | US$ 0.085 | US$ 0.040 |
| Cost per solved task (harder) | US$ 0.178 | US$ 0.219 | US$ 0.156 |
| Turns per run (harder) | 6.2 | 6.6 | 5.6 |

Plain pi is cheaper and takes fewer turns; ny-pi solves more on the 42 tasks. Claude Code costs more per solved task
on both suites. Features that were not measured are not compared.

## Community

Questions and ideas: [Discussions](../../discussions). Bugs: the issue forms.
[CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [SUPPORT](SUPPORT.md) ·
[CODE_OF_CONDUCT](CODE_OF_CONDUCT.md)

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
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Third-party licenses: [`NOTICE`](NOTICE)

## License

[MIT](LICENSE). Third-party licenses are in [`NOTICE`](NOTICE).
