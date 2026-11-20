---
name: quality-gates
description: "Assess changed-code coverage, mutation resistance and silent failures for release confidence. Use before a consequential completion claim. Not for writing tests (tdd) or detecting test gaming (doces-ou-travessuras)."
---

# Quality gates

Start with changed behavior and risk, then run the cheapest relevant checks. Identify untested branches, tests that would pass under plausible faults, swallowed errors, and unclassified mutation survivors. Report evidence and the smallest next gate; do not fabricate numeric thresholds.

For a complete verification loop, use the repository's own commands in risk order: build, typecheck, lint, focused tests, broader tests/coverage, security/boundary checks, then diff review. A skipped or unavailable phase is `not_verified`, never `pass`; do not infer success from missing `FAIL` text. Preserve command output and exit status in the task receipt, bounded and redacted.

For AI behavior, [agent-systems](../agent-systems/SKILL.md) owns evaluation design; load its [evaluation procedure](../agent-systems/references/evaluation-design.md) when needed. Here verify that the required cases, input identities, executed assertions and regression evidence are complete; do not create a second evaluation methodology or invent thresholds.

Inspect false-success fallbacks, dropped cancellation, swallowed subprocess failures, and assertions disconnected from executed checks. A failed upstream command piped into successful output filtering is still a failure. Once relevant checks pass, repeat or broaden only for changed inputs, failures, or unresolved risk; never skip mandatory gates.

Adapted from HumanLayer `skills@3c2629142c5d437428269b1b722b08c0b87f574d` (`eval-harness` and `verification-loop`), MIT; no upstream files copied.

For consequential completion claims, read [completion evidence](references/completion-evidence.md).

Framework traps, each read 2026-10-24:
- Vitest 4+ counts unimported files only with `coverage.include` (https://v4.vitest.dev/guide/migration), and coverage.py only with `[run] source`, `source_pkgs` or `source_dirs` (pytest-cov `--cov=<pkg>` sets source), counting directories without `__init__.py` only with `[report] include_namespace_packages = true` (https://coverage.readthedocs.io/en/latest/source.html, https://coverage.readthedocs.io/en/latest/config.html, read 2026-10-26); otherwise per-file coverage is `not_verified`.
- cargo-nextest with retries exits 0 on a flaky pass unless `--flaky-result fail` (nextest 0.9.131+); read the FLAKY lines and JUnit `flakyFailure`/`flakyError` (https://nexte.st/docs/features/retries/). Playwright Test likewise exits 0 when retries recover every failure unless `--fail-on-flaky-tests` or `failOnFlakyTests` (1.52+) is set (https://playwright.dev/docs/test-cli, read 2026-11-11).
- Vitest 5 (https://vitest.dev/guide/migration/): `toThrow('')` matches any error; `-t` matches the ` > `-joined full name, so confirm the tests ran; `clearMocks` is on by default; `vi.mock`/`vi.hoisted` work only at top level; browser `toHaveTextContent` is exact; glob coverage thresholds no longer inherit `perFile` (check that each glob sets it before judging per-file coverage); `coverage.include`/`exclude` match project-relative paths and a wildcard-free pattern is a directory, so confirm the reported file set; `json` writes `.vitest/json/output.json` and `junit` writes a file instead of stdout unless `outputFile` or `stdout: true` is set (coverage and reporter items read 2026-10-26).
- pytest fails an XPASS only under strict xfail (`strict=True`, `strict_xfail`/`xfail_strict`, or pytest 9 `strict = true`; https://github.com/pytest-dev/pytest/releases).
- `cargo mutants --in-diff` runs no mutants for a test-only diff (https://mutants.rs/in-diff.html); judge new tests with a full or scoped run.
- Mutation/coverage drivers (check each tool's survivor and per-file threshold semantics; a language with no run is `not_verified`): mutation JS/TS Stryker, Python mutmut or cosmic-ray, Rust cargo-mutants; coverage `jest --coverage`, `c8`, `node --test --experimental-test-coverage`; Go `-coverprofile` is per-package, so derive per-file from the profile.
- Go test timing: [go.md](../engineering-standards/references/go.md).
