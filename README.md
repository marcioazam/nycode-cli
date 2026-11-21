<p align="center">
  <img src="docs/assets/nycode-pixel.svg" alt="nycode" width="480">
</p>

# Nycode

Nycode is a terminal coding agent. It reads and edits files, runs shell commands and talks to many model providers. You shape it with [extensions](packages/coding-agent/docs/extensions.md), [skills](packages/coding-agent/docs/skills.md), [prompt templates](packages/coding-agent/docs/prompt-templates.md) and [themes](packages/coding-agent/docs/themes.md), and you can bundle them as [Nycode packages](packages/coding-agent/docs/packages.md) to share via npm or git.

Use it [interactively](packages/coding-agent/docs/usage.md), automate it in [print or JSON mode](packages/coding-agent/docs/cli.md), control it over [RPC](packages/coding-agent/docs/rpc.md), or build apps with the [Nycode TypeScript SDK](packages/coding-agent/docs/sdk.md).

This README states what is measured and what is not. Where a number is a loss, it sits next to the wins; a difference whose interval crosses zero is reported as "not shown", never as a win.

## Contents

- [The proposal](#the-proposal) · [What exists today and what is in migration](#what-exists-today-and-what-is-in-migration)
- [Getting started](#getting-started) · [Run with Nix](#run-with-nix) · [Packages](#packages) · [Permissions and containerization](#permissions-and-containerization)
- [Benchmarks](#benchmarks)
- [Contributing](#contributing) · [Development](#development) · [Building standalone binaries](#building-standalone-binaries) · [Supply-chain hardening](#supply-chain-hardening) · [License](#license)

## The proposal

**A coding agent that costs about what Pi Vanilla costs and solves at least as many tasks as Claude Code.**

- **Pi Vanilla** is the pi 1.5.2 coding agent with no harness: no extensions, skills, agents or hooks. It is the cheapest agent per task in every measurement below.
- **The bet** is a built-in harness (extensions, hooks, skills and agents) that makes Pi Vanilla solve more tasks while still costing well under Claude Code.

What the measurement shows today, with the same model (Claude Sonnet 5.5) for every agent:

- **Against Pi Vanilla:** it solves more tasks (+3.8 points on 42 tasks, +7.9 points on 72 Terminal-Bench 2.0 tasks, both with 90% intervals above zero), at about 1.2x to 1.3x the cost per task. It is not as cheap as Pi Vanilla.
- **Against Claude Code:** it costs less (0.57x per task on 42 tasks, 0.82x on 12 harder tasks, 0.77x on Terminal-Bench 2.0). In tasks solved it is **not inferior** on Terminal-Bench 2.0 (+1.4 points, 90% interval -3.2 to +6.0) but **not shown ahead** (probability of being ahead 0.68, below the 0.80 threshold); on the 42 tasks the difference is +2.6 points with an interval of -1.4 to +9.9. On Terminal-Bench 2.0 it is slower (225 s against 207 s per run). No measurement here supports "more accurate than Claude Code".
- **Where the numbers come from:** they were measured on **ny-pi**, the harness that Nycode is absorbing, running on pi 1.5.2. They were **not** measured on the Nycode binary. That measurement is pending by the owner's decision of 2026-11-20 (D-29): no benchmark round runs until after the migration. Until then, treat these figures as the target and the baseline, not as a property of this repository's binary.

Details, intervals, sample sizes and limits are in [Benchmarks](#benchmarks).

## What exists today and what is in migration

Today the Nycode binary is the terminal agent described above, version 1.6.0, with four built-in extensions (`llama.cpp`, `codemode`, `tool-search` and `mcp`, in [`packages/coding-agent/src/extensions/`](packages/coding-agent/src/extensions/)).

It also has the typed settings keys the harness will use (`harness.*`, `plan.gate`, `subagent.respawn`, `hooks`, `statusLine`, `permissions.bypass`, each with a `NYCODE_*` variable; see [settings](packages/coding-agent/docs/settings.md)) and a benchmark runner in [`bench/`](bench/) with a `nycode` arm. The settings keys only store configuration: the features they configure are not in the binary yet.

**Not in the binary yet** (the harness is being migrated from ny-pi, which still lives under [`import/ny-pi/`](import/ny-pi/)): sub-agents, plan mode, goal mode, todo, hooks, the agents and skills of the harness, its extensions, and the permission engine. They arrive in phases F5 to F9 of the migration plan in [`docs/migration/ny-pi-core/`](docs/migration/ny-pi-core/); the benchmark of the finished binary is F10. Until a phase lands, do not assume its feature exists.

## Getting started

Nycode is distributed as source from the public repository. Build it and run the CLI:

```bash
git clone https://github.com/marcioazam/nycode.git
cd nycode
npm ci --ignore-scripts
npm run build
node packages/coding-agent/dist/bundle/cli.js
```

To run it from sources without building, use `./nycode-test.sh` from the repository root. Nycode requires Node.js 22.19 or newer. A normal installation does not need dependency lifecycle scripts, so `--ignore-scripts` is safe.

Start Nycode in the directory where you want it to work (replace `node packages/coding-agent/dist/bundle/cli.js` with `nycode` if you put the binary on your `PATH`, for example with `npm link` in `packages/coding-agent`):

```bash
cd /path/to/project
node /path/to/nycode/packages/coding-agent/dist/bundle/cli.js
```

For a built-in AI provider, run `/login` inside Nycode to connect a subscription or API key. Then give Nycode a task.

See the [documentation](packages/coding-agent/docs/) for full setup and usage instructions.

## Run with Nix

```bash
nix run github:marcioazam/nycode/stable
```

`stable` points at the latest release. Install it with `nix profile add github:marcioazam/nycode/stable` and update with `nix profile upgrade nycode`. Use a release tag such as `github:marcioazam/nycode/v1.0.0` to pin a version, or `github:marcioazam/nycode` for unreleased changes on `main`. Nix builds Nycode from source.

Supports ARM64 and x86-64 on Linux and macOS. Use `nix build .` or `nix run .` to build or run your checkout.

The Nix build is currently broken: it needs an offline source for the bundled model data, which it used to download from a hosted catalog that nycode no longer uses (tracked in `nix/package.nix`).

## Packages

This monorepo contains the Nycode CLI and its supporting libraries.

| Package | Description |
|---------|-------------|
| **[@nycode/chord](packages/chord)** | Object runtime for apps across processes: contracts, documents, a store, links, plugins with hot reload, HTTP, workers, web and terminal clients |
| **[@nycode/telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@nycode/ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@nycode/durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@nycode/env](packages/env)** | Remote execution environments for Durable: a small daemon deployed over SSH and its client |
| **[@nycode/agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@nycode/codemode](packages/codemode)** | Sandboxed JavaScript execution where the only capability is calling injected tools |
| **[@nycode/mcp](packages/mcp)** | Standalone Model Context Protocol client |
| **[@nycode/schema](packages/schema)** | JSON Schema validation without `eval`: drafts 2020-12 and 7, compiled into plain closures |
| **[@nycode/coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@nycode/tui](packages/tui)** | Terminal UI library with differential rendering |

## Permissions and containerization

**Nycode has no permission engine yet.** No tool call is checked or blocked: it runs with the permissions of the user and process that launched it, and it does not ask for approval before each call ([security](packages/coding-agent/docs/security.md)).

The permission switches already exist but change nothing today:

- The flags `--bypass` (alias `--dangerously-skip-permissions`) and `--safe` (alias `--no-bypass`), the variable `NYCODE_BYPASS_PERMISSIONS` and the global setting `permissions.bypass` are parsed and resolved (flag, then variable, then setting, default off; an unrecognised variable value fails closed to off).
- Nothing reads the result yet. They take effect when the engine lands (phase F8: the ny-pi guard hook first, a native engine later).

If you need boundaries now, containerize or sandbox Nycode. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for four patterns:

- **Gondolin extension**: keep `nycode` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `nycode` process in a local container for simple isolation.
- **Docker Sandboxes**: run it in a Docker sandbox, optionally with a Claude Pro or Max token.
- **OpenShell**: run the whole `nycode` process in a policy-controlled sandbox.

## Benchmarks

**Read this first.** Every number in this section was measured on **ny-pi**, the harness Nycode is absorbing, running on pi 1.5.2. None of it was measured on the Nycode binary. The Nycode measurement is pending by the owner's decision D-29 (no benchmark round runs during the migration); it will replace these figures, not sit beside them.

Names used below:

- **ny-pi**: the harness (wrapper, extensions, hooks, skills, agents) on pi 1.5.2 with pi-code 1.7.0, frozen by hash. It is the arm that stands in for Nycode.
- **Pi Vanilla**: pi 1.5.2 with no harness (arm `pi-vanilla` in the raw data).
- **Claude Code**: Claude Code 2.1.323 with no configuration (arm `cc-vanilla`).

All three used the same model (Claude Sonnet 5.5). Results are from 2026-11-15; the Terminal-Bench 2.0 figures for ny-pi are a re-measurement of 2026-11-18 (72 tasks). The figures come from the ny-pi README at commit `e4f8729` (2026-11-20); which raw data are in this repository is listed under [Data in this repository](#data-in-this-repository).

### Where it wins and where it loses

**Against Pi Vanilla**

- Wins: solves more of the 42 tasks, +3.8 points (90% interval +1.2 to +10.5). Solves more on Terminal-Bench 2.0 (72 tasks), +7.9 points (+2.3 to +13.9), probability of being ahead 0.99. On the 52 Terminal-Bench tasks left after removing those corrected in Terminal-Bench 2.1 the lead holds: +9.6 points (+3.2 to +16.7).
- Loses: costs more per task, 1.23x on the 42 tasks, about 1.2x on the harder suite and 1.30x on Terminal-Bench 2.0. Takes more turns on the harder suite (6.2 against 5.6 per run; no interval computed). Answers later: first reply at 2.3 to 2.6 s against 1.1 to 1.6 s in a one-turn timing of 3 runs per arm, because of the larger fixed prompt (local timing, not in `docs/bench/`).
- Not shown: accuracy on the harder suite (36 of 36 against 34 of 36: too few failures to resolve).

**Against Claude Code**

- Wins: costs less per task, 0.57x on the 42 tasks, 0.82x on the harder suite (90% interval 0.73 to 0.91), 0.77x on Terminal-Bench 2.0 (US$ 0.106 against 0.144 per solved task). Fewer turns on the harder suite (6.2 against 6.6; no interval computed). **Not inferior** on Terminal-Bench 2.0: +1.4 points (134 of 168 against 129 of 168), interval -3.2 to +6.0.
- Loses: slower on Terminal-Bench 2.0 (225 s against 207 s mean wall per run; no interval computed). On the 52 Terminal-Bench tasks without those corrected in Terminal-Bench 2.1 the difference is -0.6 points (-6.4 to +4.5). `vulnerable-secret` is out of the new measurement; in the previous one ny-pi lost it 0 of 3 against 3 of 3.
- Not shown: **ahead**. On Terminal-Bench 2.0 the probability of being ahead is 0.68, below the 0.80 threshold. On the 42 tasks the difference is +2.6 points with an interval of -1.4 to +9.9 (it crosses zero). On the harder suite both solved 36 of 36.

### Results at a glance

| Suite | ny-pi | Pi Vanilla | Claude Code |
|---|---|---|---|
| 42 tasks: solved | **97.8%** | 94.0% | 95.2% |
| 42 tasks: cost per solved task | US$ 0.047 | **US$ 0.040** | US$ 0.085 |
| 12 harder tasks (36 runs): solved | **36 of 36** | 34 of 36 | **36 of 36** |
| 12 harder tasks: cost per solved task | US$ 0.178 | **US$ 0.156** | US$ 0.219 |
| Terminal-Bench 2.0 (72 tasks, 168 runs): solved | **134 of 168** (79.8%) | 125 of 168 | 129 of 168 (76.8%) |
| Terminal-Bench 2.0: cost per solved task | US$ 0.106 | **US$ 0.087** | US$ 0.144 |

The Terminal-Bench rows are the 72 tasks all three ran (`vulnerable-secret` excluded). The ny-pi column was re-run on 2026-11-18; the other two are the 2026-11-15/16 references, not interleaved with that run. Bold marks the best value in a row; a bold cell does not mean the difference is resolved (see the intervals below). The 97.8% and 94.0% are means over the 42 tasks both arms ran.

### 42 tasks

Same model, same 42 tasks, results of 2026-11-15.

| Harness | Tasks solved | Cost per task | Cost per solved task | Repetitions |
|---|---|---|---|---|
| ny-pi | **97.8%** | US$ 0.046 | US$ 0.047 | 12 |
| Pi Vanilla | 94.0% | **US$ 0.038** | **US$ 0.040** | 12 |
| Claude Code | 95.2% | US$ 0.081 | US$ 0.085 | 2 |

| ny-pi against | Difference in tasks solved | 90% interval (paired by task) | ny-pi cost |
|---|---|---|---|
| Pi Vanilla | +3.8 points | +1.2 to +10.5 | 1.23x |
| Claude Code | +2.6 points | -1.4 to +9.9 | 0.57x |

The 42 tasks: harness evaluations (tool use, refusals, output discipline), 12 plan-first tasks, 10 multi-module tasks with hidden tests, and 4 [Terminal-Bench 2.0](https://www.tbench.ai/) tasks. Against Claude Code the advantage shown here is cost, not accuracy.

### Harder, multi-file tasks

12 tasks in repositories of 20 to 40 files (a bug far from its symptom, a cross-cutting change with many rules, long and wide work), hidden tests, 3 repetitions each, results of 2026-11-15.

| Harness | Tasks solved | Cost per solved task | Turns per run |
|---|---|---|---|
| ny-pi | **36 of 36** | US$ 0.178 | 6.2 |
| Claude Code | **36 of 36** | US$ 0.219 | 6.6 |
| Pi Vanilla | 34 of 36 | **US$ 0.156** | **5.6** |

- This suite does not separate accuracy: all three are at or near the ceiling.
- It separates cost: paired by task, ny-pi costs 0.82x Claude Code (90% interval 0.73 to 0.91) and about 1.2x Pi Vanilla.
- The ny-pi row was measured without the shell-output clamp, which was removed the same day because of this measurement: with it, ny-pi needed twice the tool calls and cost 0.97x Claude Code (0.86 to 1.09).
- The hidden tests were audited by reviewers who did not write the tasks; 23 demands that neither the prompt nor the spec stated were relaxed, and every stored run was re-scored.

### Terminal-Bench 2.0 re-measurement (72 tasks)

The 24 tasks of the first sample (below) plus 48 more unseen Terminal-Bench 2.0 tasks. Only the ny-pi arm was re-run, on 2026-11-18 on ny-pi `main` at `e4f1746` (168 runs, 0 infrastructure errors, 7 agent timeouts against 10 before). Claude Code and Pi Vanilla are the references of 2026-11-15/16. Graded by Terminal-Bench's own tests; difference = mean per task, bootstrap paired by task (10,000 resamples, fixed seed). `vulnerable-secret` is excluded because the new ny-pi arm did not run it. The per-run data are **not** in this repository: the numbers come from the maintainer's benchmark log.

| ny-pi against | Tasks | Solved (ny-pi against other) | Difference, 90% interval | Probability ny-pi is ahead | ny-pi cost per task | US$ per solved task | Wall per run |
|---|---|---|---|---|---|---|---|
| Claude Code | 72 | 134 of 168 against 129 of 168 | +1.4 points (-3.2 to +6.0) | 0.68 | 0.77x | 0.106 against 0.144 | 225 s against 207 s |
| Claude Code, without the tasks corrected in Terminal-Bench 2.1 | 52 | 111 of 120 against 108 of 120 | -0.6 points (-6.4 to +4.5) | 0.42 | 0.70x | 0.081 against 0.119 | 120 s against 134 s |
| Pi Vanilla | 72 | 134 of 168 against 125 of 168 | +7.9 points (+2.3 to +13.9) | 0.99 | 1.30x | 0.106 against 0.087 | 225 s against 183 s |
| Pi Vanilla, without the tasks corrected in Terminal-Bench 2.1 | 52 | 111 of 120 against 102 of 120 | +9.6 points (+3.2 to +16.7) | 0.995 | 1.18x | 0.081 against 0.075 | 120 s against 123 s |

- Against Claude Code: **not inferior** (the lower limit, -3.2, is above the -10 point margin the ny-pi gate uses), **not ahead** (probability 0.68, below the 0.80 threshold). ny-pi costs 23% less per task (0.77x) and 26% less per solved task, and is slower on the full set. Without the tasks corrected in Terminal-Bench 2.1 the estimate is -0.6 points, so the +1.4 does not hold on that cut. The -10 point margin is a choice of the ny-pi gate, not a standard.
- Against Pi Vanilla: **superior** (interval above zero), at 1.30x the cost per task and US$ 0.106 against 0.087 per solved task: ny-pi solves tasks Pi Vanilla does not, and pays for it.
- Caveats: (1) the references were measured two to three days before and not interleaved with this run, so API or model drift under the same model id is not excluded; (2) `vulnerable-secret` is out, so this table does not say what happens on it now; (3) ny-pi and Claude Code ran through a subscription login and Pi Vanilla through an API key, and the modes are not controlled between arms; (4) power: showing an advantage over Claude Code would need interleaved arms and more tasks.
- Not comparable with the public Terminal-Bench leaderboard (version 4.1, maximum effort, several attempts).

#### Previous ny-pi measurement (2026-11-15/16)

Same 72 tasks and same references, ny-pi at `fd1bfb9`/`127e1be`, 10 agent timeouts. It is kept to show the change; the table above replaces it as the current figure.

| ny-pi against | Tasks | Solved (ny-pi against other) | Difference, 90% interval | Probability ny-pi is ahead | ny-pi cost per task | US$ per solved task | Wall per run |
|---|---|---|---|---|---|---|---|
| Claude Code | 73 | 124 of 171 against 132 of 171 | -5.5 points (-11.4 to +0.5) | 0.06 | 0.77x | 0.118 against 0.143 | 247 s against 203 s |
| Claude Code, without `vulnerable-secret` | 72 | 124 of 168 against 129 of 168 | -4.2 points (-10.2 to +1.4) | 0.10 | 0.79x | 0.117 against 0.144 | 252 s against 207 s |
| Claude Code, without the tasks corrected in Terminal-Bench 2.1 | 53 | 107 of 123 against 111 of 123 | -5.0 points (-11.3 to +0.6) | 0.07 | 0.73x | 0.090 against 0.119 | 118 s against 132 s |
| Pi Vanilla | 72 | 124 of 168 against 125 of 168 | +2.3 points (-5.1 to +10.2) | 0.68 | 1.34x | 0.117 against 0.087 | 252 s against 183 s |
| Pi Vanilla, without the tasks corrected in Terminal-Bench 2.1 | 52 | 107 of 120 against 102 of 120 | +7.1 points (-1.3 to +16.0) | 0.91 | 1.26x | 0.090 against 0.075 | 121 s against 123 s |

What changed: the ny-pi arm ran on a `main` that includes the 2026-11-18 changes of the ny-pi repository, and agent timeouts fell from 10 to 7. The re-run is a different sample of the same tasks, not a controlled A/B of those changes, so the data do not attribute the +5.6 point move (-4.2 to +1.4 on the same 72 tasks) to any one of them. In the references Claude Code solves more than Pi Vanilla (+6.5 points, interval 0.0 to +13.4, probability 0.95).

### Terminal-Bench 2.0 first sample (24 tasks)

24 tasks drawn at random (seed fixed before any run) from Terminal-Bench 2.0 tasks no harness had seen; one attempt per task, default effort, each harness run once on 2026-11-15. Graded by Terminal-Bench's own tests.

| | ny-pi | Claude Code | Pi Vanilla |
|---|---|---|---|
| Solved | 19 of 24 (first run: 20) | **21 of 24** | 16 of 24 |
| Cost per solved task | **US$ 0.073** (first run: 0.074) | US$ 0.094 | US$ 0.090 |
| Median wall per task | 30 s | **23 s** | 30 s |

| ny-pi against | Difference in tasks solved | 90% interval (paired by task) | ny-pi cost per task | ny-pi wall per task |
|---|---|---|---|---|
| Claude Code | -8.3 points (1 won, 3 lost) | -29.2 to 0.0 | 0.71x | 1.39x |
| Pi Vanilla | +12.5 points (5 won, 2 lost) | -8.3 to +25.0 | 1.15x | 1.10x |

- Neither accuracy interval excludes zero: on these tasks ny-pi is not shown better or worse than either. It costs less than Claude Code per task and is slower.
- The first ny-pi run lost its local settings inside the container (fixed before the second run); both runs are published in the source. One task (`dna-assembly`) flipped between the two runs of the same harness, so single-attempt differences of one or two tasks are noise.
- Failures shared by all three: both `polyglot` tasks (test binaries left in the output directory). ny-pi also failed `feal-linear-cryptanalysis` (ran out of time on a slow attack) and `overfull-hbox` (changed a word it was not allowed to change).

### What the numbers do not show

- Against Claude Code the 42-task interval (-1.4 to +9.9 points) crosses zero: the advantage shown there is cost, not accuracy. Claude Code has 2 repetitions on the 42 tasks; ny-pi and Pi Vanilla have 12.
- Both task sets are close to saturated (most tasks are solved by every harness), so differences under about 6 points cannot be resolved.
- One model, one machine, Python-heavy tasks. No task was solved by ny-pi alone.
- Terminal-Bench 2.0: against Claude Code the interval crosses zero, so non-inferiority is shown and a lead is not. The references were not interleaved with the re-run. The auth modes differ between arms (subscription login for ny-pi and Claude Code, API key for Pi Vanilla), which no analysis here controls.
- The ny-pi arm is the harness plus the maintainer's untracked personal layer (personal rules of about 2,500 tokens, settings, local environment, vendored packages), frozen by hash. Without the personal rules (2026-11-18, 42 tasks, one round, not interleaved): same accuracy (40 of 42 both ways) and 17% lower cost (90% interval 0.69x to 1.04x). Without the rest of the layer, and on Terminal-Bench, it has not been benchmarked.
- Nycode itself is not measured: the Nycode build has no harness features yet, and the migration may change behavior, cost and speed.

Known weaknesses of the harness that are not in the tables:

- The ny-pi guard hook does not recognise every indirect shell form: some destructive commands wrapped in a subshell, `bash -c`, `xargs` or `find -exec` pass its always-deny list (independent audit of 2026-11-15; a fix was prepared and not merged at the source's date). Treat it as a guard against mistakes, not as a sandbox.
- In ny-pi, leaving plan mode turns permission bypass on in a session that started in safe mode (by design, not yet reflected in its safety documentation).
- Wall-clock time is not gated (it depends on API and machine load); local start-up and hook overhead is not measured by any check yet.

### An older, worse round (2026-11-14)

The raw runs of this round are in the repository. Its ny-pi loss was mostly runs that called `plan_mode_complete` outside plan mode and stopped, and a `question` tool that failed without an interface. The round is **superseded** by the 2026-11-15 round above, which is more recent and is the one used elsewhere in this README. It is shown because it is the only round whose raw data cover all arms here, and because it is a loss.

Sonnet 5.5, 76 units per arm, 2026-11-14:

| Arm | Solved | Total cost | Median cost per run |
|---|---|---|---|
| Pi Vanilla | **74 of 76 (97.4%)** | **US$ 2.10** | US$ 0.0231 |
| Claude Code | 73 of 76 (96.1%) | US$ 5.57 | US$ 0.0645 |
| ny-pi | 62 of 76 (81.6%) | US$ 7.06 | US$ 0.0861 |

In that round ny-pi cost 3.4x Pi Vanilla and 1.3x Claude Code and solved 12 runs fewer than Pi Vanilla; the loss was almost all in the plan suite (14 of 24 against 24 of 24 for both others). On Opus 5.5 (22 units per arm) Pi Vanilla solved 22 of 22, ny-pi and Claude Code 20 of 22, and ny-pi cost 1.6x Claude Code. On 6 Terminal-Bench 4.1 tasks (one run each) ny-pi solved 2, the others 1. With 76 units and wide intervals, the data note calls these figures an order-of-magnitude reference, not proof of small differences. The 42-task round of 2026-11-15 was recorded after the headless fix (PR #23 of the ny-pi repository, per the data note).

### Data in this repository

| What | Where |
|---|---|
| Method, summaries and per-suite tables of the 2026-11-14 round (Pi Vanilla, Claude Code, ny-pi and a fourth agent, Oh My Pi, arm `omp`) | [`docs/bench/BASELINE-VANILLA-2026-11.md`](docs/bench/BASELINE-VANILLA-2026-11.md) |
| Aggregates of that round | [`docs/bench/BASELINE-VANILLA-2026-11.json`](docs/bench/BASELINE-VANILLA-2026-11.json) |
| Raw runs of that round (`runs.jsonl` and `meta.json` per arm) | [`docs/bench/baseline-vanilla-2026-11/`](docs/bench/baseline-vanilla-2026-11/) |
| Frozen ny-pi round that pull requests are compared with | [`docs/bench/baseline-main/`](docs/bench/baseline-main/) |
| Runbook, gate rule and statistics | [`docs/bench/RUNBOOK.md`](docs/bench/RUNBOOK.md) |

What is **not** in the repository:

- The per-run data of the 2026-11-15 rounds of Pi Vanilla and Claude Code, of the harder suite and of the first Terminal-Bench sample.
- The per-run data of the Terminal-Bench 2.0 re-measurement (72 tasks), which come from the maintainer's benchmark log.
- The local one-turn timing of first-reply latency.

So the headline figures above cannot be recomputed from this repository. Two things in `docs/bench/` also disagree with them, and the figures above are the more recent:

- The text of `BASELINE-VANILLA-2026-11.md` reports the 2026-11-14 round (ny-pi 62 of 76). The 42-task paired comparison it records (0.978 against 0.940, +0.038, interval +0.012 to +0.105, 1.23x cost) matches the +3.8 points above.
- `docs/bench/baseline-main/` holds the later ny-pi round of 2026-11-18 (commit `0ed4943`): 410 of 431 runs solved (95.1% pooled), US$ 17.43. The same file's text describes an earlier round of 2026-11-15 (417 of 428 runs, 97.4% pooled), and the 97.8% above is a mean over the 42 tasks both arms ran, so it is not the pooled rate of any one file.

### Reproduce

The runner is in [`bench/`](bench/); its arms (`pi-vanilla`, `cc-vanilla`, `ny-pi` and the migration arm `nycode`) are in [`bench/arms.toml`](bench/arms.toml). Real rounds spend model tokens, are capped by `--budget-usd` and need the credentials described in the [runbook](docs/bench/RUNBOOK.md). Under D-29 only `--dry-run` runs during the migration:

```bash
python3 bench/run.py run --arm ny-pi --tier baseline --model claude-sonnet-5-5 --budget-usd 40 --dry-run  # the 42 tasks
python3 bench/run.py run --arm ny-pi --tier hard --model claude-sonnet-5-5 --budget-usd 40 --dry-run      # the harder suite
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./nycode-test.sh         # Run nycode from sources (can be run from any directory)
```

### Using local packages outside the monorepo

Build every public package into one coherent local artifact set:

```bash
npm run pack:packages -- --out .artifacts/nycode-packages
```

This refreshes model data before building `nycode-ai`. To avoid network access when
model data is already hydrated, pass `--offline-model-data`.

Then configure an external project to consume one package and resolve all of
its Nycode dependencies from the same artifact set. npm is the default:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/nycode-packages/manifest.json \
  --consumer ../my-project \
  --package @nycode/durable \
  --package @nycode/agent-core
cd ../my-project
npm install --ignore-scripts
```

For a pnpm project, point `--consumer` at the workspace root:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/nycode-packages/manifest.json \
  --consumer ../my-project \
  --package @nycode/agent-core \
  --package-manager pnpm
cd ../my-project
pnpm install --ignore-scripts
```

Repeat `--package` for each direct dependency. The command updates the
consumer's `package.json` with content-addressed local `file:` references. It
writes transitive overrides to `package.json` for npm or `pnpm-workspace.yaml`
for pnpm. Keep the artifact directory available while installing or updating
the consumer. Re-run both commands after changing Nycode source.

## Building standalone binaries

No release is published yet: distribution (npm, GitHub Releases, installer) is a later phase of the migration, so there are no prebuilt binaries to download. To build them from a checkout, hydrate the model data and run the build script:

```bash
npm ci --ignore-scripts
npm run hydrate:model-data
./scripts/build-binaries.sh --skip-install --platform linux-x64 --out "$PWD/out"
```

The script builds the executable with its runtime assets for the platform you name (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`, `windows-arm64`; all of them when `--platform` is omitted). Pass `--offline-model-data` to use the bundled model data instead of refreshing it. `./scripts/create-source-archive.sh --version <version> --ref <git-ref> --out <archive.tar.gz>` creates the deterministic source archive that releases will carry.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `NYCODE_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent install lock.
- `packages/coding-agent/install-lock/` is generated from the root lockfile to pin transitive dependencies for release installs, and `npm run check` fails when it is out of date. The npm package does not pin transitive dependencies.
- Nothing is published to npm or GitHub Releases yet. `npm run pack:packages` and `npm run release:local` build and smoke-test the tarballs locally.
- `nycode update` installs with `--ignore-scripts`.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow (`npm-audit.yml`) runs a production dependency audit and `npm audit signatures --omit=dev`.
- Install lock generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
