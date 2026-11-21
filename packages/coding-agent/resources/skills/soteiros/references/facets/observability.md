# Facet: observability

## Editions seen 2026-10-30 (re-resolve)
- OpenTelemetry: the tracing specification is stable with long-term support; logs (Bridge API, SDK,
  protocol) are stable; profiles are still in development, so they are not a target.
- HTTP span semantic conventions: stable. GenAI conventions live in a separate repository; check their
  status before requiring them.
- Sources: opentelemetry.io/docs/specs/status/, opentelemetry.io/docs/specs/semconv/http/http-spans/.

## Checks
- Structured logs (JSON or logfmt) with level, timestamp, message and a correlation or trace ID; no
  `print`/`console.log` debugging in request paths.
- Redaction: no secrets, tokens, `Authorization`/`Cookie` headers or personal data in logs, spans or metric
  labels.
- A service that receives a `traceparent` forwards it on its outgoing calls (W3C Trace Context: "A vendor
  receiving a traceparent request header MUST send it to outgoing requests", w3.org/TR/trace-context/).
  Adding OpenTelemetry to a service that has no tracing is a recommendation, a note. Instrumented code uses
  stable semantic attribute names (`http.request.method`, `http.response.status_code`,
  `url.path`).
- Metrics with bounded cardinality (no user IDs or raw paths as labels): RED for services, USE for resources.
- Every failure path emits a log, metric or span; there is no silent catch.

## Severity
- High: secrets or personal data in logs (also a security finding; report it once, under security).
- Medium: unstructured logs; a received `traceparent` not forwarded; unbounded label cardinality.

Depth: `observability-and-instrumentation`.
