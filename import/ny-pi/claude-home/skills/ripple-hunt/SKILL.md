---
name: ripple-hunt
description: "Statically sweep for stale references after an edit (renamed/removed names, counts, READMEs, size limits, generator checks) and return a hit list. Use before the one gate run. Not for gate-runner or code review."
---

# Ripple hunt

A cheap static sweep: run it inline with `bash` (`rg`, `git`), or delegate it read-only through `subagent` `{agent: "swarm-worker", task: "ripple-hunt: read ~/.pi/agent/claude-home/skills/ripple-hunt/SKILL.md, sweep <diff/range>, edit nothing"}` (pi's `subagent` has no per-call Haiku tier, and `Explore` has no `bash`). The repository's own files win: its `AGENTS.md` or
`CLAUDE.md`, its project skills, its structure limits and its gate script. This skill fills gaps and defers to
them. It reads and reports; it edits nothing unless the brief says so, and it runs no build, test or gate.

Inputs: the diff (`git diff`, plus untracked paths from `git status --porcelain`) and the repo's limits.

## Sweep
1. Names: list each renamed, removed or retyped identifier, path, flag, config key, enum value, field, error
   code and environment variable. Run `rg -n -F` for the old and the new name across code, tests, docs,
   config, CI files, vector tables and `CHANGELOG.md`.
2. Counts and enumerations: find hard-coded counts, "N fields" prose, tables and indexes the change shifts, and
   recompute them from source.
3. A `README.md` in every new directory, when the repo requires one.
4. Limits: 800 lines per code file and 7 direct code files per directory, with
   `python3 ~/.pi/agent/claude-home/bin/structure/structure.py --project-root ROOT --json`, or the repo's stricter policy.
5. Syntax: the formatter and the parsers (JSON, YAML, TOML, schema, markdown links) on edited files only, and
   every generator `--check` that finishes in seconds.
6. Agreement: the CHANGELOG entry, the record and the doc anchors name the same things; relative links and
   anchors resolve.
7. Leftovers: `rg -n '^(<<<<<<<|=======|>>>>>>>)'` for conflict markers.

## Reading the result
Zero hits is a sensor, not proof: names built from strings, reflection and generated code escape `rg`. Then
run the gate once (`subagent` `{agent: "gate-runner", ...}`). Structural callers and blast radius belong to the `codegraph` MCP (load it with `tool_search` first).

## Output
One line per hit:

`file:line — stale reference — suggested fix`

Then the names swept, checks run (command, exit code) and checks not run with the reason.
