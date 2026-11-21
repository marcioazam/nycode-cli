# Checklists (P6)

The checklists test the **plan's requirements**, not the implementation (Spec Kit: "unit tests for English"). Each failing item carries a trace tag (`[Spec §]`, `[Gap]`, `[Ambiguity]`, `[Conflict]`, `[Assumption]`, `[Coverage]`). At least 80% of the items should cite where in the plan they apply. Fix each failure, or keep it as an explicit gap.

## Requirement quality (T1+)

- Complete: every R# from intake is covered by an AC# or a non-goal.
- Unambiguous: no vague adjective survives without a number or a scenario ("rápido" becomes "p95 < 200 ms").
- Singular and testable: one behavior per AC, with an observable response.
- Consistent: the same names, limits and units appear in every section.
- Feasible: no AC depends on an unavailable tool, credential or authorization.
- Failure paths: every external call, input boundary and state change has an `IF … THEN` AC or an explicit non-goal.
- The bug triad is present for a fix: current, expected and unchanged behavior.

## Readiness (T1+)

- Traceability: AC → task → check, with no orphans in either direction.
- The DAG is acyclic. Shared contracts come first, and files that overlap are serialized.
- Each task fits one worker run, names real paths and commands, and has a done criterion.
- TDD is planned for bugs and critical flows, E2E for changed critical flows, and coverage per the contract.
- Structure limits hold: 800 lines per file and 7 code files per directory. Any split is planned.
- Rollback or coexistence is stated when state, schema or a contract changes.
- The authorization in force is stated. Steps outside it are marked `PLAN BLOCKED` candidates.
- An estimate is present: tasks, workers, rounds and the cost order of magnitude.
- The /docs record path for materialization is named.

## Pre-mortem (T2+)

"Two weeks from now this plan failed. Why?"

- Name the top 3 causes, each with its mitigation folded into a task or an AC.
- Independent verification: who checks each unit, in a context distinct from its author?
- One-way doors: for each irreversible step, the point of no return, the cost of undoing it, and the guard or confirmation that protects it.
- Hidden dependencies: environment, data, credentials, external services, flaky checks.
