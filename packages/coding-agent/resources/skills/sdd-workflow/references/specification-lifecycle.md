# Specification lifecycle

This is a local workflow adaptation of [GitHub Spec Kit](https://github.com/github/spec-kit) and its [agentic SDD reference](https://github.github.io/spec-kit/reference/agentic-sdd.html), reviewed 2026-09-28. It adopts the concepts, not the toolkit installation, branch commands or upstream orchestration policy. The task research record is [harness SDD research](~/.codex/docs/harness-sdd-obsidian-20260928/research.json). Refresh version-sensitive decisions when their scope changes.

## Artifacts and authority

Use the project's existing constitution and documentation conventions; reference applicable principles instead of duplicating global instructions. For understood, bounded work, use one existing or new record such as `docs/specs/<id>/work.md`, with objective/scope, acceptance, plan, current checkpoint and evidence as sections. Several changed files alone do not require a document bundle.

Use the full lifecycle below for critical flows as defined by the working contract, consequential architecture, incompatible public contracts, irreversible work or material ambiguity. Record missing project principles when relevant; create a separate constitution only for a durable project baseline. Stages, research, checklist, tasks, glossary and evidence may remain sections of one coherent record. Separate documents only for distinct maintained audiences or existing repository requirements; preserve traceability without a four-file minimum.

Link acceptance to tasks, checks, observed results and gaps in the same record. Use stable requirement identifiers when multiple slices need traceability; a compact evidence table is sufficient. Separate proposed behavior from observed behavior. Store sanitized, relevant evidence and runnable commands; do not copy credentials or full logs into specifications.

In Plan mode or read-only work, keep proposed artifacts in the conversation and perform no filesystem/vault writes. At the start of authorized implementation, materialize or update the agreed docs before changing executable behavior. Reuse authorization; the lifecycle does not introduce additional approval gates. Small, localized changes use proportionate acceptance notes and existing docs rather than a new document bundle.

## Stages and exit criteria

1. **Constitution:** inspect project principles, architecture, toolchain and gates. Resolve conflicts against instruction priority; record any unresolved constraint rather than silently weakening it.
2. **Specify:** define the problem, users, current/expected behavior, non-goals, compatibility and observable success/failure criteria. Avoid selecting implementation details before the requirement is clear.
3. **Clarify:** investigate discoverable facts first. Use [design interrogation](design-interrogation.md) to settle only consequential unknowns. Record assumptions and chosen tradeoffs; stop when implementation can proceed safely.
4. **Plan:** select the smallest compatible architecture, interfaces, data flow and modules; name relevant commands, failure/recovery behavior and rollout/rollback. Select TDD for bugs and critical executable flows, E2E for changed critical flows, coverage by risk and 800-line/7-file structure checks; preserve stricter repository gates. Record research sources when external uncertainty requires them and how they affect decisions.
5. **Checklist:** test the quality of the requirements: complete, unambiguous, consistent, feasible and verifiable. This is a specification review, not a claim that implementation tests passed.
6. **Tasks:** split substantial work into independently verifiable slices with dependency order, owned boundaries, acceptance and docs updates. Establish shared contracts first; serialize overlapping state or contracts. Bugs and critical executable slices require intended red, green and refactor evidence; other behavior changes require meaningful acceptance checks, with test-first optional.
7. **Analyze:** cross-check constitution, specification, plan and tasks. Identify orphan requirements, unsupported assumptions, inconsistent interfaces, missing failure cases and untestable acceptance. Resolve material gaps before dependent implementation.
8. **Implement:** follow the approved scope and selected validation strategy, including TDD when required. Keep the single task record accurate. When discoveries change the contract, update dependent sections before continuing; ask only for material scope, correctness or authority decisions.
9. **Converge:** compare intended and delivered behavior, tests and maintained docs. Validate affected examples and operations; reconcile drift and mark superseded guidance. Every acceptance criterion ends with observed evidence or an explicit gap. Capture new useful verified learning via `obsidian-cli`; if none, record that no capture was needed rather than copying task status to the vault.

## Completion

A task is complete when accepted behavior, required checks and maintained documentation agree. Missing required red/green or E2E, structural violations and insufficient required coverage remain explicit limitations; a checked box cannot substitute for evidence. Ordinary work has no universal per-file coverage floor. Reuse successful checks only when relevant code, tests, dependencies, commands and environment are unchanged and provenance is explicit; required fresh project gates still run. Local success does not establish CI, deployment or live-provider behavior. Keep one resumable checkpoint, without parallel status receipts.

## Acceptance format and clarification

Write each acceptance criterion in EARS form so it maps to a test: `WHEN <trigger> THE SYSTEM SHALL <observable response>`; add `IF <unwanted condition> THEN THE SYSTEM SHALL ...` for failure handling and keep the bugfix triad's expected and unchanged behavior in the same form. When the spec is underspecified, ask at most five targeted questions in one round, write the answers back into the spec, and record the rest as assumptions.
