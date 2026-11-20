---
name: sdd-workflow
description: Turn a non-trivial feature, bugfix, or existing-system change into an implementation-ready specification, product success criteria, and task plan. Not for a one-line edit.
---

# Spec-driven workflow

Use [specification lifecycle](references/specification-lifecycle.md) in proportion to risk. Understood, bounded changes use one existing or new `/docs` record with objective, acceptance, plan, checkpoint and evidence as sections, even when several files change. Critical flows, consequential architecture, incompatible public contracts, irreversible work or material ambiguity use the full adapted Spec Kit lifecycle; stages can still share one coherent record. Keep documentation and executable evidence aligned. In Plan mode (`/plan`), follow `plan-workflow` (it uses these references): draft only in the plan file it names, no repository or vault writes, submit with `plan_mode_complete`; materialize agreed docs when implementation starts.

Choose the lightest useful mode: feature spec, brownfield delta, bugfix current/expected/unchanged triad, or issue breakdown. Establish goals, non-goals, users, current behavior, interfaces, acceptance criteria, risks, and validation before implementation.

Follow the [research contract](../evidence-research/references/research-contract.md) when external uncertainty or consequential choices affect correctness; a plan alone does not impose web searches or a query quota. Ground external claims in primary sources and reuse task evidence. Choose modern stable compatible architecture, define acceptance tests and use TDD when required by risk or repository policy; preserve the global 800-line/7-file boundaries.

For material ambiguity, interview for the missing decision that changes scope or design. Use a brief pre-mortem when assumptions or rollout risks warrant it. Split substantial work into independently verifiable slices with dependencies and done criteria; a bounded change can remain one slice. Do not invent product policy.

When terminology or domain boundaries are unclear, establish a small glossary and record durable decisions in the repository's `/docs` source of truth. Ask in focused rounds: each round batches the questions whose prerequisites are settled, numbered and each with a recommended answer, and defers dependent questions to the next round. When the answers are discrete choices, ask with the `question` tool (`questions` holds up to 4 per call, 2-4 options each, recommended option first and labelled as such); ask open answers in plain text. Stop when the contract is implementable rather than expanding the interview.

Settle prerequisites before dependent decisions. Discover facts locally; reserve product tradeoffs for the user. Stress-test definitions with concrete scenarios, distinguish current behavior from intended change, and scope synonyms to the bounded context (for example, billing Customer need not equal authentication User). Keep the glossary separate from implementation detail. Record an ADR only for a meaningful tradeoff, reversal cost, or non-obvious rationale, following existing repository conventions. Do not require a new approval for already-authorized local implementation.

For the interview and domain-modeling checklist and provenance, read [design interrogation](references/design-interrogation.md) only when the proposal has ambiguous domain terms or multiple dependent decisions.

For product success criteria or a metrics review feeding a specification, read [product outcomes](references/product-outcomes.md). Define the metric population, formula, time window, source, baseline, and guardrails; mark missing targets as unknown. Use `design-handoff` for design-to-implementation contracts and `validate-data` before relying on supplied analysis as acceptance evidence. Product research findings can be synthesized through `design-review` without creating a second specification workflow.

Product-outcome extension adapted from Anthropic Knowledge Work Plugins (Apache-2.0), modified 2026-09-20; source and license are recorded in the reference.

For a multi-step execution plan or discovery spike, read [planning checklist](references/planning-checklist.md).

Fresh-context review (pi): for a full-lifecycle specification, once the draft exists, run one read-only review in a fresh context with `subagent` `{agent: "Plan", task: "..."}`. The task carries the spec path, the repository root and the stage 5 and 7 questions of the [lifecycle](references/specification-lifecycle.md): ambiguous or untestable acceptance, orphan requirements or tasks, inconsistent names and interfaces, missing failure and recovery cases, unsupported assumptions. Its findings are input to reconcile against evidence, not approval. When a public contract or migration is at stake, use `contract-migration-reviewer` instead. After implementation, `plan-reviewer` checks the whole execution against the spec and ends with `PLAN_REVIEW: complete` or `PLAN_REVIEW: incomplete`. The Claude Code EGM plugin (`/egm:*`) does not exist in pi.
