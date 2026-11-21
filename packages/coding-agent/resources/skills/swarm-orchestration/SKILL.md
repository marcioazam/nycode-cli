---
name: swarm-orchestration
description: "Route work so the main session orchestrates and pinned workers implement: tier per agent, self-contained briefs, parallel lanes, one gate run, bounded escalation. Use when delegating or running parallel lanes (/swarm)."
---

# Swarm orchestration

The main thread (ideally on Opus) scopes, decomposes, briefs, routes, integrates and judges. Workers on the cheapest
tier that holds quality write the code, run the commands and sweep the files. Quality comes from the checks around
the workers, not from running them on the most expensive model.

## Tiers

| Tier | Model, list price in/out per MTok | Gets |
|---|---|---|
| `haiku` | Haiku 5.5, 0.10 / 0.50 USD (prompts up to 100k tokens; 0.50 / 2.50 above) | A fully specified narrow unit with no design choice left. In pi: `Explore`, `gate-runner`, `git-delivery`, `code-mapper`, `research-scout`, `linear-operator`, `egm-structural`, `impeccable-manual-edit-applier` (search, mapping, bounded lookups, CRUD, mechanical edits, command runs). Never an implementer of features or fixes: Haiku only for search, mapping and planning-style reads (research 2026-11-13 C44). |
| `sonnet` | Sonnet 5.5, 2 / 10 USD | Every other worker: features, bug fixes, tests, bounded refactors, debugging from a failure, fix lanes, escalations, mechanical edits (renames, copy, config, boilerplate from a named example) batched into one lane. In pi: `swarm-worker` by default, and every other agent (specialist writers, reviewers, scouts, `general-purpose`, `Plan`). |
| session | the model the session runs (`$PI_PROVIDER/$PI_MODEL`; Opus 5.5 is 4 / 20 USD) | Decomposition, ambiguous specs, architecture, integration judgment, final acceptance, and review of high-risk flows (auth, secrets, money, persistent data, migrations, concurrency, security, incompatible public contracts). In pi only the main thread runs here (only the session model orchestrates, whichever the user chose: Opus, Fable or another); no agent inherits it. |

How pi picks a subagent's model (pi-code `extensions/subagent/agents.ts`, `child.ts`): the `subagent` tool takes no
`model` per call. A concrete model id in the agent's `model:` wins; a tier alias (`haiku`, `sonnet`, `opus`) is
resolved by the first available model id that contains it, which picks the oldest tier (`sonnet` became
`claude-sonnet-4-5`, refused with a 404, on 2026-11-11), so pins use concrete ids; otherwise the child runs on
`CLAUDE_CODE_SUBAGENT_MODEL` when that variable is set (not for the built-ins `Explore` and `Plan`), else on the session
model. Pins today (2026-11-11, every agent pinned): `Explore`, `gate-runner`, `git-delivery`, `code-mapper`, `research-scout`, `linear-operator`, `egm-structural`, `impeccable-manual-edit-applier` = `anthropic/claude-haiku-5-5`; every other agent =
`anthropic/claude-sonnet-5-5`; when a new tier ships, update these ids. So the tier is
chosen by choosing the agent. Changing a pin is a harness change (edit `~/.pi/agent/claude-home/agents/<name>.md`), not a
per-task routing step; never edit agent files mid-task to change a tier.

Fable is never pinned on an agent unless the user names it; as the session model it is the user's choice and orchestrates like any other (Fable 5.2: 8 / 40 USD; 5 and 5.1: 10 / 50). Git delivery routes by the delivery rules (the `git-delivery`
agent), not by this table.

## Thinking level

pi has no per-call effort either. A child runs at its agent file's `effort:` (mapped 1:1 to pi's thinking level,
appended as `model:level` when a model is pinned) or, without one, at pi's `defaultThinkingLevel` (`medium` unless
`~/.pi/agent/settings.json` sets it). Rules for agent files and for the main session's thinking level:
- High-risk work (the session row's list) never runs below its model's default level.
- Never lower a reviewer's (`*-reviewer`) level.
- `xhigh` only for a fix lane or an escalation after a failed check; since the call cannot raise it, run such a lane
  in the main thread or accept the agent's default.
- `low` only for an agent that runs a script and makes no judgment (`git-delivery`).

Effort changes thinking, text and the number of tool calls; at `low` Haiku 5.5 may skip a search or a check
(platform.claude.com/docs/en/build-with-claude/effort). Claude Code background: `~/.claude/docs/effort-policy-2026-11-08.md`.

## Choose the shape (stop at the first rung that fits)

1. The edit is already in context and shorter than its brief: the main thread.
2. Decide by decomposability first (research 2026-11-13 C2: +80.8% decomposable, -70% sequential; C45). One coupled change (sequential steps, shared files or shared decisions): one worker (`subagent` `{agent, task}`).
3. Decomposable into two or more independent units (disjoint files, no data dependency), as lanes or team mode: one parallel `subagent` call
   `{tasks: [...]}` per wave (at most 8 tasks, 4 run at once); more units run in waves from the unit graph.
   A unit too large for one lane gets a lead writer that nests (see Nesting).
4. A gate, review and fix loop to automate: pi has no `swarm-lanes` workflow; drive it from the main thread (see
   "Run a multi-lane task" and `loop-engineering`), at most 4 writers at once.
5. A named Claude Code procedure (`/impact`, `/implement`, `/research-xcheck`, `/sota-audit`): its saved workflow is
   not ported to pi. On the user's ask, run its steps with `subagent` calls and say it ran by hand. `/swarm` is ported
   as a command (`~/.pi/agent/claude-home/commands/swarm.md`) and runs "Run a multi-lane task" below.

Prefer `swarm-worker` over `general-purpose` for writer lanes: same Sonnet tier, but `swarm-worker` has `maxTurns` and the
handback contract; `general-purpose` is for a multi-step task no specialist covers. Each handback, gate or fix step driven from the main thread is one main-thread turn that re-reads the main
context (Claude Code measurement: about 0.12 USD of cache reads at 300k on Opus); every subagent starts from its own
prefix (Claude Code: ~44k tokens, about 0.11 USD on Sonnet; pi's child prefix is not yet measured). Drive units one by
one when each handback changes the next decision (exploration, unclear spec, one or two units); batch a wave in one
parallel call when the units are specified upfront and the loop is mechanical.

Parallelism pays only for independent units: coupled coding work loses quality and spends 1.4-3.3x the tokens
when split, and one agent matches several at equal thinking tokens. Lane size, not the prefix, drives cost: writer
lanes ran p50 161 turns at a peak context of p50 459k (Claude Code, 14 days to 2026-11-08). Size a unit to one
acceptance item and about 100 tool calls, split along code-graph edges; a coupled unit that stays large runs as one
lane, resumed from disk (agent contract). Children compact by the same `~/.pi/agent/settings.json` thresholds as the
session (400k); `maxTurns` in the agent file is the outer bound, not the target. A run that stops at `maxTurns` returns
partial output: continue it with `{resume: "<run id>", task: "..."}` (background runs), re-scope or split. Batch micro
edits into one `swarm-worker` lane and never open a lane for a one-line change.
Correct a running background worker with `{send: "<run id>", task: "..."}` instead of
cancel and respawn: it lands at its next turn boundary, labelled as the lead's (never user authority); an undelivered
note in the completion means resend with `resume` (`PI_CODE_SUBAGENT_SEND=0` turns `send` off).

## Brief (every delegation)

Stable text first, the unit last:

- The task file itself (the `/docs` record path and its full acceptance), never a planner's summary of it: a
  summary-only handoff cut a team from 56.8% to 25.7% and the full file restored it (research C34; 2026-11-13 C29).
- Goal, and the decisions already taken that constrain it (names, signatures, error behavior, the pattern to copy
  with its path).
- Hard constraints copied verbatim: forbidden actions, approval gates, commit trailers, from the user and the
  repository. Paraphrase erodes them.
- Owned files, including the tests it writes; every other file is out of bounds.
- Done criterion the gate or a reader can check, and the `file:line` slices from your own mapping.
- The budget left for the unit (tool calls, fix rounds): a bigger budget alone does not help an agent that cannot see it
  (2026-11-13 research C15).
- When the target repo ships a role file for the unit (`harness/agents/<role>.md`), name its path in the brief (the child reads it per agent-contract).
- Skills the worker should read (path `~/.pi/agent/claude-home/skills/<name>/SKILL.md`), e.g. the specialist's skill.
- Output: the swarm-worker handback (status, block_kind, changed_files, summary up to 600 characters, risks).

Writers: `swarm-worker` (Sonnet) by default, with the domain skill named in the brief. Use a specialist writer
(`contract-engineer`, `test-author`, `gateway-engineer`, `go-service-engineer`, `web-platform-engineer`,
`terraform-specialist`, `docs-architect`, `dependency-remediator`, `zero-legado-builder`, `quality-toolkit-engineer`,
`mobile-app-engineer`) when its "Use when" matches
and the unit needs its built-in rules (Sonnet, like `swarm-worker`). Read-only sweeps: literal
search and inventory in the main thread with `rg`/`fd` when small, otherwise `Explore`; callers and flows with
`code-mapper` (both Haiku); skill `ripple-hunt` before a slow gate. A command run whose output only
needs reporting goes to `gate-runner`.

## Nesting (team tree)

One orchestrator at the root (the main session, depth 0); writer agents (no `tools:` list: `swarm-worker`,
`general-purpose`, the specialist writers, `lane-integrator`) may call `subagent` while their depth is below 3, so the
tree is main → lead (1) → specialist (2) → helper (3, leaf). Agents with a `tools:` list (reviewers, scouts, Haiku
runners) are always leaves. Enforced by `patches/pi-code/subagent-nesting.patch`: depth cap
`PI_CODE_SUBAGENT_MAX_DEPTH` (3); per lane (each child of the main session roots one) 64 runs
`PI_CODE_SUBAGENT_BUDGET` and 20 USD of finished descendants `PI_CODE_SUBAGENT_COST_BUDGET`; the main session is uncapped; parallel concurrency 4 at depth 0
and 2 below (`PI_CODE_SUBAGENT_NESTED_CONCURRENCY`), so a full tree holds at most 28 child processes; the roster
reaches only sessions that can still delegate.

- Flat by default: native subagents cut Claude Code from 83% to 59% on SWE-bench Verified at 1.4-3.3x tokens, and
  hierarchy paid only on hard tasks, where difficulty-aware topology reached higher accuracy at 40% of always-nested
  cost (research C32, C10). Best-of-n only for a critical unit with executable tests: an LLM judge adds ~1.6 pp and
  selection saturates at the verifier's precision (C4, C37). Keep prefixes stable and never switch a session's model
  mid-task (cache).
- Nest only where it pays: a lead hands read sweeps to `Explore`/`code-mapper` and the command run to
  `gate-runner` (Haiku, ~20x cheaper than Sonnet per token), or splits a unit too large for one context into
  disjoint sub-units with full briefs. Never re-delegate a whole brief (each handoff loses context: multi-agent
  runs go off-track 2-5x more, arXiv 2610.39193), never nest for a unit a single agent holds, and never let a
  sub-unit own a file its siblings own.
- Each level judges its own children's handbacks and returns one compact handback upward; the main thread never
  reads grandchild transcripts. The gate and the final review stay with the root.
- Team mode is opt-in (`PI_CODE_TEAMS=1` or `/team on`): tree-wide typed messages, shared board, exclusive-claim task queue, peer action feed, lead = main session, 2 concurrent writers by default (research 2026-11-13 C39, C40; interference rises 3-4x from 2 to 5 agents). Otherwise no mailboxes: a shared file beats messaging (arXiv 2608.16801); the task's `/docs` unit graph is the shared task list.

## Escalate, never repeat

- Route by difficulty up front, not by escalation: a unit that is cross-module, ambiguous, high-risk or in a large
  unfamiliar codebase starts at the session tier (main thread) or as a nesting lead; Sonnet and Haiku get the bounded
  ones. Mid-run escalation recovers under half the quality gap at a premium, cheap agents fall to ~17% of the strong
  one's pass rate on the hardest tasks, and a cheaper-per-token tier can cost more per task
  (`docs/research/2026-11-11-pi-multiagent-sota.md` C7, C24, C25). Escalate only on a deterministic signal (failed
  gate, empty diff, `blocked`), never on a worker's self-assessment.

- A `haiku` runner stops on difficulty or a check fails: one `swarm-worker` attempt with its summary and the failure
  output.
- `swarm-worker` fails twice on the same unit: the orchestrator re-scopes or splits it, or takes it to the session
  tier (the main thread, on the model the user chose); no third attempt at the same tier.
- A `spec` or `scope` block is a decision for the orchestrator (clarify, re-own files, or ask the user with
  `question`), never a reason to change tiers.

## Verify and judge

- Workers run only checks that compile nothing and finish in seconds. The gate (build, tests, lint, coverage) runs
  once on the integrated head, by `gate-runner` (Haiku), which reports `EXIT=` per check and the output tail.
- Gate first, then one direct review that reads the gate output: `code-reviewer` (Sonnet; a high-risk flow is reviewed in the main thread); specialist
  reviewers by their triggers. Reviewers derive the expected checks from the brief or plan before reading the diff
  and accept only executed evidence (the rule lives in the reviewer agent files). Every medium+ risk writer unit gets an independent critic with executable checks after the deterministic gate, never the maker grading itself (research 2026-11-13 C12: +3.9-6.6 pp at ~1.0x cost; C42, C29). A worker's own tests are not proof:
  run `doces-ou-travessuras` on diffs that touch tests, and give a high-risk unit a separate failing-first
  `test-author` unit before the implementation. A failing gate, a TRAVESSURA verdict or a medium or high finding gets
  a `swarm-worker` fix lane, at most two rounds.
- Lanes on separate branches or worktrees go to `lane-integrator` (skill `lane-integration`) only when they must be
  combined; a shared work tree needs no integrator.
- The orchestrator judges from `git diff --stat`, the lane summaries and the hunks that findings or high-risk units
  point at; it reads a full file only to settle a finding.

## Graph, loops and context

- Unit graph (units, `after` edges from the code graph, waves, critical path, re-plan per ready batch): skill
  `graph-engineering`, checked by its `scripts/unit_graph.py check`.
- Loops (stop conditions, round caps, no-progress stop, state on disk beyond one call): skill `loop-engineering`.
- Main-thread context, briefs and handbacks: skill `context-economy` (`references/agent-context.md`).
- Plan completion (`plan-reviewer` after the final gate): `loop-engineering` `references/patterns.md`.

## Run a multi-lane task (Claude's /swarm)

1. Settle scope and acceptance; open the task's `/docs` record when the work is not trivial; track units with `todo`.
2. Pick the root: the current git checkout when no owned file has unrelated uncommitted edits (note every other
   already modified path as the dirty baseline); otherwise a worktree from HEAD
   (`git worktree add -b swarm/<slug> ../<repo>.swarm-<slug> HEAD`, passed to each task as `cwd`), noting that
   gitignored files such as `.env` do not follow it. No agent here declares `isolation: worktree`, so the tool never
   creates one for you.
3. Map with `mcp__codegraph__codegraph_explore` (after `tool_search`) or an `Explore` sweep and write the unit graph
   per `graph-engineering`: `id`, `goal`, `files`, `tier`, `acceptance`, optional `after`, `agent` and `risk`; run its
   `scripts/unit_graph.py suggest` and `check` until `check` has no errors.
4. Run each wave as one parallel `subagent` call (`{tasks: [{agent, task, cwd?}]}`, at most 4 writers). After each
   wave, compare `git status --porcelain` with the owned files plus the dirty baseline: a stray edit is a
   `needs_decision`; re-plan the next wave from the handbacks.
5. Gate once with `gate-runner` on the integrated head, then review, then at most two `swarm-worker` fix rounds,
   stopping early when a round changes nothing. Classify the result:
   - `green`: judge the diff, then deliver per the delivery rules (commit, PR, merge authorization as standing).
   - `needs_attention`: settle each finding and out-of-scope file; fix through `swarm-worker`; rerun the gate once.
   - `needs_decision`: answer the blocked units (spec, scope, stray edits) and rerun only them.
   - `not_verified`: read the gate tail; a cause outside the owned files is a new unit or a question for the user.
6. Report per lane the agent and tier used, escalations, the gate result, open findings and what did not run.

## Evidence (read 2026-11-08)

- Lead with subagents beat a single agent on research at about 15x tokens; coding has fewer parallel tasks:
  https://www.anthropic.com/research/multi-agent-research-system
- Tiers: https://www.anthropic.com/claude-sonnet-5-5, https://www.anthropic.com/claude-haiku-5-5; prices:
  https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-11)
- Parallel coding agents spend 1.41-3.31x tokens: https://arxiv.org/abs/2610.10263; one agent matches several at
  equal thinking tokens: https://arxiv.org/abs/2604.02460; share decisions with workers:
  https://cognition.ai/blog/dont-build-multi-agents
- pi model order for a child (agent `model:` id, resolved tier alias, `CLAUDE_CODE_SUBAGENT_MODEL`, session model):
  `~/.pi/agent/npm/node_modules/pi-code/extensions/subagent/child.ts` (read 2026-11-11); Claude Code's order:
  https://code.claude.com/docs/en/sub-agents
- An independent gate, not the agent's own tests: https://arxiv.org/abs/2609.27871,
  https://arxiv.org/abs/2606.16062, https://arxiv.org/abs/2610.03984; constraints erode unless copied verbatim:
  https://arxiv.org/abs/2608.24569
- Re-plan per batch, one gate per integration: https://cursor.com/blog/self-driving-codebases; agents resolve
  their own merge conflicts: https://www.anthropic.com/engineering/building-c-compiler
- Loops and graphs: https://addyosmani.com/blog/loop-engineering/, https://ghuntley.com/ralph/,
  https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph
- Record and measurements (Claude Code): `~/.claude/docs/swarm-orchestration-2026-11-08.md`.
