# Writing documents for agents

Read when writing or editing a skill, `AGENTS.md`/`CLAUDE.md`, a rule file, or any document an agent reaches by a pointer. The same levers apply to all of them: they make the agent take the same process every run.

## Pointers

A skill description or a line naming another document is a pointer: its wording, not the target, decides when the agent reaches the material. Every word of an always-loaded pointer costs context on every turn.

- Put the trigger word first, and give one trigger per genuinely distinct case; synonyms for one case are a single case written twice.
- Cut identity the body already carries. If an important target is reached unreliably, sharpen the pointer before inlining the material.

## Hierarchy

- Keep in the file what every branch needs: the ordered steps and the reference they always use. Move material only some branches need behind a pointer.
- Keep a concept's definition, rules and caveats together under one heading instead of scattering them.
- A document that is simply too long thins attention even when every line is live; split by branch or by sequence.

## Completion criteria

End each step on a criterion that is clear (done is distinguishable from not done) and demanding ("every modified model accounted for" rather than "produce a change list"). A vague bound invites premature completion. Sharpen the bound first; hide later steps only across a real boundary such as a handoff or a subagent.

## Wording

- Prefer a compact word the model already knows (*tracer bullet*, *red*, *tight loop*) over a repeated explanation; repeat the word, not the sentence.
- State the target behavior positively. A prohibition makes the banned behavior more available; keep one only as a hard guardrail, paired with the positive target.

## Pruning

- Keep each meaning in one place. Do not restate what the environment answers cheaply (scripts, config, directory layout, `--help`); record what lookup cannot find: unwritten conventions, reasons, gotchas.
- Delete sentences the model already obeys by default (no-ops) and lines that no longer bear on the task (sediment). Settle disagreement about a no-op by running the document, not by debate.
- Changes to shared instructions follow the harness adoption rule: measure before promotion.

Adapted 2026-10-03 from Matt Pocock [writing-for-agents](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/writing-for-agents/SKILL.md), MIT; condensed and modified to keep existing safety prohibitions and the evaluation-based adoption rule.
