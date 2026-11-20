---
name: engineering-standards
description: "Read before writing, changing, testing or reviewing code (Go, Python/FastAPI, TypeScript, React, Rust, Dart, Shell), CI, docs, migrations or containers: core standards and stack rules. Not for chat or lookups."
---

# Engineering standards

Apply only the references needed for the current task. Do not load the whole collection, and do not override a user's request, repository `AGENTS.md`/`CLAUDE.md` (pi loads both as context files), manifests, CI, or an explicit architecture decision.

## Always for substantial engineering work

Read [core engineering](references/core-engineering.md). Then select only the relevant additions:

| Situation | Read |
| --- | --- |
| Feature, cross-boundary change, or uncertain approach | [planning and specs](references/planning-and-specs.md) |
| Behavior change, bug fix, tests, coverage, quality gates | [testing and quality](references/testing-and-quality.md) |
| Auth, input handling, secrets, dependencies, plugins, or hostile input | [security](references/security.md) |
| CI workflow, action, dependency bot, or release pipeline | [CI supply chain](references/ci-supply-chain.md) |
| PR, review, push, merge, release, or publish | [delivery and review](references/delivery-and-review.md) |
| README, ADR, design document, changelog, or AGENTS.md | [documentation](references/documentation.md) |
| Dockerfile, compose file, image, or container runtime | [containers](references/containers.md) |
| SQL, database schema, backfill, or migration | [data migrations](references/data-migrations.md) |
| Go | [Go](references/go.md) |
| Python | [Python](references/python.md) |
| TypeScript | [TypeScript](references/typescript.md) |
| React or Next.js | [React and Next.js](references/react-next.md) |
| Rust | [Rust](references/rust.md) |
| Shell scripts or hooks | [Shell](references/shell.md) |
| Durable CLI commands, machine-readable output, or installable tools | [CLI contracts](references/cli.md) |
| API contract, webhook, or public integration | [API and webhooks](references/api-and-webhooks.md) |
| Terraform, Kubernetes, cloud, or infrastructure-as-code | [Cloud and IaC](references/cloud-and-iac.md) |
| Data pipeline, warehouse, stream, ML platform, or model serving | [Data and ML platforms](references/data-and-ml-platforms.md) |
| Flutter or Dart | [Flutter](references/flutter.md) |

Use the shared quality-gate registry at `~/source/blueprint/base-software-rules/standard/GATES.md` when it exists. Cite gate IDs rather than copying its numeric values. The [working contract]($CLAUDE_CONFIG_DIR/CLAUDE.md) owns structure limits and validation by risk (loaded in every pi session): focused checks for ordinary work, required coverage/TDD/E2E for critical changed flows, and no universal research quota. Preserve stricter project gates. If the registry is unavailable, follow that contract and project CI without inventing additional thresholds.
