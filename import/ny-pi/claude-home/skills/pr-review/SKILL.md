---
name: pr-review
description: Review a branch, commit, or diff for actionable regressions. Use for PR review, merge readiness, or risk-based code audit; also use for evaluating supplied review feedback; a review alone does not authorize fixes.
---

# PR review

Inspect the actual merge-base diff and enough surrounding code to prove each finding. For non-trivial risk, only the main thread may delegate at most two independent read-only lenses selected from security, contracts/migrations, reliability, tests, CI, UX, or agent systems (architecture and performance stay in the main thread with architecture-decision or performance-audit); do not fan out for a small local change. In pi a lens is a read-only `subagent` call (two lenses: one `{tasks: [...]}` call): security `security-reviewer`, contracts/migrations `contract-migration-reviewer`, reliability `reliability-reviewer`, tests `test-reviewer`, CI `ci-triage`, UX `ux-reviewer`, agent systems `agent-systems-auditor`; each brief pins the base/range and the read-only boundary ([review feedback](references/review-feedback.md)).

Before reading the description, linked issue or spec, infer from the diff alone what problem it solves and which behavior it changes; then compare with the stated intent and treat each divergence as a candidate finding to prove. Return findings first, ordered by severity, with a minimal changed-path citation, affected scenario, and a concrete correction direction. Exclude style nits, pre-existing defects, and unproven concerns. The main thread deduplicates all specialist results. Do not edit, commit, push, or post comments.

For review briefs, supplied review feedback, or drafting a response, read [review feedback](references/review-feedback.md). A review request remains read-only; implement corrections only within an authorized repair.
