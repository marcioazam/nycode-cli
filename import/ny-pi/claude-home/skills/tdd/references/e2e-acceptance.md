# E2E acceptance

Use E2E as acceptance evidence for each critical changed flow. Select the smallest representative set that demonstrates the user's outcome and its meaningful failure behavior; cover rule combinations with focused unit, integration and contract tests. Identify the system boundary explicitly: browser journey for a web product, public request/response plus persisted effects for an API, or process invocation/output/exit status plus effects for a CLI. Do not label a mocked component test as full-system E2E.

## Before implementation

Map the acceptance requirement to a journey with concrete setup, action and observable expected results. State which real subsystems participate and which external dependencies are controlled. Plan isolated test data, cleanup limited to owned fixtures, required environment and diagnostic artifacts. Never use production writes, paid-provider calls or personal records without task authority.

Write the failing acceptance test first when the environment can exercise the missing behavior. Verify that the intended assertion fails, then use focused red/green loops to implement the necessary rules and boundaries. An E2E failure caused only by missing infrastructure, imports or syntax is not evidence of the intended regression. Record every required check that cannot run as incomplete verification, while continuing independent work.

## Reliable execution

- Assert what a user or consumer can observe: visible state, outputs, errors, persistence and authorized side effects. Derive expectations independently of the implementation.
- For browser flows, prefer accessible roles/names or stable test IDs and condition-based waits. Avoid positional selectors and fixed sleeps used as synchronization.
- Isolate accounts, storage and records between tests. Tests must run independently and not rely on suite order. Bound timeouts and resource use; clean up only test-owned state.
- Keep relevant production behavior real. Stub only an explicit external boundary; retain separate contract/provider checks where required and report their absence.
- Capture useful diagnostics on failure: trace, screenshot, console/network errors or process output, sanitized before retention. Record command, environment, test identity, revision, expected failure and observed result.
- Retries diagnose transient behavior; a pass after failure is still flaky evidence. Fix the cause or report the unresolved flake rather than increasing retries to satisfy a gate.

## Completion and evidence

Run focused checks first and then required project gates. Confirm critical E2E flows after integration, including relevant rejection, recovery or repeat-action cases. Follow the [working contract]($CLAUDE_CONFIG_DIR/CLAUDE.md) for coverage by risk and preserve stricter repository requirements; E2E breadth and coverage numbers are separate evidence. Ordinary local work does not require a whole-system E2E run. Report local, CI, provider-live and production results separately. Documentation-only changes use contract/link validation with an explicit TDD-not-applicable reason, not invented E2E claims.

Practice adapted from official [Playwright best practices](https://playwright.dev/docs/best-practices), [test isolation](https://playwright.dev/docs/browser-contexts) and [retries](https://playwright.dev/docs/test-retries), reviewed 2026-09-28. These browser recommendations do not require introducing Playwright into non-browser projects. The broader test-layer tradeoff is described in [The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html).
