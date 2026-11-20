---
name: loop-engineering
description: "Design and run bounded agent loops (fix until green, review-fix, polling) with an external checker, stop conditions and caps. Use when building a loop or deciding when it stops. Not for graph-engineering or swarm-orchestration."
---

# Loop engineering

## Anatomy
Every loop has: a sensor (deterministic first: build, tests, lint, `EXIT=` sentinel, `doces-ou-travessuras` on test diffs), an actuator (a worker on the cheapest tier that holds quality; in pi the tier is the agent's `model:` pin, see `swarm-orchestration`), stop conditions a machine can check, a budget, state on disk, an escalation exit.

## Checker
The maker never grades itself: the gate runs first and its real output goes to one separate reviewer; never a fan-out of validators. Without external feedback, self-correction does not help and can hurt.

## Caps
- At most one escalation per lane (cheaper tier to the next once, e.g. a `haiku`-pinned runner to `swarm-worker` on `sonnet`, or `swarm-worker` to the session tier: the main thread or a specialist writer, never `general-purpose`), to a fresh `subagent` call whose brief carries the lower tier's summary and the failure output; never `resume` the failed lane's run (arXiv 2608.24358). At most two fix rounds per unit, then re-scope or split. More feedback rounds raise legitimate passes a little and test cheating more: the round cap plus an explicit escalate exit (`needs_decision`, `PLAN BLOCKED:`) is the guard.
- Step budgets saturate: size a unit to about 100 tool calls. A bigger budget alone does not help; put what remains (tool calls, rounds, tokens) in each round's brief.
- Fix the sensor before adding rounds: with weak tests or an imperfect verifier, more attempts hit a ceiling and invite hacks (1 in 5 "solved" SWE patches is wrong); strengthen the test or the verifier's criteria instead of another round.
- The user's token target when given (`+500k`): skip a further fix round when under about 100k tokens remain, and report instead.

## No progress
Stop and escalate when a round changes nothing (same failing check, no new edit or evidence); check it after each fix round's gate by comparing the failing checks and `git diff --stat` with the previous round. pi's `/goal <condition>` (pi-code) has a separate model judge the condition each turn and pauses (goal still set) after 8 consecutive not-met verdicts on turns that used no tool (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).

## State
Beyond one call (more than 12 units, or across sessions) keep the unit graph and each unit's status in the task's `/docs` record; machine-edited state as JSON (models damage it less than Markdown). Progress plus git history let a fresh context resume. One feature or acceptance item per lane. Prefer a fresh context with state on disk over a long compacted one.

## Patterns
[references/patterns.md](references/patterns.md): plan completion loop (an approved plan runs to the end until `plan-reviewer` returns `PLAN_REVIEW: complete`; pi has no plan Stop hook, so the loop is explicit or driven by `/goal`; exits `PLAN BLOCKED:`, `PLAN WAITING:`, `PLAN CANCELLED`), polling and scheduling (never poll background subagents; bounded polling only for external state), reward hacking inside loops (read the test hunks, run `doces-ou-travessuras`).

## Evidence (read 2026-11-08)
- https://arxiv.org/html/2411.17501v1 (imperfect verifier caps resampling), https://arxiv.org/abs/2603.00520 (1 in 5 solved patches wrong), https://arxiv.org/abs/2511.17006 (budget awareness), https://arxiv.org/abs/2504.01931 (high-fidelity feedback +10 pts over best-of-N); research 2026-11-13 in `docs/research/2026-11-13-graph-loop-harness-sota.md`
- https://code.claude.com/docs/en/goal (pi-code's `/goal` mirrors it; small evaluator checks the condition each turn from the conversation, runs no commands; no-progress stop)
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (JSON feature list; one feature per session; progress file plus git; vendor, qualitative)
- https://arxiv.org/html/2510.20270 (ImpossibleBench: 10 submissions raise pass 80% to 83%, cheating 33% to 38%; monitors catch 86-89% on LiveCodeBench, 42-50% on SWE-bench; abort option cuts cheating)
- https://arxiv.org/abs/2310.01798 (self-correction without external feedback does not help, can degrade)
- https://arxiv.org/abs/2608.24358 (escalating with the whole failed trajectory recovers under half the gain at a higher cost)
- https://arxiv.org/html/2604.11641 (success saturates near 40 steps on that benchmark)
- https://metr.org/evaluations/gpt-5-1-codex-max-report/ (about 4% of runs had reward hacks)
- https://openai.com/index/harness-engineering/ (reviewer loops until satisfied; plans as repository artifacts; vendor)
- https://addyosmani.com/blog/loop-engineering/, https://ghuntley.com/ralph/ (practitioner loop patterns)
