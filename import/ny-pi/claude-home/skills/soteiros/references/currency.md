# Currency: finding the stable SOTA target

Resolve every target at audit time and record the source URL and access date. Training data and
memory are never a source. When a vendor page and an aggregator disagree, the vendor page wins.

## Target policy

| Component | Target |
| --- | --- |
| Runtime or OS with an LTS channel (Node.js, Java, .NET, Ubuntu, …) | Newest **active** LTS: LTS status already started (`isLts` true and `ltsFrom` on or before today). A newer non-LTS line is reported as an option. |
| Runtime without LTS (Python, Go, Rust, …) | Newest stable release line that is maintained, on its latest patch. |
| Library, framework, tool | Latest GA on the registry's stable channel, excluding yanked, retracted and deprecated versions. |
| Container base image | Official image for the stable target, minimal variant, pinned by digest; never the `latest` tag. |
| CI action or plugin | Latest stable major, locked by a workflow dependency lockfile where the platform has one (GitHub: GA 2026-10-28), otherwise pinned by full commit SHA. |

Example (accessed 2026-10-08): GitHub `releases/latest` for `nodejs/node` returned `v26.11.1`, while
endoflife.date listed Node 26 with `ltsFrom: 2026-10-28`. "Latest release" is not "active LTS":
the target that day was the newest line with LTS already started.

## Never stable

- SemVer pre-release: any `-` suffix (`-alpha`, `-beta`, `-rc`, `-preview`, `-canary`, `-next`,
  `-insiders`, `-dev`, dated nightlies). Build metadata (`+…`) does not make a version stable.
- PEP 440 pre-release and dev release: `aN`, `bN`, `rcN`/`cN`, `.devN`.
- Go pseudo-versions (`v0.0.0-<timestamp>-<commit>`) and `@master`/branch references.
- Maven qualifiers `SNAPSHOT`, `alpha`, `beta`, `M`, `RC`, `CR`; npm dist-tags other than `latest`.
- Experimental, unstable or preview flags and APIs, even inside a stable release.
- SemVer `0.y.z` is initial development (public API not stable). Accept it only when it is the
  project's only GA line, and record the risk.

## Lookup by ecosystem

First (load with `tool_search`): `mcp__package_version_check__get_latest_package_versions` (npm, PyPI, Go, Docker, Helm, NuGet, Maven/Gradle, crates.io, RubyGems, Packagist, pub.dev, Swift, Terraform providers and modules), `mcp__package_version_check__get_github_action_versions_and_args` for CI actions and `mcp__package_version_check__get_latest_tool_versions` for runtimes and CLIs. It reads the registries below; when a decision depends on one version, confirm it with that registry's command or API and cite the registry URL.

| Ecosystem | Stable target | Command or API |
| --- | --- | --- |
| npm | `latest` dist-tag | `npm view <pkg> dist-tags`, `npm outdated`; `https://registry.npmjs.org/-/package/<pkg>/dist-tags` |
| PyPI | Highest version that is not a pre-release and not yanked | `pip index versions <pkg>` (pre-releases need `--pre`), `uv pip list --outdated`; `https://pypi.org/simple/<pkg>/` with `Accept: application/vnd.pypi.simple.v1+json` (`versions`, per-file `yanked`), filtered with `packaging.version.Version(v).is_prerelease`; the JSON API `releases` key is deprecated |
| crates.io | Highest version that is not a pre-release and not yanked | highest `num` in `https://crates.io/api/v1/crates/<crate>/versions?sort=semver` with `yanked` false and no pre-release suffix (follow `meta.next_page` when the first page has none; `max_stable_version` is deprecated) |
| Go modules | `@latest`: highest release version; a pre-release only when no release exists | `go list -m -u all`, `go list -m -versions <module>`; `https://proxy.golang.org/<module>/@latest` |
| Maven / Gradle | Newest version without a pre-release qualifier | `mvn versions:display-dependency-updates`; Gradle dependency-updates plugin |
| NuGet | Newest stable | `dotnet list package --outdated` |
| GitHub releases | `releases/latest`: most recent non-prerelease, non-draft release by `created_at`; not necessarily LTS | `gh api repos/<owner>/<repo>/releases/latest` |
| Lifecycle of runtimes, OSes, databases, frameworks | `isLts`, `ltsFrom`, `isMaintained`, `isEol`, `eolFrom`, `latest` | `https://endoflife.date/api/v1/products/<product>`; confirm on the vendor page |

## Deprecations, abandonment and advisories

- Deprecated APIs: read the official changelog, migration guide or deprecation list of the target
  version (documentation tool or official docs) and run the language's deprecation warnings as errors
  (`python -W error::DeprecationWarning`, `node --throw-deprecation`, compiler warnings).
- Abandonment: registry deprecation flag (npm `deprecated`, PyPI yanked, Go `// Deprecated:` in
  `go.mod`, retracted versions), archived repository, or no maintained release while advisories stay
  open. Name the maintained replacement and its stable version.
- Advisories: OSV (`https://api.osv.dev/v1/query`), GitHub advisories, `npm audit`, `pip-audit`,
  `cargo audit`, `govulncheck`. Supply-chain depth: `supply-chain-risk-auditor`.

## Upgrade constraints

Target the newest stable version compatible with the repository's version policy, supported platforms,
peer dependencies and deploy runtime. When an upgrade is blocked, report the blocker and the newest
stable version that is reachable now.

## Sources (accessed 2026-10-08)

- SemVer 2.0.0: https://semver.org/
- Python version specifiers (PEP 440): https://packaging.python.org/en/latest/specifications/version-specifiers/
- Go modules reference, version queries: https://go.dev/ref/mod
- GitHub REST, get the latest release: https://docs.github.com/en/rest/releases/releases#get-the-latest-release
- PyPI JSON API: https://docs.pypi.org/api/json/
- endoflife.date API v1: https://endoflife.date/docs/api/v1/
