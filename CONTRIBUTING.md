# Contributing to nycode

This guide exists to save both sides time.

## Philosophy

First things first: **nycode's core is minimal**.

If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected.

Nycode's core exists to be minimal and to be extensible so that it can be influenced and manipulated by extensions.  Even hook points for extensions however should be well considered and discussed to avoid adding unmaintainable bloat and complex interactions.

The nycode product ships a coding harness on top of that core. The harness is built from built-in extensions (`builtin:<name>`) and bundled resources, not from core changes: a built-in extension is still an extension, and the core changes only where a documented core change point requires it.

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without understanding it is not.

If you use an agent, run it from the `nycode` root directory so it picks up `AGENTS.md` automatically. Your agent must follow the rules and guidelines in that file.

## Quality Bar For Issues

If you open an issue, you must use one of the two GitHub issue templates.

If you open an issue, keep it short, concrete, and worth reading.

- Keep it concise. If it does not fit on one screen, it is too long.
- Write in your own voice (do not use an LLM to generate text, if you must, follow up with a clearly AI labeled comment).
- State the bug or request clearly.
- Explain why it matters.
- If you want to implement the change yourself, say so.

If the issue is real and written well, a maintainer will triage it. Issues that do not meet this bar may be closed without a reply.

## Blocking

If you ignore this document twice, or if you spam the tracker with agent-generated issues, your GitHub account will be permanently blocked.

If you send a large volume of issues through automation, your GitHub account will be permanently blocked. No taksies backsies.

## Before Submitting a PR

Before submitting a PR:

```bash
npm run check
./test.sh
```

Both must pass.

External contributors do not edit any `CHANGELOG.md`: the maintainer records the entry under `## [Unreleased]` when merging. Maintainers and agents edit `[Unreleased]` only, as `AGENTS.md` says.

If you are adding a new provider to `packages/ai`, see `AGENTS.md` for required tests.

## Repository rules

- Never commit secrets, personal identifiers, sessions, `auth*.json`, `mcp.json` or `local.env`. The leak checks in `scripts/ci/` and the pre-commit hook must pass.
- Third-party code enters in one of three ways: an exact-version dependency, an optional package pinned to a full commit SHA, or imported code recorded in `NOTICE` with its origin, commit and license. Never patch a third-party component at run time.
- Every shipped skill, agent, extension, hook, command or plugin has a class: `core`, `ui` or `optional`, listed in [`docs/specs/0005-core-scope.md`](docs/specs/0005-core-scope.md). `core` serves coding in any language, project type and domain, works with the shipped tools and the model provider alone (no specific MCP, SaaS, account or personal setup), is not a personal preference, and passed the cost x benefit rule against Claude Code and plain pi. Terminal-only pieces are `ui`; everything else is `optional` (kept out of the model's context by default) or stays out of the repository (narrow domains such as marketing, visual design or one cloud).
- Text for the model follows [`docs/specs/0006-instruction-format.md`](docs/specs/0006-instruction-format.md): Markdown for instructions and skills, an XML tag around pasted material (documents, logs, examples, inputs) with long material before the task, JSON only where code parses it, and no format migration without the gate.
- Code files created by nycode stay under 800 lines, with at most 7 code files per directory (the exact scope is in `AGENTS.md`).
- Claims in the README and in pull request descriptions follow the honesty rule: every number points to a measurement in this repository with its sample size and interval, and numbers about nycode come only from a measurement of the `nycode` arm (until then the text says "measured as ny-pi on pi 1.5.2"); a loss is written next to the win it offsets; an interval that crosses zero is "not shown", never a win; what was not measured is called unmeasured; a newer measurement replaces the old number.

## Questions?

Open an issue using one of the templates.

## FAQ

### Why do some issues get no reply?

A reply is maintenance work too. Low-signal issues, unclear reports, duplicates, and issues that do not follow this guide may be closed without discussion. This keeps time available for reproducible bugs, thoughtful requests, and contributors who have done the work to make their report actionable.

### Why not let AI triage everything?

AI can help group duplicates, summarize reports, and spot missing information. It is not trusted to make final maintainer decisions. Polished AI-generated issues can still be wrong, misleading, or expensive to investigate. Human review remains the final gate.

### Is this hostile to contributors?

No. It is a guardrail against burnout and tracker spam. Short, concrete, reproducible issues are welcome. Thoughtful contributions are welcome. Automated slop, entitlement, and large volumes of low-effort reports are not.
