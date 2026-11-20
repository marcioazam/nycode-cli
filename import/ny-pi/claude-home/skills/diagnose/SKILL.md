---
name: diagnose
description: Diagnose an observed bug, failure, flaky behavior, or production symptom before changing code. Not for an already proven, narrowly scoped fix.
---

# Diagnose

Establish the symptom, expected behavior, scope, and a reproducible observation. Trace the smallest relevant execution path, collect discriminating evidence, and form competing hypotheses. Test the cheapest decisive hypothesis first; do not treat a plausible explanation as a root cause.

Report: observed facts, root cause or remaining hypotheses, evidence, affected surface, and the smallest safe next action. Use a specialist only for independent evidence collection or a clearly separate domain (pi `subagent`: `code-mapper` for unknown call paths, `ci-triage` for a red CI run, `reliability-reviewer` for retry/cancellation/race failures). Do not edit until the user requests a fix or diagnosis is part of an explicitly requested repair.

For a usable loop, create a symptom-specific red-capable signal (test, fixture, CLI/HTTP/browser assertion, sanitized replay, differential/bisection, or bounded property check). Pin relevant environment, time, and seed; record observed failure counts rather than promising a reproducibility rate. Minimize one input or dependency at a time while retaining the original symptom. Rank falsifiable hypotheses, each written as "X causes the symptom because Y", and give each one an intervention that could refute it (change that input, dependency, message or code path and re-run the signal); record validated, refuted or inconclusive before the next one. Compare the failing path with a similar working path and list every difference. After three failed fixes, stop patching and question the design with the evidence. Change one variable per probe, preferring read-only debugger/profiler evidence (run the language's debugger or profiler non-interactively through `bash`, e.g. `dlv`, `python -m pdb`/`py-spy`, `node --inspect` or `perf`, with bounded output; `lsp_*` tools for definitions and references; pi has no debugger MCP) over indiscriminate logging. A regression test must exercise the causal chain and relevant callers. When repair is authorized, use red → minimal fix → green → original non-minimized scenario. Keep retries, instrumentation, and output bounded; never capture secrets or claim diagnosis-only work fixed the issue.

For the detailed diagnostic loop and provenance, read [diagnostic loop](references/diagnostic-loop.md) only when the failure is flaky, difficult to reproduce, or requires minimization.

For deep call-chain failures, ordering or test pollution, read [causal tracing](references/causal-tracing.md).
