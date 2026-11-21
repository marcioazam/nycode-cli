---
name: context-economy
description: "Cut context cost without hiding evidence: noisy output, padded prose, briefs and handbacks, compaction. Use when output floods context, a session runs long or a brief is written. Not for swarm-orchestration or loop-engineering."
---

# Context economy

pi has no output sandbox: every `bash` and `read` result lands in the context, so filter at the source. Send large command output to a file under `/tmp` and read only what decides (`cmd > /tmp/out.log 2>&1; tail -n 40 /tmp/out.log`, `rg -n 'FAIL|Error' /tmp/out.log | head -50`, `wc -l`, `jq` projections); use `read` with `offset`/`limit` on big files; use `rtk` explicitly for other high-volume command output when its recovery path is sufficient; hand broad sweeps or page analysis to a subagent (`Explore`, `code-mapper`, `web-scout`) that returns only the condensed result. Diffs, evidence, traces, security findings and files about to be edited must still be read verbatim; a filtered view, a summary or an empty search is not evidence of absence. For uniform structured arrays, use TOON only after measuring savings and verifying round-trip decoding; prefer compact JSON or CSV when the structure does not fit.

For prose, remove filler while preserving language, code, paths, URLs, commands, safety warnings, and irreversible instructions. Do not compress secrets, opaque errors, security evidence, or content whose exact wording matters.

For the orchestrator's and subagents' context (lean main thread, tool-output clearing before summaries, structured checkpoints, cache-stable prefixes, briefs and handbacks), read [agent context](references/agent-context.md).

For long tasks or context pressure, read [checkpoints](references/checkpoints.md). Measure installed metadata separately from loaded context, and load only the reference needed for the current decision.
