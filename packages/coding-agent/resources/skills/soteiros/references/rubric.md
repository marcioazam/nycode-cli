# SOTA rubric

Score each dimension as SOTA, gap or not assessed. Signals are evidence to look for, not a checklist
to fill: a dimension is SOTA only when its signals are observed in code, configuration or executed
checks. Standards are named without versions on purpose; resolve their current version at audit time.
For depth, load the owning skill instead of re-deriving its procedure here. Each dimension has a facet
file with the editions verified on its review date, concrete checks and tools: [facets](facets/README.md).

| Dimension | SOTA signals | Anti-signals | Owner for depth |
| --- | --- | --- | --- |
| Runtime and dependencies | Stable target per [currency](currency.md); committed lockfile; reproducible install; few, maintained dependencies | End-of-life runtime; pre-release pins; floating ranges without a lock; abandoned or duplicate libraries | `supply-chain-risk-auditor`, `evidence-research` |
| Architecture | One responsibility per module; dependency direction toward the domain; explicit state ownership; recorded decisions | Cycles; god modules; speculative layers; shared mutable state across boundaries | `architecture-decision` |
| Language and idioms | Current language features and standard library; strict typing; formatter and linter enforced; no deprecated APIs | Deprecated calls; untyped public surface; hand-rolled code the standard library covers | `engineering-standards` |
| Errors and failure paths | Every I/O has a timeout or deadline; retries bounded, with backoff and jitter, only for transient and idempotent work; errors typed and propagated; cancellation honored; idempotency keys for side effects | Swallowed exceptions; endless or immediate retries; missing timeouts; errors returned as null; cleanup skipped on failure | `reliability-operations`, `diagnose` |
| Security | Input validated at trust boundaries; authorization on every request; secrets outside code; least privilege; parameterized queries; current OWASP guidance | Injection; secrets in repository or logs; broad CORS or tokens; disabled TLS verification | `security-audit` |
| Data and contracts | Versioned API contract; compatible, reversible migrations; schema validation at the edge | Breaking change without versioning; destructive migration; unvalidated payloads | `api-contract-design`, `db-migration-safety` |
| Performance | Budgets from measurement; bounded memory, queues and concurrency; streaming for large payloads; no N+1 | Unbounded collections; blocking I/O on hot paths; optimization without measurement | `performance-audit`, `web-performance-audit` |
| Observability | Structured logs; OpenTelemetry traces and metrics; correlation IDs; bounded cardinality; no secrets or PII in telemetry | Print debugging; unstructured logs; silent failure paths | `observability-and-instrumentation` |
| Tests and gates | Behavior tests including failure paths; property-based tests for parsers and invariants; CI gates on every change; no flaky or skipped tests | Happy-path only; mocks hiding behavior; weakened assertions | `quality-gates`, `tdd`, `property-based-testing` |
| Delivery and supply chain | CI on every change; a workflow dependency lockfile or actions pinned by full SHA; least-privilege `GITHUB_TOKEN`; SBOM and build provenance (SLSA); automated dependency updates; minimal non-root images pinned by digest | `latest` tags; manual deploys; root containers; unpinned third-party actions | `supply-chain-risk-auditor` |
| Web UI (when present) | Current WCAG conformance; good Core Web Vitals; modern CSS; reduced-motion support | Non-semantic controls; layout-property animation; render-blocking assets | `web-ui-craft`, `accessibility-audit`, `design-review` |
| Documentation | Runnable README; decisions recorded; comments state invariants and risks | Stale docs; comments that restate code | `engineering-standards` |

## Severity

- Critical: exploitable security gap, data loss or corruption path, end-of-life runtime facing the
  internet, unbounded failure path that can take the service down.
- High: missing timeout or unbounded retry on a dependency, swallowed errors on a side effect,
  pre-release in production, deprecated API scheduled for removal in the target version.
- Medium: deprecated idiom with a stable replacement, missing failure-path tests, weak observability.
- Low: style or documentation gaps with no runtime effect.
