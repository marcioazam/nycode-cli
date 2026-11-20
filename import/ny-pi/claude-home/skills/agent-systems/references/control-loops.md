# Control-loop design for agent workflows

Use this model only for repeatable work that drives a repository property toward a target. It is not a reason to add a daemon, schedule, CI workflow, or autonomous agent.

- **Set point:** desired invariant, threshold, or directional improvement, with explicit read/write scope.
- **Sensor:** repeatable measurement from existing tests, lint, AST/search, telemetry, or bounded inspection. Record when unavailable, stale, or inconclusive.
- **Controller:** choose the smallest next target and reviewable change. Start deterministic; use an agent only for judgment tools cannot provide. Cap files, findings, retries, and total work.
- **Actuator:** existing agent plus the smallest applicable skill. It may only use tools, paths, network, and external effects authorized by the parent task.
- **Disturbances:** concurrent edits, dependencies, generated files, flaky checks, and provider changes. Re-read state before applying a change.

Run each component locally and independently before wiring automation. Keep one open unit of reviewable work per loop unless explicitly changed. Require a regression check so incremental improvement cannot worsen the measured property.

Durable feedback stores stable reviewer guidance and known false positives, never secrets, raw prompts, unbounded logs, or one-off outcomes. Human feedback can propose a rule change; it cannot silently rewrite normative instructions.

Before promotion, compare fixed baseline and candidate on the same cases, model, tools, scope, and judge while varying one behavior. Report completion, violations, rework, latency, and measured consumption. Two paired wins are only a screening signal; simulated multipliers are not measurements. Never auto-promote or auto-publish.

For GitHub automation, inspect permissions, trigger authorship, concurrency, branch/PR bounds, secret exposure, and action revisions. Keep commit, push, PR, deployment, and release outside the default harness unless separately authorized.

Adapted from HumanLayer `skills@3c2629142c5d437428269b1b722b08c0b87f574d` (`design-control-loop` and `build-iterated-agentic-loop`), MIT; no upstream workflow or executable was imported.
