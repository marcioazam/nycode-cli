---
name: agent-systems
description: Design, evaluate, harden, or optimize an LLM agent, prompt, eval suite, tool contract, or subagent workflow. Not for ordinary application code.
---

# Agent systems

For design work, define the agent boundary, tool contract, stopping conditions, failure handling, evaluation, and cost budget before implementation. For existing systems, audit whether quality is measurable, judges and datasets are pinned, retries and fan-out are bounded, repeated context is avoided, and tool descriptions are treated as untrusted data.

Model and thinking level per agent follow skill `swarm-orchestration` (Tiers; in pi a subagent's tier is its agent file's `model:` pin, there is no per-call model). Reduce repeated context, unnecessary fan-out and unproductive retries before considering a model change. Report measured versus estimated cost per run and frequency (pi records per-message `usage.cost` in `~/.pi/agent/sessions/*/*.jsonl`; subagent results show turns, tokens and cost), and weigh every harness change by the harness-economy rule: quality is the floor (never weaken a gate, check, assertion or safety control), then the cheapest option in always-loaded bytes, model tier, agent calls, turns, context and hook latency (owner text: `$CLAUDE_CONFIG_DIR/rules-ref/harness-economy.md`, already in your context). Do not add tools, credentials, or autonomous side effects without authorization.

For harness evaluation, check receipts, or rule promotion, read [execution evidence](references/execution-evidence.md). Keep invariant rules always available and domain detail conditional; never silently truncate mandatory rules to meet a context budget. Prefer strengthening an existing skill over adding overlapping routers or agents.

When designing a recurring improvement loop, read [control loops](references/control-loops.md). Define a measurable target, sensor, bounded controller, actuator, disturbances, and stop condition before proposing automation.

For prompt/skill comparisons, routing evaluations, or LLM judges, read [evaluation design](references/evaluation-design.md). Separate held-out tasks from tuning, preserve paired evidence, and check judge bias before interpreting a score as improvement.

When writing or editing a skill, `AGENTS.md`/`CLAUDE.md`, or any document an agent reaches by a pointer, read [agent documents](references/agent-documents.md).

For GPT-6 Astra migration or behavior tuning, read [Astra](references/astra.md). For tool design or repeated agent/tool failures, read [tool contracts](references/tool-contracts.md). Load the applicable reference, not both by default.

Optimizing one prompt: change one meaningful variable at a time against the frozen cases and settings, stop after three non-improving iterations, and treat safety, tool contracts and failures as first-class evaluation outcomes. A proposed prompt change is not a measured improvement until the authorized comparison runs ([evaluation design](references/evaluation-design.md)). In pi, a live arm runs headless with `pi -p --mode json --no-session --model <pinned provider/id>` (add `--no-context-files` for an ablation without AGENTS.md/CLAUDE.md); the JSONL events carry the usage for cost per case.
