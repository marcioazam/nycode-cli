# Path matrix

Walk every row for each entrypoint (API route, job, CLI command, event handler, UI action). A row is
handled only when a test or an executed check covers it; otherwise mark it "not verified" in the
report. Absence of a failure in a happy-path run is not evidence.

| Path | Cases to enumerate | SOTA handling |
| --- | --- | --- |
| Input | Empty, null, wrong type, oversize, malformed encoding, Unicode normalization, injection payloads, duplicates, out-of-order events | Schema validation at the trust boundary; size limits; reject with a typed error; never trust client-side checks |
| Dependency calls (network, database, files, queues) | Success, slow, timeout, refused, 4xx, 5xx, rate-limited, partial or malformed response, dependency down for minutes | Timeout or propagated deadline on every call; bounded retry with exponential backoff and jitter for transient, idempotent work only; circuit breaker or load shedding for hot dependencies; explicit error mapping |
| Concurrency | Races, double submit, lost update, deadlock, cancellation mid-operation, duplicate delivery | Idempotency keys; transactions or optimistic locking; structured concurrency; cleanup on cancellation; idempotent consumers |
| Resources | Memory growth, file handles, connections, queue depth, disk, CPU starvation | Limits and pools; backpressure; context managers or `finally`; bounded caches |
| Time | Time zones, DST, leap seconds, clock skew, durations | Timezone-aware UTC timestamps; monotonic clock for durations and deadlines |
| State and data | Partial writes, crash between steps, replayed side effects, migration midway | Transactions or outbox; at-least-once delivery with idempotent handlers; reversible migrations |
| Security | Missing or expired credentials, cross-tenant access, privilege escalation, secrets in errors or logs | Deny by default; per-request authorization; scoped, short-lived credentials; redaction |
| Operations | Start without configuration, shutdown with work in flight, partial deploy, rollback | Fail fast on invalid configuration; graceful shutdown; readiness and liveness signals; rollback plan |
| Observability | Every failure row above | Each failure emits a log, metric or span with a correlation ID; no silent path |

## Output

For each entrypoint list the rows as handled (with the covering test or check), gap (finding) or not
verified. Unverified rows count as residual risk, never as handled.
