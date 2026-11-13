---
name: plan-workflow
description: The /plan workflow of pi - adaptive tiering, ambiguity gate, grill rounds with recommended answers and confidence, EARS acceptance, phases to tasks to steps, requirement checklists and fresh-context review, ending in a decision-complete plan. Loaded by plan mode; run only inside /plan.
disable-model-invocation: true
---

# /plan workflow

Goal: a **decision-complete** plan, one that an implementer can execute without making any product, contract or design decision.

Plan mode is read-only. A request to "just do it" means planning the execution. Answer in the user's language. Run P0–P8 in order, scaled by tier.

Write the plan **once**, in `plan_mode_complete`: the tool lints it and saves it to the plan file. Use `write` on the plan file only for short draft notes (decisions, open points) when a session has several question rounds, so they survive compaction. Never write the full plan twice.

A plan is as short as its tier allows: about 10 lines for T0, 60 for T1, 150 for T2 and 250 for T3. Padding and phases without a task-specific reason make plans worse.

## P0 Triage

The plan's first line is `Tier: Tn (sinais: …)`. Signals are OR-ed, so **one T3 signal makes the task T3, whatever its size**. Escalate when discovery reveals more. Downgrade only with evidence.

A **vague objective** ("melhorar", "otimizar", "mais robusto", with no observable target) or a doubt marker about a decision makes the task at least T2 and always earns a question: what the target is cannot be discovered in the code and is never a ≥90% assumption.

| Tier | When | Questions | Artifacts | Review |
|---|---|---|---|---|
| T0 | a mechanical edit with no behavior change (typo, rename), or an obvious one-file fix | none; list the assumptions | 1–3 tasks | — |
| T1 | new or changed behavior inside one module, clear acceptance | ≤1 round, ≤4 questions | /docs record, AC | checklists |
| T2 | several modules, a feature, external uncertainty, or a vague objective | ≤3 rounds, ≤5 per round | phases, EARS AC, unit graph | checklists + pre-mortem |
| T3 | auth, secrets, money, **persistent data or its format**, migrations, concurrency, a public contract or wire format, deletion or another irreversible step, security, or a contradiction or material ambiguity in the request | rounds until the frontier is empty (cap 6, then a spike or `/skill:to-questionnaire`) | full `sdd-workflow` lifecycle, pre-mortem, rollback | one fresh-context reviewer |

## P1 Ambiguity gate (mandatory)

Restate the objective in 1–3 lines and list the requirements R#. Then build the **ambiguity ledger** by scanning the coverage categories of [question policy](references/question-policy.md) (Clear, Partial or Missing). Each entry quotes the text that triggered it. Look for:

- vague terms;
- **contradictions**: quote both sides;
- missing acceptance criteria;
- hidden scope;
- doubt markers ("não sei", "acho", "talvez", "você vê", "?").

Score each entry by impact × uncertainty. Facts go to P2; decisions go to P3.

## P2 Discovery

Facts are your job; never ask the user for one. Use, in parallel:

- codegraph (`tool_search` codegraph), `rg`/`fdfind`/`read`;
- the repository's `/docs` and instructions, and knowledge vault (`kb.py search|section`);
- `Explore` or `code-mapper` for broad sweeps.

Use the web only when external uncertainty affects correctness: follow `perplexity-urls`, or call `perplexity-scout`, `web-scout` or `research-scout`. Cite every fact a decision rests on. Ask the questions that do not depend on a pending fact now.

## P3 Grill

Each round asks the **frontier**: the decisions whose prerequisites are settled. Use [question policy](references/question-policy.md) for format, depth (L1 confirm, L2 choose, L3 scenarios) and the **"não sei"** and **contradiction** protocols.

- Choice questions go through the `question` tool. The recommended option comes first, as `(Recomendado · ~NN%)` with its basis, and each option states its trade-off.
- Decide the confidence **before** writing the recommendation, from the evidence. Name the strongest alternative; when it is also plausible, the confidence is below 90%.
- **Assume, without asking,** only when confidence is ≥90%, the evidence backs it and the decision is reversible. Record it as `A# (~NN%, base)` for veto.
- **Always ask** below 90%, and for anything irreversible or touching a contract, security, money or data. That includes the storage or wire format of persistent data, even when one option looks obviously simpler.
- **A contradiction is always put to the user** with the contradiction protocol. Never reconcile it silently, however reasonable the reconciliation looks; noting it in the plan is not enough.
- A `D#` records a decision the user made, or one the facts force. A choice **you** made is an `A#`: it needs ≥90% and reversibility, or it becomes a question.
- When the question tool fails or nobody answers, take the recommendations as ⚠ assumptions, add a validation task, and say so in the plan.
- Every open point gets a disposition: decided now, spike task, deferred to a named task, or `A#`.
- Stop when the frontier is empty, when everything left is ≥90% and reversible, or at the tier's cap.

## P4 Specify (inline, as each point settles)

- Glossary of the ambiguous terms.
- `D#` decisions, each with its rationale and the alternatives rejected. Mark it as an ADR candidate only when it is hard to reverse, surprising and a real trade-off.
- `A#` assumptions.
- `AC#` acceptance criteria in EARS (T1 and above): `WHEN … THE SYSTEM SHALL …`, and `IF … THEN THE SYSTEM SHALL …` for failures. Each one is singular and testable.
- Non-goals.
- For a bug, the triad: current, expected and unchanged behavior.

## P5 Decompose

- **Phases** are headings with an exit gate.
- **Tasks** are vertical slices that each fit one fresh worker run. Number them globally `1.`, `2.`, … with titles of 50 characters or less; the tracker turns every numbered line into a todo. Each task lists these `-` bullets: agent and tier, owned files, read first, action, `after:`, AC#, check command, done criterion.
- **Steps**, checklists and questions are `-` bullets and are never numbered.
- Order the work so shared contracts come first and overlapping files are serialized. Leave out unrelated cleanup.
- Closing tasks: the final gate, `plan-reviewer`, delivery (if authorized), and knowledge vault capture.

## P6 Checklists and P7 Review

- Run [checklists](references/checklists.md) yourself: T1 and above for requirement quality and readiness, T2 and above for the pre-mortem. Fix each gap or state it. The lint in `plan_mode_complete` checks the mechanical part (tier line, EARS, AC coverage, check command, assumption %, risks and rollback) at no token cost.
- **T3 only:** run one fresh-context review with `subagent`. Pick ONE agent by the risk: `contract-migration-reviewer` (contract, schema, migration), `security-reviewer` (auth, secrets, input), `reliability-reviewer` (retries, concurrency, recovery), else `Plan`. Put the draft plan in the task text and ask one question: "could a newcomer execute this without deciding anything, and what breaks?", with findings by severity.
- Reconcile the findings against the evidence. Re-review only after CRITICAL changes, at most once more.

## P8 Submit

Follow [plan template](references/plan-template.md). `plan_mode_complete` carries the **full plan text**, never a pointer to a file. The plan opens with the tier line, then the A# list and the estimate. When the tool rejects the plan, it saves the text to the plan file: fix exactly what it lists there with `edit` and submit `"@file"`. Never resend the whole plan.

On execution, materialize the plan into the repository's `/docs` record first. For T2 and above that record is a living document: keep its Progress, Surprises, Decision log and Outcomes sections current, so the work survives compaction and handoff.

Sources: `docs/research/2026-11-plan-sota.md`. Adapted from Pocock grilling and grill-with-docs (MIT, `5863806`), Spec Kit 1.4.0 clarify, checklist and analyze (MIT), Kiro EARS, Edwards & Schuster 2026 (ask or assume), and the OpenAI ExecPlan template (living sections).
