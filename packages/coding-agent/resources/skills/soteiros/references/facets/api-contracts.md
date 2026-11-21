# Facet: API and data contracts

## Editions seen 2026-10-30 (re-resolve)
| Item | Edition | Source |
| --- | --- | --- |
| OpenAPI | 3.2.1 (2026-09-10); 3.2.0 added the QUERY method; Schema Object based on JSON Schema 2020-12 | spec.openapis.org/oas/latest.html |
| HTTP QUERY method | RFC 10008 (Proposed Standard) | rfc-editor.org/info/rfc10008 |
| Problem details | RFC 9457 (obsoletes RFC 7807), media type `application/problem+json` | rfc-editor.org/info/rfc9457 |
| AsyncAPI | 3.x for event contracts | asyncapi.com |

## Checks
- A versioned, machine-readable contract on the current OpenAPI line. Its paths, parameters, responses and
  error responses match the handlers.
- Errors use RFC 9457 problem details with a stable `type`, and never leak internals.
- Inputs are validated at the edge against the contract schema. Unknown fields have a stated policy.
- Pagination is cursor-based for unbounded collections, with limits. Idempotency keys exist for retried POSTs.
- Breaking changes are versioned or deprecated with a `Deprecation`/`Sunset` header, never silent.
- Migrations are additive first (expand, migrate, contract), reversible, and do not lock large tables.

## Severity
- High: an undocumented breaking change; a destructive migration without a backup or reversal path.
- Medium: an outdated contract line (OpenAPI 3.0 while 3.2 is current); ad-hoc error bodies; offset
  pagination on large tables.

Depth: `api-contract-design`, `db-migration-safety`, `contract-migration-reviewer`.
