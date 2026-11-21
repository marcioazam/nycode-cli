# Question policy

## Coverage categories (P1 scan)

Mark each category Clear, Partial or Missing. Adapted from Spec Kit 1.4.0 `clarify`.

- Functional scope and behavior
- Domain and data model
- Interaction and UX flow
- Non-functional quality: performance, security, reliability, observability
- Integrations and external dependencies
- Edge cases and failure handling
- Constraints and trade-offs (budget, deadline, compatibility)
- Terminology and consistency
- Completion signals (acceptance, definition of done)
- Placeholders and leftover TODOs in the request

Priority is impact × uncertainty. A Partial or Missing category becomes a question only when its answer changes scope, correctness, design or authority. Otherwise it becomes an `A#` assumption.

## Confidence

The % estimates the chance that the recommendation is what the user would choose after reading the trade-off. State its basis:

- "convenção do repo em X";
- "você disse Y";
- "regra Z";
- "prática padrão, sem sinal local".

≥90% needs evidence, never taste alone. When the user's choices contradict your estimates, lower your later estimates.

Models overstate verbalized confidence (Xiong et al., ICLR 2024), so treat the number as an ordinal signal that gates behavior, not as a probability:

- Set it before writing the recommendation, from the evidence you can cite.
- Name the strongest rejected alternative. When that alternative is also plausible, the number is below 90%.
- No citable evidence means at most ~75%.

## Round format

Choice questions go in one `question` call (up to 4):

- `header` ≤12 characters, naming the topic.
- `question`: the motivating fact in one line, then the question. Phrase it so that accepting means taking the recommendation.
- `options`: 2–4 mutually exclusive options.
  - The first option is the recommended one: `"<option> (Recomendado · ~NN%)"`.
  - Each `description` gives the trade-off and the consequence.
- `multiSelect: true` only when the options can be combined, for example "which platforms".

Open questions go in the chat in the same round, numbered `Q5`, `Q6` and so on, each followed by `➡️ <recommended answer>`.

Do not ask a question that depends on another question still open in the same round.

## Depth per topic

| Level | When | Form |
|---|---|---|
| L1 confirm | ≥75% and low impact | one binary question: the recommendation or the alternative |
| L2 choose | real alternatives, medium impact | 3–4 options with trade-offs |
| L3 explore | high impact, irreversible, or a contract | concrete scenarios first: happy path, failure, boundary, recovery ("se o pagamento cair no meio, o que deve acontecer?"); then the choice |

## "Não sei" protocol

Trigger: the user answers "não sei", "tanto faz", "você decide", hedges, or leaves the question blank.

1. "Você decide" or "tanto faz" on a reversible decision means accept the recommendation. Record it as `D#` with the basis "delegado pelo usuário".
2. Otherwise, explain the consequence of each option in at most 2 lines, in user-observable terms rather than jargon.
3. Re-ask it as a simpler binary question, or as concrete scenarios.
4. If it is still unknown, offer these options:
   - follow the recommendation;
   - a spike task that settles it with evidence (time-boxed, with an output criterion);
   - ask a third party (`/skill:to-questionnaire`);
   - defer it to a named task.
5. If no answer comes back, record it as `A#` ⚠ and add a validation task before the dependent work. Never block the whole plan on it.

## Contradiction protocol

Trigger: two statements, or a statement and a fact found in P2, cannot both hold. This includes the request against a repository rule.

- In the question text itself, quote both fragments literally and name the conflict ("X conflita com Y"). The reader of the question must see both sides without the plan.
- Ask which one wins: one option per side, plus a reconciling option when one exists. Recommend one with its %.
- A conflict with a higher-precedence rule (security, the user's earlier explicit instruction, a repository gate) is not a preference. State the rule and the cost of overriding it.

## Over-asking guard

- Do not ask about a discoverable fact, a reversible detail inside an authorized scope, or something the implementer can choose at no product risk.
- Caps per tier are set in `SKILL.md`. With many ambiguities, ask the top items by impact × uncertainty and make the rest assumptions. Question quality degrades as ambiguity density rises.
