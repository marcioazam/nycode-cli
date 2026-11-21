# Companion tools (pi)

Moved out of `SKILL.md` on 2026-11-07 to keep the skill small (`security-reviewer` preloads it through its `skills:`
frontmatter).

The Claude Code plugins this file used to name (Trail of Bits `variant-analysis`, `sharp-edges`, `static-analysis`,
plus `semgrep-guardian` and `claude-security`) do not exist in pi; the `offensive-*` skills (claude-red collection) are installed but are offensive tooling,
outside this procedure. This skill stays defensive; the steps below replace the plugins with local
tools. Check availability first: `which semgrep gitleaks trivy cargo-audit codeql` (2026-11 on this host: semgrep
1.172.0, gitleaks 8.30.1, trivy 0.74.0 and cargo-audit installed; `codeql` not installed). A missing tool is a
coverage limit to report, never a reason to install one without authorization.

## Variant analysis (after a confirmed root cause)

1. State the root cause as a pattern: the sink, the missing or wrong control, and the input shape.
2. Lexical sweep: `rg -n` for the sink and its wrappers, aliases and sibling entry points (batch, legacy, retry,
   migration, error paths).
3. Structural sweep: when the repository has `.codegraph`, load `mcp__codegraph__*` with `tool_search`, run
   `codegraph_status`, then callers/impact of the vulnerable function; confirm negative claims with `rg`.
4. Semantic sweep with Semgrep, offline: write a rule for the pattern to a scratch file (for example
   `/tmp/<run>/variant.yaml`, with `pattern`/`pattern-not-inside` or taint `pattern-sources`/`pattern-sinks`) and run
   `semgrep scan --metrics=off --disable-version-check --config /tmp/<run>/variant.yaml <paths>`. Never use
   `--config auto` (it contacts the registry and sends metrics) or `semgrep login`/`semgrep ci`; registry packs
   (`--config p/<pack>`) download rules over the network and need network authorization (no code is uploaded).
5. Establish each variant's own conditions and impact; a lexical match alone is not a finding. Same root cause:
   one finding listing every place; independent missing controls: separate findings.
6. Large target: the parent may fan the sweep out by subsystem or attack class with one
   `subagent {tasks: [...]}` call (at most 8 tasks, 4 running at once; `security-reviewer` for read-only review,
   `general-purpose` only when a sandboxed local check is needed). Each task gets the root-cause statement, its owned
   paths and the candidate gate; children cannot delegate further.

## Sharp edges (API, configuration and crypto ergonomics)

Without the `sharp-edges` plugin, check directly: dangerous or permissive defaults, silent fallbacks (fail-open on
error, missing key treated as allowed), stringly-typed security options (algorithm or mode names, `"none"`),
footgun parameters (`verify=False`, disabled TLS checks, wildcard origins), nonce/IV reuse paths, constant-time
comparison of secrets, and confusing pairs of similar APIs where one is unsafe. Report one only with a concrete
misuse path and an affected principal; otherwise it is a hardening note.

## Other local scanners (offline use)

- Secrets: `gitleaks dir <path> --redact --no-banner -f json -r -` (or `gitleaks git <repo>` for history). Never
  print or copy secret values into reports.
- Dependencies, misconfiguration and secrets: `trivy fs --skip-db-update --offline-scan --scanners
  vuln,misconfig,secret <path>` uses the cached DB; a DB update contacts the network and needs authorization. A stale
  DB result is not current-advisory evidence (route dependency trust to `supply-chain-risk-auditor`).
- Rust advisories: `cargo audit --no-fetch --stale` reads the local advisory DB only; say how old it is.
- A clean scanner run never certifies safety; keep scanner output separate from source-traced findings.

## CodeQL licence limit

The CLI terms (github/codeql-cli-binaries `LICENSE.md`, read 2026-11-04) allow it only on codebases under an
OSI-approved licence, for academic research, or under a paid GitHub Advanced Security or Code Security licence; they
forbid databases built for CI or automated analysis otherwise. Do not run `codeql database create` on private or
unlicensed code. `codeql` is not installed here; use the Semgrep path above.
