# Facet: supply chain and CI

## Editions seen 2026-10-30 (re-resolve)
| Item | Edition or target | Source |
| --- | --- | --- |
| SLSA | v1.2 (Build L0-L3; Source Track reintroduced) | slsa.dev/spec/ |
| OpenSSF OSPS Baseline | v2026.08.28 (use only the version labeled current) | baseline.openssf.org |
| OpenSSF Scorecard | v5.6.0 | github.com/ossf/scorecard/releases |
| SBOM | CycloneDX 1.7 (ECMA-424) or SPDX 3.0.1 | cyclonedx.org/specification/overview/; spdx.dev |
| NIST SSDF | SP 800-218 v1.1 is final; v1.2 (Rev. 1) is still a draft from 2025-12-17 | csrc.nist.gov |
| GitHub Actions | Workflow dependency lockfiles (GA 2026-10-28) supersede SHA pinning for repositories that adopt them; otherwise pin every third-party action to a full-length commit SHA | docs.github.com/en/actions/reference/security/secure-use; github.blog changelog 2026-10-28 |
| Workflow linter | zizmor 1.31.1 | github.com/zizmorcore/zizmor/releases |

## Checks
- `permissions:` is read-only by default (`contents: read`), raised per job. Never `write-all` or a missing
  top-level block.
- `pull_request_target` or `workflow_run` never checks out or runs PR head code with secrets or a write token
  ("pwn request").
- Third-party actions are covered by an `actions.lock` lockfile or pinned by full SHA. Local actions
  (`./.github/actions/*`) need no pin.
- No untrusted `${{ github.event.* }}` interpolated into `run:` (script injection). Untrusted values go
  through `env:`.
- OIDC (`id-token: write` on the deploy job only) instead of long-lived cloud secrets.
- Lockfile-based installs in CI (`npm ci`), dependency update automation, SBOM generation, build provenance
  or attestations for release artifacts (`actions/attest-build-provenance`, SLSA Build L2/L3).
- Branch protection or rulesets with required checks (record "not verified" when only local files are
  visible).

## Tools
`zizmor .github/workflows` (offline mode is fine); `scorecard --repo=<url>` (needs network and a token);
`osv-scanner`; `mcp__package_version_check__get_github_action_versions_and_args` (via `tool_search`) for action SHAs.

## Severity
- Critical: a `pull_request_target` workflow that runs PR code with secrets or a write token; script injection
  from untrusted event fields.
- High: `write-all` or default write permissions; unpinned third-party actions without a lockfile; long-lived
  cloud keys in secrets where OIDC is available.

Depth: `supply-chain-risk-auditor`, `ci-pipeline-design`.
