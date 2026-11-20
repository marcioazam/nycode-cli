# Documentation

Documentation describes current behavior and decisions, not aspirations. Update public docs, changelogs, examples, or ADRs when a user-visible contract or durable architectural decision changes.

Keep one source of truth for each contract. An `AGENTS.md` should state local instructions and pointers, not duplicate a repository manual. Use concise prose, explicit scope, and real commands or examples that have been verified. Remove or mark superseded material instead of leaving contradictory guidance.

For consequential handoffs, check the document against the intended reader's
questions using only the material that reader will receive. Flag unexplained
terms, missing prerequisites and conclusions relying on hidden conversation
context. A self-review is not independent reader evidence; use a fresh reviewer
only when proportionate and authorized. Verify linked commands and current
implementation before stating that a procedure works.

Keep maintained project documentation under the project `/docs` directory. For non-trivial changes, use [the specification lifecycle](../../sdd-workflow/references/specification-lifecycle.md) to define acceptance before code and link requirements to tasks, tests and evidence. Reuse existing sources; create the missing minimum rather than a second manual. Update interface examples, configuration, failure behavior and operations with the implementation, validating links and commands. Clearly label proposed versus verified behavior.

The Obsidian vault is a learning and retrieval layer: link to project contracts instead of copying competing specifications. Follow `obsidian-cli` for verified milestone/conclusion capture, privacy and conflict handling. Plan mode and read-only scope permit consultation but no document or vault writes.

Current specifics: ADRs are an append-only log. Use the repository's ADR format, else MADR 4.0.0 ([release](https://github.com/adr/madr/releases/tag/4.0.0), the latest on 2026-10-24): `docs/decisions/NNNN-title-with-dashes.md`, fitness checks under Confirmation. Never rewrite, merge or delete an accepted or rejected ADR; write a superseding ADR, link the two both ways and change only the old record's status to `superseded by ADR-NNNN` ([Azure Well-Architected ADR guidance](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record), read 2026-10-24).
