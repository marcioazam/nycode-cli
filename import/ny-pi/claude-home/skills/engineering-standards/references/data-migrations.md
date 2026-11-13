# Data migrations

Treat schema and data migrations as production changes. Plan the rollout, compatibility window, rollback or forward-recovery path, locking impact, backfill size, observability, and verification before writing it.

Prefer expand/contract: add compatible schema and code first, backfill safely, switch reads and writes, verify, then remove old paths in a later release. Make migrations idempotent where the tooling permits it. Avoid long locks and unbounded transactions on live tables; test against realistic volume or document the operational limit.

Review both the upgrade and recovery path. Never execute a destructive migration, backfill, or production data command without explicit authorization.

Current specifics: PostgreSQL lock levels, `NOT VALID` constraints and version checks are held once in [db-migration-safety](../../db-migration-safety/SKILL.md).
