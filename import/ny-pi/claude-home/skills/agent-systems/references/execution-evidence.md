# Execution evidence and controlled improvement

## Evaluate evidence, not a success narrative

Keep check evidence in the current task artifact. Bind it to the task and current content identity, covering dirty files and relevant inputs rather than HEAD alone. Record the executed command, safe working-directory reference, terminal exit status, duration, and assertion report where available. Do not collect secrets, full environment dumps, raw prompts, or unbounded tool output. Redact before persistence; do not assume a hash makes sensitive input safe to retain.

Capture receipts from the executor or independently inspected test artifacts. An agent's claimed tool list, absent stderr keywords, zero exit code without assertions, or a manually unevaluated check cannot prove completion. Timeout, skipped, missing, malformed, and stale results cannot pass. Hashes detect content differences; they do not authenticate execution or prove the truth of conclusions. Keep local, CI, and live-service evidence distinct.

Record a receipt in this shape and check it yourself; pi ships no receipt validator (the Codex one was dropped 2026-11-12). Expectations must come from the task's acceptance criteria, independently of the receipt:

Version 1 requires exactly:

```json
{
  "schema_version": 1,
  "task": "task-id",
  "revision": "current-content-identity",
  "execution": "completed",
  "exit_code": 0,
  "assertions": [
    {"id": "unit-tests", "outcome": "pass", "evidence": "safe-report-reference"}
  ]
}
```

`execution` is `completed`, `not_run`, or `timed_out`. Incomplete execution has null exit code and no assertions. Assertion outcomes are `pass`, `fail`, `manual_required`, or `not_run`; evaluated outcomes require a nonempty evidence reference. IDs/references are at most 512 characters; at most 128 unique assertions. Unknown fields and duplicate JSON keys invalidate the receipt. A missing required or unevaluated assertion is `not_verified`; a failure is `fail`; neither passes.

Scope the verdict to the supplied receipt: schema validity is not an authenticated run, report-content validation, or live-model evaluation. Establish the current revision independently. Do not relabel fixture results as external readiness.

For required TDD, the receipt records the red and green runs. For ordinary behavior validated without optional
test-first, do not claim a red/green sequence; require the relevant assertion IDs instead. The working contract owns
risk and research requirements; expectations come from the task, not its receipt. Compare actual MCP outputs and chronological test logs before
accepting a receipt; syntactic diversity or declared red failure is not proof.

Model-behavior evals of the pi harness go through the `pelo-em-ovo` skill; live tasks need frozen workspace fixtures, (optional)
independent graders and an approved budget. Telemetry already collected from pi sessions is summarized offline by
`python3 $CLAUDE_CONFIG_DIR/bin/telemetry/pi_telemetry.py`; keep such a summary scoped to the supplied
measurements: it does not certify collection, billing, completion or upstream model identity.

Use reported output tokens over the explicitly recorded duration for effective TPS. Do not add reasoning tokens that may already be included. Visible streaming TPS requires first/last visible-text times and a separately measured count excluding the first chunk; complete-message events cannot provide it. Missing usage/cost remains unknown. Compare paired task outcomes and total cost per success, not throughput in isolation.

## Promote rules only from comparable observations

Keep baseline/candidate tasks, initial state, models, tools, judge criteria, and instruction revisions fixed; vary one behavior at a time. Include positive and adversarial cases, not only trigger-word matching. Separate structural fixture checks from actual model runs. Report completion, authority violations, tool usage, rework, latency, and measured consumption; unknown cost is not zero and cumulative tokens per step are a rate, not acceleration.

Require repeated observed improvements without safety regression before proposing promotion, and retain a rollback copy. Two independent paired runs are a screening signal, not statistical proof. Do not promote automatically or substitute simulated multipliers for measurements. No automatic memory writes: user-authorized notes retain source, date, and uncertainty, and never override normative instructions.

Optional integrations remain removable: exact reviewed version and integrity, explicit installation, bounded output and process lifetime, no shell interpolation, and observable absence. An unavailable optional tool may degrade the workflow; it cannot make a required check pass.

## Provenance

Original local adaptation of concepts reviewed at Ruflo commit `277c7bc03ad192eef6d6f57e59ab7bab69a5728d`; no upstream implementation copied or executed. Upstream is [MIT licensed](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/LICENSE).

- [Constitution/shards](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/guidance/docs/adrs/ADR-G002-constitution-shard-split.md): conditional detail, without hash embeddings or truncating core rules.
- [Capability envelopes](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/security/src/policy/envelope.ts) and [continue gate](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/guidance/src/continue-gate.ts): decreasing authority and bounded continuation, without claiming prompt-level runtime enforcement or importing heuristic thresholds.
- [Proof](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/guidance/src/proof.ts), [headless evaluation](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/guidance/src/headless.ts), and [optimizer](https://github.com/ruvnet/ruflo/blob/277c7bc03ad192eef6d6f57e59ab7bab69a5728d/v3/@claude-flow/guidance/src/optimizer.ts): evidence binding and staged proposals, without false-success assertions, cryptographic infrastructure, or simulated A/B gains.
