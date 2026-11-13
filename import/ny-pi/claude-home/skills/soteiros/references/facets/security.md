# Facet: security

## Editions seen 2026-10-30 (re-resolve)
| Standard | Edition | Source |
| --- | --- | --- |
| OWASP Top 10 | 2025 (A01 Broken Access Control … A03 Software Supply Chain Failures, new; A10 Mishandling of Exceptional Conditions, new) | owasp.org/Top10/2025/ |
| OWASP ASVS | 5.0.0 (2025-05-30), the verification checklist by level | owasp.org/www-project-application-security-verification-standard/ |
| OWASP Top 10 for Agentic Applications | 2026 edition (2025-12-09), for code that runs LLM agents or tools | genai.owasp.org |
| CWE Top 25 | 2025, plus the 2025 KEV weaknesses list | cwe.mitre.org/top25/ |

## Checks (cite the ASVS 5.0 requirement or the Top 10:2025 category per finding)
- Trust boundaries: validation by schema at every external input (body, query, headers, files, messages).
  Length and size limits. OWASP API4:2023 (Unrestricted Resource Consumption) is a finding when a limit it
  lists is missing (execution timeouts, memory, file descriptors, processes, upload size, operations per
  request, records per page, third-party spending); rate limiting sits in its "How To Prevent" list, so its
  absence alone is a note.
- Injection: SQL, NoSQL and LDAP built by concatenation or template strings; shell with interpolated input;
  path traversal; SSRF on user-supplied URLs; template injection; unsafe deserialization.
- Access control: authorization on every route and handler (deny by default); object-level ownership checks
  (IDOR); tenant isolation.
- Secrets: none in code, images, CI logs or application logs. Headers such as `Authorization` and `Cookie` are
  redacted before logging.
- Transport and browser: no disabled TLS verification. CORS never pairs `*` or a reflected origin with
  credentials. Cookies are `Secure`, `HttpOnly` and `SameSite`. A CSP exists where HTML is served.
- Errors: no stack traces, SQL or internal messages in responses (Top 10:2025 A10). Problem details without
  internals.
- Crypto: modern algorithms only (no MD5/SHA-1 for security, no ECB). Passwords hashed with Argon2id, scrypt
  or bcrypt. Tokens verified with a pinned algorithm.
- Agentic code: tool inputs are validated; model output is never executed or used as a query without checks;
  least-privilege tools.

## Tools
`semgrep scan --config p/default` (1.183.0); `gitleaks`/`trufflehog` for
secrets; language linters' security rules (`bandit`, `eslint-plugin-security`, `gosec`).

## Severity
- Critical: exploitable injection, auth bypass, secret exposure, credentialed CORS wildcard.
- High: stack traces or internals in responses; missing authorization on a non-public route; disabled TLS
  verification.

Depth: `security-audit`, `security-reviewer` agent (exploit paths). The `offensive-*` skills do not exist in pi
(not ported); an authorized offensive test is out of this skill's scope.
