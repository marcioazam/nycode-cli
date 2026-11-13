---
name: code-simplification
description: "Simplify existing code preserving behavior, errors, side effects and ordering. Use for a scoped readability refactor. Not for features, zero-legado, dependency migration or pr-review."
---

# Code simplification

Make a bounded change easier to understand while preserving observable behavior.
The user's request and the repository's own instructions (`AGENTS.md`/`CLAUDE.md`
at its root) own scope, structural limits, authorization and risk-based validation; this skill adds no universal suite-per-edit or PR count.
Use existing conventions and the smallest coherent design. Avoid unrelated
cleanup or changing working code solely to reduce its line count.

Before editing, identify (codegraph via `tool_search`, `rg` and `lsp_references`) callers, inputs/outputs, errors, side effects, ordering,
resource lifetime and tests that characterize the behavior. If equivalence is
unclear, resolve that gap before refactoring. A bug fix or critical behavior
change uses [tdd](../tdd/SKILL.md) when required; a behavior-preserving refactor
runs existing or necessary characterization tests before and after.

Choose changes from concrete evidence: duplicated domain rules, unnecessary
wrappers, misleading names, nested conditions or mixed responsibilities.
Centralize repeated rules with their domain owner. Preserve meaningful types and
helpers; do not introduce speculative abstractions or hide failed error paths.
Use automation when repetition and risk justify it, without a separate line
threshold. Load [examples](references/examples.md) only for a relevant pattern.

Group coherent changes into reviewable steps. Run affected behavior and consumer
checks, then required repository gates at completion; reuse successful checks
while relevant inputs remain unchanged. Broaden for failures or unresolved risk.
If a transformation changes behavior, correct or undo only your own change.
Separate unrelated features when that improves review, not by an automatic
requirement for multiple PRs. Delivery still requires task authorization.

Report what became clearer, preserved behavior, executed checks and gaps. A
simplification does not justify weakened tests or removed validation.

Inspired by the [Claude Code Simplifier plugin](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md);
local model-independent adaptation. Examples from the previous entrypoint are
retained conditionally; backup and content hashes preserve its provenance.
