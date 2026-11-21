# Facet: errors and reliability

Walk [paths](../paths.md) for every entrypoint. This facet holds the signals; the path matrix holds the cases.

## Checks
- Every outbound call has a timeout or a propagated deadline: `fetch(..., { signal: AbortSignal.timeout(ms) })`,
  `httpx.Client(timeout=...)`, `context.WithTimeout`, `reqwest` timeouts. A call without one is a finding, even
  when a sibling call has it.
- Retries are bounded, use exponential backoff with jitter, and apply only to transient and idempotent work.
  An idempotency key is reused across attempts of one logical operation.
- Errors are typed and propagated with their cause (`raise ... from`, `%w`, `Error.cause`). No swallowed
  exceptions, no bare `except`/`catch {}` on side effects.
- Cancellation is honored (structured concurrency: `asyncio.TaskGroup`, `errgroup`, `AbortController`), and
  cleanup runs in `finally`/`defer`.
- Exceptional conditions are handled deliberately (OWASP Top 10:2025 A10, Mishandling of Exceptional
  Conditions): fail closed, never in an undefined state.
- Graceful shutdown drains in-flight work. Readiness and liveness probes exist where an orchestrator routes
  traffic or restarts on them (a note when the repository deploys to none). Configuration is validated at
  startup.

## Severity
- High: no timeout on a dependency call; unbounded or immediate retry; a duplicate side effect on retry; a
  swallowed error on a side effect.
- Medium: missing cancellation propagation; no graceful shutdown.

Depth: `reliability-operations`, `reliability-reviewer`, `diagnose`.
