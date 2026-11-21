# Facet rubrics

One file per facet, loaded on demand. Each file names the current stable editions, verified on
2026-10-30 with their sources. Re-resolve them at audit time: the editions are a starting point, never a
substitute for a lookup. Each file also lists the concrete checks, the tools to run, the anti-signals and
the owning skill for depth.

An auditor assigned one facet reads only that file plus [currency](../currency.md). Without an assignment,
it walks [rubric](../rubric.md) and opens a facet file when that dimension needs depth. A FINDING still needs
a sourced stable target; a design preference is a note.

| Facet | File |
| --- | --- |
| Runtime and dependencies | [runtime-deps](runtime-deps.md) |
| Security | [security](security.md) |
| Supply chain and CI | [supply-chain-ci](supply-chain-ci.md) |
| Container | [container](container.md) |
| API and data contracts | [api-contracts](api-contracts.md) |
| Errors and reliability | [reliability](reliability.md) |
| Observability | [observability](observability.md) |
| Tests and gates | [tests](tests.md) |
| Performance | [performance](performance.md) |
| UI and accessibility | [ui-a11y](ui-a11y.md) |
| Architecture and code | [architecture-code](architecture-code.md) |
