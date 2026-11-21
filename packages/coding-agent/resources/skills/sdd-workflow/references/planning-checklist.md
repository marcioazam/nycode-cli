# Planning checklist

Read for multi-step or cross-boundary changes. Start with inspected current behavior and distinguish a bounded implementation, a discovery spike, and a consequential architecture decision. A spike ends with evidence and a recommendation; it need not become a speculative implementation plan.

For each vertical slice, record the behavior, owned files/interfaces, prerequisites, smallest observable check, failure cases, and done criterion. Derive expectations independently of implementation. Name actual paths and project commands; mark unknowns explicitly instead of pretending a placeholder is executable. Test each slice at the highest existing seam (public API or CLI) and add as few new seams as possible; when one is unavoidable, place it as high as it can go and record why. Name an existing test to model the new one on. Seam selection adapted 2026-10-03 from Matt Pocock [to-spec](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/to-spec/SKILL.md), MIT.

Before execution, check that all requested behavior is covered, dependencies are ordered, unrelated cleanup is excluded, and rollback or coexistence is addressed when relevant. Reuse the existing /docs source of truth and checkpoint. Resolve material ambiguity; do not require a separate design approval, automatic commit, visual server, or worker per task when implementation is already authorized.

Adapted from obra/superpowers, revision `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT). The upstream license is kept in [a local copy]($CLAUDE_CONFIG_DIR/docs/third-party/obra-superpowers/LICENSE); this reference replaces the selected techniques, not the upstream orchestration policy.

Use the proportional document shape in [specification lifecycle](specification-lifecycle.md). Understood, bounded work uses one record and a brief acceptance/risk check; file count does not mandate extra artifacts. For critical or materially ambiguous work, review requirement quality and consistency across specification, plan and tasks, whether sections or documents. Before completion, converge affected behavior, checks, evidence and maintained docs. Plan mode keeps artifacts in the conversation until implementation is authorized.

## Consistency gates

- Before implementing: check that every acceptance criterion maps to at least one task and test, every task traces to a criterion, and spec, plan and tasks use the same names and limits.
- After implementing: compare the result with the spec and plan, then list the remaining or diverging work instead of declaring completion. The author does not approve its own requirement checklist; a reviewer or the user does.
