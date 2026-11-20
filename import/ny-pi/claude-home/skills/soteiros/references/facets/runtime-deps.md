# Facet: runtime and dependencies

Policy: [currency](../currency.md). Resolve every target with a tool (`mcp__package_version_check__*` via `tool_search`, the lifecycle JSON
listed there). Never resolve one from memory: models pick versions with known CVEs in 36.7-55.7% of tasks,
and an instruction does not fix that; anchoring to a source does (arXiv 2605.06279, 2026).

## Targets seen 2026-10-30 (re-resolve)
| Runtime | Target | Source |
| --- | --- | --- |
| Node.js | 26 Active LTS since 2026-10-28 (v26.13.0); 24 Maintenance; 22 Maintenance until 2027-04-30 | github.com/nodejs/Release schedule.json; nodejs.org/dist/index.json |
| Python | 3.15 (3.15.2); 3.10 end of life 2026-10-01 | python.org downloads API; peps.python.org/api/release-cycle.json |
| Java | 25 LTS; 27 is GA but not LTS (option) | oracle.com java-se-support-roadmap |
| .NET | 10 LTS (10.0.14); 11 is a release candidate (not a target) | dotnetcli release-metadata releases-index.json |
| Go | 1.27.3 | go.dev/doc/devel/release |
| Rust | 1.99.1, edition 2024 | blog.rust-lang.org; static.rust-lang.org channel-rust-stable.toml |
| TypeScript | 7.0.2 (native compiler, GA 2026-07-08); `@typescript/typescript6` only for tools that still need the 6.x API | registry.npmjs.org/typescript; devblogs.microsoft.com/typescript |

## Checks
- Every declared runtime floor: `engines`, `requires-python`, `go` directive, `rust-version`,
  `<TargetFramework>`, Docker `FROM`, CI `node-version`/`python-version` matrix, `.nvmrc`, `.tool-versions`.
  Report each place that pins a version below the target, once per defect, with `alt` locations.
- A committed lockfile (`package-lock.json`, `pnpm-lock.yaml`, `uv.lock`, `poetry.lock`, `Cargo.lock`,
  `go.sum`), and installs that use it (`npm ci`, `uv sync --locked`, `cargo --locked`).
- Pre-release pins and floating ranges without a lockfile.
- Deprecated or abandoned packages: npm `deprecated` field (`npm view <pkg> deprecated`), PyPI yanked, archived
  repository. Name the maintained replacement.
- Advisories: `osv-scanner scan source -r .` (2.7.0), `npm audit --omit=dev`, `pip-audit`, `cargo audit`,
  `govulncheck ./...`.

## Anti-signals and severity
- Critical: an end-of-life runtime facing the internet; a dependency with an exploitable advisory on a
  reachable path.
- High: a pre-release in production; a deprecated package with known advisories; no lockfile for a deployed app.
- Medium: a supported but non-target LTS (for example Node 22 or 24 while 26 is Active LTS); a major version
  behind on a direct dependency.

Depth: `supply-chain-risk-auditor`, `evidence-research`.
