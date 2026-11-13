# GPT-6 Astra in this harness

The official model ID is `gpt-6-astra`. Read effective configuration before making
model claims: the 2026-09-28 audit found `gpt-6-luna` in the base configuration and
`gpt-6-astra` in the separate 9router profile. The user chose to preserve these
models. Historical `cx/gpt-6-astra` aliases are not current-state evidence or proof
of upstream identity. Preserve routing, authentication and existing worker models
unless a scoped migration authorizes their change.

## Compatibility before tuning

Verify the actual provider's model resolution, Responses tool-call IDs, structured errors, streaming completion, cancellation, and usage semantics. Use synthetic inputs and an explicitly approved budget for live trials. Installation and configuration checks do not establish provider behavior.

Official Astra guidance requires Responses for tool calling. Preserve supported effective reasoning effort in the initial comparison; map `none`/`minimal` to `low` only when migrating such a configuration. The harness policy now respects the user's selected model and checks configuration separately from runtime availability. This Astra-specific reference applies only when Astra is actually selected; it does not authorize changing the session model.

Do not forward unsupported `temperature`, `top_p`, or `top_logprobs`. Check the documented logprob restrictions at the API boundary. Do not change paid service tier just because a task needs a quicker response.

Async tools, mid-turn steering, and cache-preserving configuration updates are optional API capabilities, not proof of support in this Codex/provider combination. Use native support when verified; do not add an emulator or daemon.

## Behavior

- Complete authorized work; ask only questions that materially change the outcome. A planning request remains planning, and explicit approval boundaries remain binding.
- Audit skills for conflicting instructions and unintended stop conditions. If guidance unexpectedly stops progress, identify the specific instruction and distinguish it from an interpretation.
- Use outcome-first, concise responses in the user's language. Add structure only when it helps a decision.
- Keep direct execution for localized work. Delegate substantial independent tasks under the existing owner, budget, permission, and three-worker limits; do not adopt blanket delegation.
- Run the narrowest meaningful checks and all mandatory gates. Repeat or broaden only after a relevant change, failure, or unresolved risk. Preserve coverage thresholds.
- Keep invariant rules and a stable prompt prefix; load domain/model detail conditionally instead of adding every recommendation to `AGENTS.md`.

## Evaluation

Compare current behavior before changing prompts, tools, effort, or worker models. Change one variable per comparison. Measure verified completion, authority violations, retries, cost per successful task, and elapsed time; TPS alone cannot establish quality.

Sources checked 2026-09-08: [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra), [official migration and prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra), and [Codex skills](https://developers.openai.com/codex/skills). Recheck version-sensitive claims before migration.
