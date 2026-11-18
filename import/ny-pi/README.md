# ny-pi

A harness for the [pi](https://github.com/earendil-works/pi) coding agent (wrapper, extensions, hooks, skills, agents
and an installer), measured against Claude Code and plain pi with the same model and the same tasks.
In short: it costs less than Claude Code (0.57x per task on the 42 tasks, 0.77x on Terminal-Bench) and solves more of
the 42 tasks than plain pi. On Terminal-Bench 2.0 it is behind Claude Code in tasks solved (-5.5 points, not
significant at 90%) and, against plain pi, inconclusive and more expensive (1.34x). Both sides are below.

[![ci-static](../../actions/workflows/ci-static.yml/badge.svg)](../../actions/workflows/ci-static.yml)
[![ci-security](../../actions/workflows/ci-security.yml/badge.svg)](../../actions/workflows/ci-security.yml)
[![instruction-budget](../../actions/workflows/instruction-budget.yml/badge.svg)](../../actions/workflows/instruction-budget.yml)
[![Scorecard](https://api.securityscorecards.dev/projects/github.com/marcioazam/ny-pi/badge)](https://scorecard.dev/viewer/?uri=github.com/marcioazam/ny-pi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Pinned versions: **pi 1.5.2**, **pi-code 1.7.0**; third parties come from `third-party.json`.
Formerly `pi-harness` (renamed 2026-11-14); runtime identifiers keep the old name (`PI_HARNESS_*` variables,
`pi_harness_*.py` modules, the Harbor bundle `/tmp/pi-harness-bundle.tgz`, `~/.config/pi-harness/identifiers`).

## Contents

- [How to read this README](#how-to-read-this-readme) · [Wins and losses](#where-ny-pi-wins-and-where-it-loses) ·
  [Results at a glance](#results-at-a-glance) · [Benchmarks](#benchmarks)
- [What you get](#what-you-get) · [Install](#install) · [Configuration](#configuration)
- [Quality gates](#quality-gates) · [Comparison](#comparison-with-other-harnesses) · [Community](#community)
- [Repository layout](#repository-layout) · [Documentation](#documentation) · [License](#license)

## How to read this README

This README follows one rule: it reports the data as measured, losses next to wins, with no marketing.

- Every claim about quality, cost or speed points to a measurement in this repository (raw runs under
  [`docs/bench/`](docs/bench/)), with the sample size and the interval.
- Where ny-pi loses, it says so in the same place it says where it wins.
- A difference whose interval crosses zero is reported as "not shown", never as a win.
- What was not measured is said to be not measured; features are not compared with other harnesses.
- When a new measurement contradicts a number here, the number is replaced, not kept beside a newer one.

Pull requests that change this README follow the same rule ([CONTRIBUTING](CONTRIBUTING.md)).

## Where ny-pi wins and where it loses

Same model (Claude Sonnet 5.5) for every harness, results of 2026-11-15; the Terminal-Bench 2.0 figures are the
pooled sample of 2026-11-18 (73 tasks).

| Against | ny-pi wins | ny-pi loses | Not shown either way |
|---|---|---|---|
| pi 1.5.2, no harness | Solves more of the 42 tasks: +3.8 points (90% interval +1.2 to +10.5) | Costs more: 1.23x per task on the 42 tasks, about 1.2x on the harder suite, 1.34x on Terminal-Bench 2.0. Takes more turns on the harder suite (6.2 against 5.6 per run; no interval computed). Answers later: first reply at 2.3 to 2.6 s against 1.1 to 1.6 s in a one-turn timing of 3 runs per arm, from the larger fixed prompt (local timing, not yet in `docs/bench/`) | Harder suite accuracy: 36 of 36 against 34 of 36, too few failures to resolve; Terminal-Bench 2.0, 72 tasks: +2.3 points with an interval of -5.1 to +10.2 (probability of being ahead 0.68) |
| Claude Code, no configuration | Costs less: 0.57x per task on the 42 tasks, 0.82x on the harder suite (90% interval 0.73 to 0.91). Fewer turns on the harder suite (6.2 against 6.6; no interval computed). Costs 0.77x per task on Terminal-Bench 2.0 (US$ 0.118 against 0.143 per solved task) | Behind on Terminal-Bench 2.0: -5.5 points (124 of 171 against 132 of 171), interval -11.4 to +0.5, probability of being ahead 0.06; the interval crosses zero, so not significant at 90%. Slower there: 247 s against 203 s mean wall per run (no interval computed) | Accuracy: +2.6 points on the 42 tasks with an interval of -1.4 to +9.9 (crosses zero); tie at 36 of 36 on the harder suite |

Known weaknesses that are not in the tables:

- The guard hook does not recognise every indirect shell form: some destructive commands wrapped in a subshell,
  `bash -c`, `xargs` or `find -exec` pass its always-deny list (independent audit of 2026-11-15; a fix is prepared and
  not yet merged). Treat it as a guard against mistakes, not as a sandbox.
- Leaving plan mode turns permission bypass on in a session that started in safe mode (by design in
  `extensions/bypass-permissions`, not yet reflected in the safety documentation).
- Wall-clock time is not gated (it depended on API and machine load); the local start-up and hook overhead is not
  measured by any check yet.
- Both task sets are close to saturated, one model and one machine were used, the tasks are mostly Python, and no
  task was solved by ny-pi alone. Claude Code has 2 repetitions on the 42 tasks against 12 for the other two.
- On the pooled Terminal-Bench 2.0 sample (73 tasks, 171 attempts), ny-pi solved 124 and Claude Code 132: -5.5
  points, 90% interval -11.4 to +0.5, probability of ny-pi being ahead 0.06. The interval crosses zero, so it is not
  significant at 90%, but the estimate leans against ny-pi, which also ran slower (247 s against 203 s per run).
  Nothing here supports "more accurate than Claude Code".
- Against plain pi on the same benchmark the result is inconclusive (+2.3 points, interval -5.1 to +10.2) and ny-pi
  costs 1.34x per task.

## Results at a glance

Same model (Claude Sonnet 5.5) for every harness, results of 2026-11-15 (Terminal-Bench 2.0: 2026-11-18).

| Suite | **ny-pi** | pi 1.5.2, no harness | Claude Code, no configuration |
|---|---|---|---|
| 42 tasks: solved | **97.8%** | 94.0% | 95.2% |
| 42 tasks: cost per solved task | **US$ 0.047** | US$ 0.040 | US$ 0.085 |
| 12 harder tasks (36 runs): solved | **36 of 36** | 34 of 36 | 36 of 36 |
| 12 harder tasks: cost per solved task | **US$ 0.178** | US$ 0.156 | US$ 0.219 |
| Terminal-Bench 2.0 (73 tasks): solved | **124 of 171** (72.5%) | 125 of 168 (pi: 72 tasks) | 132 of 171 (77.2%) |
| Terminal-Bench 2.0: cost per solved task | **US$ 0.118** | US$ 0.087 | US$ 0.143 |

The Terminal-Bench rows are per pair of harnesses on the tasks both ran: ny-pi is 124 of 168 and US$ 0.117 in the
pair with plain pi (which skipped the `vulnerable-secret` task). Details in the
[pooled Terminal-Bench section](#terminal-bench-20-pooled-sample-73-tasks).

## Benchmarks

### 42 tasks

Same model for every harness (Claude Sonnet 5.5), same 42 tasks, results of 2026-11-15.

| Harness | Tasks solved | Cost per task | Cost per solved task | Repetitions |
|---|---|---|---|---|
| **ny-pi (this repository)** | **97.8%** | **US$ 0.046** | **US$ 0.047** | **12** |
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
| **ny-pi** | **36 of 36** | **US$ 0.178** | **6.2** |
| Claude Code, no configuration | 36 of 36 | US$ 0.219 | 6.6 |
| pi 1.5.2, no harness | 34 of 36 | US$ 0.156 | 5.6 |

- This suite does not separate accuracy either: all three harnesses are at or near the ceiling.
- It separates cost: paired by task, ny-pi costs 0.82x Claude Code (90% interval 0.73 to 0.91) and about 1.2x
  plain pi.
- The ny-pi row was measured without the shell-output clamp, which was removed the same day because of this
  measurement: with it, ny-pi needed twice the tool calls and cost 0.97x Claude Code (0.86 to 1.09).
- The hidden tests were audited by reviewers who did not write the tasks; 23 demands that neither the prompt
  nor the spec stated were relaxed, and every stored run was re-scored.

### Terminal-Bench 2.0 pooled sample (73 tasks)

The 24 tasks of the first sample (below) plus 49 more unseen Terminal-Bench 2.0 tasks, run on 2026-11-18 against the
same three harnesses. Graded by Terminal-Bench's own tests; difference = mean per task, bootstrap paired by task
(10,000 resamples, fixed seed). Plain pi ran 72 tasks (`vulnerable-secret` excluded). The per-run data of
this pooled sample are not yet in [`docs/bench/`](docs/bench/); the numbers come from the maintainer's benchmark log.

| ny-pi against | Tasks | Solved (ny-pi against other) | Difference, 90% interval | Probability ny-pi is ahead | ny-pi cost per task | US$ per solved task | Wall per run |
|---|---|---|---|---|---|---|---|
| Claude Code | 73 | 124 of 171 against 132 of 171 | -5.5 points (-11.4 to +0.5) | 0.06 | 0.77x | 0.118 against 0.143 | 247 s against 203 s |
| Claude Code, without `vulnerable-secret` | 72 | 124 of 168 against 129 of 168 | -4.2 points (-10.2 to +1.4) | 0.10 | 0.79x | 0.117 against 0.144 | 252 s against 207 s |
| Claude Code, without the tasks corrected in Terminal-Bench 2.1 | 53 | 107 of 123 against 111 of 123 | -5.0 points (-11.3 to +0.6) | 0.07 | 0.73x | 0.090 against 0.119 | 118 s against 132 s |
| plain pi | 72 | 124 of 168 against 125 of 168 | +2.3 points (-5.1 to +10.2) | 0.68 | 1.34x | 0.117 against 0.087 | 252 s against 183 s |
| plain pi, without the tasks corrected in Terminal-Bench 2.1 | 52 | 107 of 120 against 102 of 120 | +7.1 points (-1.3 to +16.0) | 0.91 | 1.26x | 0.090 against 0.075 | 121 s against 123 s |

- Against Claude Code: behind in tasks solved on every cut (-4.2 to -5.5 points), no interval excludes zero, so the
  difference is not significant at 90%; the probability of ny-pi being ahead is 0.06 to 0.10. ny-pi costs 23% less
  per task (0.77x) and US$ 0.118 against 0.143 per solved task. Its lower limit (-11.4) is below the -10 point
  margin the gate uses, so non-inferiority is not shown either.
- Against plain pi: inconclusive on the full set (+2.3 points, interval crossing zero, probability 0.68) and ny-pi is
  more expensive (1.34x per task, US$ 0.117 against 0.087 per solved task). Only the cut without the tasks corrected
  in Terminal-Bench 2.1 leans ahead (+7.1, interval -1.3 to +16.0, probability 0.91), and that interval also
  crosses zero.
- Claude Code solves more than plain pi (+6.5 points, interval 0.0 to +13.4, probability 0.95).
- ny-pi and Claude Code were run through a subscription login and plain pi through an API key; the modes are not
  controlled between arms. On the 26 tasks where plain pi ran through the key, the difference to ny-pi is 0.0 points
  (-10.3 to +11.5).
- Still not comparable with the public Terminal-Bench leaderboard (version 4.1, maximum effort, several attempts).

### Terminal-Bench 2.0 first sample (24 tasks)

24 tasks drawn at random (seed fixed before any run) from the Terminal-Bench 2.0 tasks no harness here had seen; one
attempt per task, default effort, each harness run once on 2026-11-15. Graded by Terminal-Bench's own tests.

| | **ny-pi** | Claude Code, no configuration | pi 1.5.2, no harness |
|---|---|---|---|
| Solved | **19 of 24** (first run: 20) | 21 of 24 | 16 of 24 |
| Cost per solved task | **US$ 0.073** (first run: 0.074) | US$ 0.094 | US$ 0.090 |
| Median wall per task | **30 s** | 23 s | 30 s |

| ny-pi against | Difference in tasks solved | 90% interval (paired by task) | ny-pi cost per task | ny-pi wall per task |
|---|---|---|---|---|
| Claude Code | -8.3 points (1 won, 3 lost) | -29.2 to 0.0 | 0.71x | 1.39x |
| pi, no harness | +12.5 points (5 won, 2 lost) | -8.3 to +25.0 | 1.15x | 1.10x |

- Neither accuracy interval excludes zero: on these tasks ny-pi is not shown better or worse than either harness.
  It costs less than Claude Code per task and is slower.
- The first ny-pi run lost its local settings inside the container (fixed before the second run); both runs are
  published. One task (`dna-assembly`) flipped between the two runs of the same harness, so single-attempt
  differences of one or two tasks are noise.
- Failures shared by all three harnesses: both `polyglot` tasks (test binaries left in the output directory).
  ny-pi also failed `feal-linear-cryptanalysis` (ran out of time on a slow attack) and `overfull-hbox` (changed a
  word it was not allowed to change).
- This is not comparable with the public Terminal-Bench leaderboard (now version 4.1, maximum effort, several
  attempts).

### Cost per solved task

| Suite | **ny-pi** | Claude Code | pi, no harness | ny-pi vs Claude Code |
|---|---|---|---|---|
| 42 tasks | **US$ 0.047** | US$ 0.085 | US$ 0.040 | 0.57x per task (paired) |
| 12 harder tasks | **US$ 0.178** | US$ 0.219 | US$ 0.156 | 0.82x (90% interval 0.73 to 0.91) |

Plain pi is the cheapest per task: ny-pi spends 23% more on the 42 tasks (a larger fixed prompt, read from cache on
every turn) and about 1.2x on the harder suite. What that buys: more tasks solved than plain pi on the 42 tasks, and
a lower cost than Claude Code on both suites.

### What the numbers do not show

- Against Claude Code the 42-task interval (-1.4 to +9.9 points) crosses zero: the advantage shown here is cost, not
  accuracy.
- Claude Code has 2 repetitions on the 42 tasks; ny-pi and plain pi have 12.
- Both task sets are close to saturated (most tasks are solved by every harness), so differences under about
  6 points cannot be resolved.
- One model, one machine, Python-heavy tasks. No task was solved by ny-pi alone.
- Terminal-Bench 2.0 pooled: against Claude Code the interval (-11.4 to +0.5 points) crosses zero, so neither a
  deficit nor equality is established; ny-pi and Claude Code ran through a subscription login and plain pi through
  an API key.

### Changes tried and rejected (Terminal-Bench 2.0 A/B, 2026-11-17)

Candidate changes were measured against the same ny-pi without them on 15 confirmatory Terminal-Bench 2.0 tasks (45
runs against 30), paired by task, 90% interval:

| Candidate | Solved | Difference | Cost | Decision |
|---|---|---|---|---|
| R1b (`r1b-r1`) | 26 of 45 against 30 | -8.9 points (-17.8 to -2.2) | 1.00x | rejected: worse |
| R1b (`r1b-ledger`) | 28 of 45 against 30 | -4.4 points (-8.9 to 0.0) | 1.13x | rejected |
| R1c | 28 of 45 against 30 | -4.4 points (-8.9 to 0.0) | 1.27x | rejected |
| Prefix floor (E1) | 31 of 45 against 30 | +2.2 points (-4.4 to +11.1) | 0.92x | not worse, 8% cheaper |

On all 20 tasks the prefix floor is +3.3 points (-5.0 to +11.7) at 0.93x. The floor is not shown better, only not
worse and cheaper; it entered `main` through the gate below. The A/B spent about US$ 63.

### What entered `main` on 2026-11-18, as measured by the gate

Six pull requests merged with `bench-pr` passing. Each ran the sequential gate (next section), stopped at look 1 and
used 58 executions: 42 tasks paired against the frozen k12 round of commit `0ed4943`, the interval being the 99%
interval of the accuracy difference (PR minus base).

| PR | Change | Cost ratio against base | Accuracy difference, 99% interval |
|---|---|---|---|
| #41 | Boot and output | 1.03x | -4.0 to +12.7 points |
| #40 | `CLAUDE.md` 51% smaller | 0.97x | -0.2 to +6.9 points |
| #48 | Guard timeout of 30 s | 1.01x | +0.4 to +17.9 points |
| #49 | Prefix floor in unattended top-level sessions | 0.91x | -4.2 to +12.2 points |
| #50 | Shell timeout clamp | 0.86x | -5.7 to +11.9 points |
| #51 | Refusal fallback for `claude-sonnet-5-5` | 0.84x | -0.2 to +6.9 points |

- The cost ratios are one repetition of the PR against the k12 base: noisy, and **they do not add up**. #50 at
  0.86x and #51 at 0.84x do not mean the harness became 16% cheaper in total; the gate only asks for at most 1.10x
  (1.05x to stop at look 1). The intervals are wide: none shows a drop beyond -10 points; #48's lower bound sits just above
  zero (+0.4), which at k1 is not claimed as a gain.
- #49 lowered the median cache read per run from 63.6k tokens (the #48 round, same 58-run task mix) to 39.5k.
  That is the measurement behind its 0.91x. (The frozen k12 base has a different task mix, 75.0k, and is not
  comparable run for run.)
- #51 (refusal fallback) is not exercised by the gate: its 0.84x is noise, not an effect, and the fallback itself
  is untested by the 42 tasks.
- Turns ratio was 1.000 on all six; wall time was 1.07x to 1.19x the base and is informational.

### How the gate works on every PR

The `bench-pr` check runs the pull request head and compares it with the frozen round of `main`. Since #45 it is
sequential: look 1 runs the candidate once per task (security cases three times) and stops early only when the 99%
interval of the accuracy difference is above -10 points, cost and turns are at most 1.05x, and security passes (or
fails early on a clear drop or a confirmed security regression); otherwise look 2 completes three repetitions and
applies the rule below, and look 3 extends the disagreeing tasks. It fails on:

- a drop in tasks solved beyond -10 points (paired 90% interval);
- cost above 1.10x;
- turns (model round trips) above 1.10x;
- a security regression.

Wall-clock time is published for information only since 2026-11-15: it depended on API load and machine load, not on
the change. The rule, the statistics and the evidence kept per run are in the
[runbook](docs/bench/RUNBOOK.md).

What the sequential gate measured (simulation of 10,000 iterations per scenario on the frozen round and on the
`0ed4943` base, [runbook section "Gate sequencial"](docs/bench/RUNBOOK.md#gate-sequencial)):

- Detection equals the previous rule: the paired difference is between +0.00 and -0.02 points (error of +-0.03) in
  every scenario, including uniform drops of 10 and 15 points and cost or turns 15% higher.
- Stopping at look 1 takes 58 executions against 118 for the previous fixed k3 flow, 51% fewer (118 = 58 plus two
  more repetitions of the 30 tasks that are neither security cases nor Harbor; derived from the run counts and
  `bench/suites.toml`, the 58 observed in the six runs above).
- That saving applies only when look 1 decides alone, about 18% of unchanged PRs in the simulation. On average the
  runbook expects about 10 fewer executions per unchanged PR (-8%) and 12 to 22 on real drops (-8% to -15%).
- Known gap, evaluated and not fixed: a rare security failure (15% or 30% of repetitions on one task) is blocked in
  only 33.7% and 49.1% of simulated PRs. Every denser design tested (up to 48 repetitions) failed at least one
  pre-registered criterion, so the rule did not change
  ([runbook section "Regra de segurança mais sensível"](docs/bench/RUNBOOK.md#regra-de-segurança-mais-sensível-pré-registro-2026-11-18)).

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

Each extension is one directory or file under [`extensions/`](extensions/), with its reason in the header comment;
deleting it removes the feature. Not every extension has been measured on its own: the benchmark measures the
harness as a whole, and per-extension measurements exist for a few (the output cut, the prompt cache, the
unattended-run block), recorded in [`docs/bench/`](docs/bench/).

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
before creating the symlink, copies `settings.json`, `mcp.json`, `lsp.json`, `models.json`, `local.env` from the `*.example`
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

`models.json.example` (copied to `~/.pi/agent/models.json` only when absent) enables the provider's refusal
fallback for `claude-sonnet-5-5`, matching Claude Code: when the cyber safeguards refuse a message, the
`claude-sonnet-5` answer replaces the error. Its price applies only to fallback responses. To turn it off,
delete the entry from `~/.pi/agent/models.json`.

## Quality gates

Every pull request must pass four required checks before merge:

| Check | What it blocks |
|---|---|
| `ci-static` | Lint, format and types (ruff, mypy strict, shellcheck, shfmt, biome, markdownlint), unit tests, 80% coverage on changed lines, file and directory size limits |
| `ci-security` | Secrets (gitleaks), static analysis (semgrep), dependency advisories (osv-scanner), unpinned GitHub Actions |
| `instruction-budget` | Growth of the always-loaded prompt beyond the recorded token budget |
| `bench-pr` | The benchmark (sequential, stops at look 1 when clear): a drop in tasks solved beyond -10 points (paired 90% interval), cost above 1.10x, turns above 1.10x, or a security regression fails it; wall-clock time is informational |

OpenSSF Scorecard and CodeQL (Python, JavaScript/TypeScript, Actions) run weekly and on pushes to `main`, never on a
pull request, so they add no time to one.

The same checks run locally with `bash scripts/ci/local.sh` (under 15 minutes; [details](docs/ci-local.md)).

## Comparison with other harnesses

Only what is measured here: same model, same tasks, results of 2026-11-15 (Terminal-Bench 2.0: 2026-11-18).

| | **ny-pi** | Claude Code, no configuration | pi 1.5.2, no harness |
|---|---|---|---|
| Tasks solved (42 tasks) | **97.8%** | 95.2% | 94.0% |
| Tasks solved (12 harder tasks, 36 runs) | **36 of 36** | 36 of 36 | 34 of 36 |
| Cost per solved task (42 tasks) | **US$ 0.047** | US$ 0.085 | US$ 0.040 |
| Cost per solved task (harder) | **US$ 0.178** | US$ 0.219 | US$ 0.156 |
| Tasks solved (Terminal-Bench 2.0, 73 tasks; pi 72) | **124 of 171** | 132 of 171 | 125 of 168 |
| Turns per run (harder) | **6.2** | 6.6 | 5.6 |

Plain pi is cheaper and takes fewer turns; ny-pi solves more than plain pi on the 42 tasks but not shown on
Terminal-Bench, and more than Claude Code has not been shown (on Terminal-Bench it is 5.5 points behind, not significant
at 90%). Claude Code costs more per solved task on all three suites. Features that were not measured are not
compared.

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
