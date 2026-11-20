# Facet: tests and gates

## Checks
- Behavior tests cover the failure paths of [paths](../paths.md): invalid input, dependency timeout or error,
  authorization denied, and concurrency where it applies. Happy-path-only suites are a gap.
- Tests are hermetic: they need no live server, network or shared database. They use in-process apps, fakes
  at the boundary, or containers started by the test. They are deterministic: no sleeps, no
  wall-clock or order dependence.
- Property-based tests cover parsers, codecs and invariants (Hypothesis, fast-check, proptest, testing/quick).
- Coverage is measured per file, with the repository's threshold enforced in CI. Mutation testing (mutmut,
  Stryker, cargo-mutants) is used on critical logic where available.
- CI runs lint, type check, tests and security scans on every change, as required checks. No skipped or
  quarantined tests without an owner and an expiry.
- The test runner is current: Node's built-in `node:test`, `pytest` 8+, `go test`, `cargo nextest`.

## Severity
- High: no tests on a critical flow; tests that depend on a running server or a shared live database, so CI
  cannot run them; assertions weakened to pass.
- Medium: happy path only; flaky tests retried rather than fixed; coverage not measured.

Depth: `quality-gates`, `tdd`, `property-based-testing`, `test-reviewer`.
