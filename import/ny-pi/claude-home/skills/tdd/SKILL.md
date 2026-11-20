---
name: tdd
description: Required for bug fixes and critical executable flows, or when the repository requires TDD. Use voluntarily for other behavior changes; implement test-first with red, green and refactor evidence.
---

# Test-driven development

The [working contract]($CLAUDE_CONFIG_DIR/CLAUDE.md) owns when this procedure is required.
For ordinary behavior changes, focused acceptance tests are sufficient unless
repository policy requires test-first. Do not mandate TDD solely because a
file is executable; identify the risk and preserve stronger project rules.

State the behavior and boundary under test, then add the smallest failing test that demonstrates it. Confirm it fails for the intended reason, implement only enough code to pass, and refactor only while the suite remains green.

First identify acceptance cases, relevant architecture boundaries and failure cases; do not let the first test silently define the whole design. Record command, test identity, content revision, result and failure reason before and after the change. A missing runtime, syntax error or failed import alone does not demonstrate the intended regression. For a bug fix, the reproduction test is the acceptance filter: a candidate fix counts only when that test goes from failing to passing. A regression test written after the fix proves itself only if it fails with the fix hunk reverted (revert only the fix, run, restore, run). Tests that already pass establish existing behavior, not the red step for new behavior.

For behavior-preserving refactors, run existing or characterization tests before and after. For documentation or configuration without executable behavior, record why TDD is not applicable and run relevant validation. If a mandatory test cannot run, report incomplete verification and the concrete blocker. Never reconstruct a red result after implementation and claim it happened first.

Cover observable behavior, negative paths, and regression boundaries rather than private implementation details. Follow project test conventions and stop when requested behavior and relevant edge cases are verified; do not widen scope into unrelated cleanup.

Make changed critical flows observable through an E2E acceptance test over the public UI, API or CLI. Plan success and meaningful failure scenarios before implementation; use focused tests for detailed rules. Follow the working contract's risk-based coverage and stricter project gates without mistaking coverage for assertion quality. Read [E2E acceptance](references/e2e-acceptance.md) when selecting or executing these flows.

For assertions, mocks or regression-test design, read [test design](references/test-design.md).

Current specifics: framework traps that change what a test proves (unimported-file coverage, retried flakes, Vitest 5 matchers, strict xfail) are in [quality-gates](../quality-gates/SKILL.md).
