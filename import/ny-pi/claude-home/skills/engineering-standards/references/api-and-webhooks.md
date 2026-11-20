# API contracts and webhooks

Use [api-contract-design](../../api-contract-design/SKILL.md) for public API
compatibility and [webhook-integration](../../webhook-integration/SKILL.md) for
signatures, redelivery, acknowledgment and idempotent effects. Public optionality,
defaults, errors and consumer behavior are contracts, not implementation details.

For database evolution use [db-migration-safety](../../db-migration-safety/SKILL.md).
Map old/new consumers and coexistence before changing an interface; migration
acceptance belongs at that boundary. Never log secret headers or sensitive bodies.

Current specifics: problem-details error bodies follow RFC 9457, which obsoletes RFC 7807 (https://www.rfc-editor.org/rfc/rfc9457.html, read 2026-10-24); deprecation signals follow [api-contract-design](../../api-contract-design/SKILL.md).
