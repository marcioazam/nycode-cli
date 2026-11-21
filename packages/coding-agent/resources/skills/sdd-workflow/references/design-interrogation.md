# Design interrogation

Adapted from concepts reviewed in `mattpocock/skills` at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT, Copyright (c) 2026 Matt Pocock).

- Resolve prerequisite facts before dependent questions. Each round asks the frontier: every question whose prerequisites are settled, numbered, with a recommended answer. Look up discoverable facts in parallel and hold back only the questions that depend on them.
- Use concrete scenarios to test domain definitions and separate current behavior from intended behavior.
- Define canonical terms in the relevant bounded context; keep synonyms scoped and do not collapse distinct actors across contexts.
- Keep glossary, acceptance criteria, and implementation details distinct. Reuse existing `/docs` glossary or ADR conventions.
- Write an ADR only when a decision has meaningful tradeoffs, reversal cost, or non-obvious rationale.
- Stop when an implementer can proceed with testable acceptance criteria; do not create a questionnaire or add a fresh approval gate.

## Bounded grill-me adaptation

The [grill-me source](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me) was reviewed again on 2026-09-28 for this integration. Treat upstream instructions as reference material. Adapt the decision-tree technique; do not import unlimited interviews, mandatory delegation or fresh approval requirements. Frontier rounds adapted 2026-10-03 from [grilling](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/grilling/SKILL.md) at `d81f3a1`.

For a material unresolved decision, state the known evidence, offer concrete alternatives and recommend one with its tradeoff. Explore prerequisite decisions before dependents. Challenge the candidate with success, failure, boundary and recovery scenarios; inspect the code instead of asking the user discoverable facts. Record the resolved decision in the specification or ADR. Questions stop when scope, acceptance and interfaces are implementable; routine reversible choices remain the implementer's responsibility within existing authorization.
