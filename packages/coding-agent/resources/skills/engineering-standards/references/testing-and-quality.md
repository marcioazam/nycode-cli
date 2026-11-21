# Testing and quality

The [working contract]($CLAUDE_CONFIG_DIR/CLAUDE.md) owns validation by risk, including when TDD, E2E and coverage are required.
Use [tdd](../../tdd/SKILL.md) for the red/green/refactor procedure and
[quality-gates](../../quality-gates/SKILL.md) to assess changed-code confidence.
Refactors require before/after tests; non-executable documentation requires
contract validation and an explicit TDD-not-applicable reason.
For ordinary behavior changes, verify acceptance with focused tests; do not
force test-first or a per-file coverage floor unless the repository requires it.

Map acceptance to observable behavior, failure cases and affected consumers.
Run focused checks and then required project gates; do not repeat unchanged
suites without new evidence. Use [property-based-testing](../../property-based-testing/SKILL.md)
when an input domain has checkable invariants. Coverage does not establish
assertion strength; missing commands/results remain unverified.

Reuse a successful result only when relevant source, tests, dependencies,
command and environment inputs are unchanged. Record its original result,
input identity and covered scope; unknown input state means run it again.
Never reuse failures or treat a partial check as full validation. Invalidate
affected checks after changed inputs or contradictory evidence, and run any
repository gate that explicitly requires a fresh result. Prefer one task
evidence record over repeated status receipts; cached results are labeled.

Use the shared GATES.md registry when available, preserving stricter project
requirements. Public-flow acceptance follows the
[E2E contract](../../tdd/references/e2e-acceptance.md).

Current specifics: test-framework traps (unimported-file coverage, nextest flaky results, Vitest 5 matchers, strict xfail) are held once in [quality-gates](../../quality-gates/SKILL.md).
