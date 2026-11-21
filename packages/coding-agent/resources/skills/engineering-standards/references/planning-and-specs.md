# Planning and specifications

Use [sdd-workflow](../../sdd-workflow/SKILL.md) as the owner of the specification lifecycle and document shape. In Plan mode, inspect and present the plan without writing files; materialize docs when authorized implementation starts.

Plan before implementation when risk, unknowns or coordination warrant it: critical flows, irreversible work, consequential architecture, incompatible public contracts, an unexplored area, material ambiguity or parallel work needing ownership boundaries. Several files, an ordinary dependency update or a compatible API addition alone do not require the full lifecycle. Understood, bounded work uses one record with objective, acceptance, plan, checkpoint and evidence; preserve stricter repository requirements.

Keep a plan decision-oriented: objective, scope, observable behavior, constraints, risks, acceptance checks, and unresolved questions. For a non-trivial feature, keep a concise durable specification so a new session can resume without relying on chat history. Prefer one current source of truth; mark superseded specifications rather than accumulating competing documents.

Before finalizing a research-dependent decision, read relevant primary sources and record how evidence changes the plan. Research when external uncertainty, versions or consequential choices affect correctness; understood local work has no search quota. Reuse evidence across planning, implementation and continuations; refresh changed assumptions. Define acceptance and module boundaries, selecting TDD when required by risk or repository policy. See [research procedure](../../evidence-research/references/research-contract.md).

Decompose by independently verifiable behavior, not by implementation layer. Establish shared contracts before dependents. Serialize work that changes the same contract even when files do not overlap.

Skip formal planning for a localized, unambiguous change, pure investigation, formatting, or a straightforward additive scratch artifact.
