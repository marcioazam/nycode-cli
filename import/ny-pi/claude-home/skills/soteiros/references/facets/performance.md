# Facet: performance

## Targets seen 2026-10-30 (re-resolve)
- Core Web Vitals, good at p75 for all three metrics: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1
  (web.dev/articles/vitals).
- Backend: budgets come from measurement (p95/p99 latency, throughput, memory), never from guesses.

## Checks
- Bounded resources: pagination and limits on queries, bounded queues and caches, connection pools sized,
  request body limits, streaming for large payloads.
- No N+1 queries, no blocking I/O on async hot paths, no synchronous CPU-heavy work on the event loop.
- Indexes back the filters and sorts of hot queries (check the query plan when a database is present).
- Web: no render-blocking assets; images sized with modern formats; animations on `transform`/`opacity` only;
  code-split bundles.
- A claim of slowness or speed needs a measurement (`hyperfine`, profiler, Lighthouse, CrUX). Without one,
  report the signal as a hypothesis, not a finding.

## Severity
- High: unbounded result sets or memory growth on a request path; N+1 on a hot endpoint.
- Medium: missing indexes on measured slow queries; layout-triggering animations.

Depth: `performance-audit`, `web-performance-audit`.
