---
name: soteiros
description: "Audit code, architecture, dependencies and practices against current SOTA from primary sources (stable releases only) and transform to it; each gap with evidence, target, cost and rollback."
---

# Soteiros

SOTA means current stable technology, verified idioms and every path handled, proven by evidence,
never by popularity or memory. Never call a result "perfect": claim "no known gap after checks X, Y"
and list the residual risk.

## Policy

- Resolve versions now from primary sources (registry, vendor release or lifecycle page) and record
  the source and access date. Runtime with an LTS channel: newest active LTS; a newer non-LTS line is
  an option, not the target. Library or tool: latest GA. Reject alpha, beta, rc, preview, canary,
  nightly, dev, insiders builds and experimental flags. Details: [currency](references/currency.md).
- The simplest design that meets the target wins. SOTA is not more abstraction, more dependencies
  or a rewrite; a migration needs a concrete capability or measured benefit, boundaries and rollback.
- Respect the repository's version policy and supported platforms; report a conflict instead of
  overriding it.

## Workflow

1. Inventory: stack, runtime and dependency versions, entrypoints, contracts, tests, CI. Use the
   code graph when the repository is indexed (`tool_search` for `mcp__codegraph__*` first), `rg` otherwise.
2. Currency: compare every component with its stable target; flag end of life, pre-release pins,
   deprecated APIs, abandoned packages and open advisories.
3. Gaps: walk the [rubric](references/rubric.md) and the [path matrix](references/paths.md) for every
   entrypoint. Each dimension's current editions, checks and tools live in its file under
   [facets](references/facets/README.md); an assigned facet means that file only. Load the owning skill
   named there for depth instead of guessing (`read` its `SKILL.md` under `~/.pi/agent/claude-home/skills/`).
   A repository-wide or multi-module audit that would flood the context: run one `soteiros-auditor`
   per facet or module in parallel (`subagent` `{tasks:[{agent:"soteiros-auditor", task:"<scope>; facet: <file>"}, ...]}`, (optional)
   at most 8) and merge their findings; they are read-only, so transformations stay with you or `zero-legado-builder`.
4. Findings, most severe first: `file:line`, observed evidence, SOTA target with source and date,
   impact, migration cost, rollback. Separate observed defects from hypotheses; zero findings is valid.
   A design preference without a sourced stable target (schema validation of trusted local config, an
   injectable clock) is a note, never a FINDING.
5. Transform only when asked or authorized: smallest change that reaches the target, test-first for
   behavior, one concern per step, public contracts preserved unless a change is approved.
6. Verify: run tests, lint, type and build checks; exercise the failure paths you touched; re-run the
   currency check on changed manifests. A path is handled only when a test or an executed check covers it.
7. Report: scorecard per dimension (SOTA, gap, not assessed), findings, checks run and not run,
   residual risk.

## Finding line

`FINDING: <file>:<line> - <gap>; target: <stable SOTA target> (<source>, <access date>)`
