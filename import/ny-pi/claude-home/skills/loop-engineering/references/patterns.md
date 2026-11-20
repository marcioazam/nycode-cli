# Loop patterns

## Plan completion loop (user rule 2026-11-08)
An approved plan runs to the end: after `plan_mode_complete` approval, keep working until a `plan-reviewer` subagent returns `PLAN_REVIEW: complete` after the last edit. pi has no Stop hook enforcing this (Claude Code's `hooks/plan/plan_gate.py` is not ported), so drive it yourself: track the plan items with `todo`, and for a long plan set `/goal plan-reviewer returned PLAN_REVIEW: complete after the last edit` (pi-code; its judge reads the conversation, runs no commands).
- Reviewer tier: `plan-reviewer` has no `model:` pin, so it runs on the session model; there is no per-call `sonnet`/`opus` switch in pi. For plans touching auth, secrets, money, persistent data, migrations, concurrency, security or incompatible public contracts, run it from a session on the strongest model.
- Fix every gap through workers, then review again.
- End a message with `PLAN BLOCKED: <reason>` only when a user decision or authorization is needed, `PLAN WAITING: <work>` while background work runs, `PLAN CANCELLED` when the user cancels.
- `/goal` also stays for ad-hoc conditions.

## Polling and scheduling
- Background subagents (`subagent` with `background: true`) notify on completion: never poll them (`{status: true}` only to list runs on request).
- pi has no background Bash, `/loop`, ScheduleWakeup or cron. Long commands run with `nohup cmd > /tmp/x.log 2>&1 &` and a bounded check of the log; external state (CI, deploys) is polled with a deadline and an interval paced to how fast that state changes, e.g. `gh run watch <id> --exit-status` or `timeout 900 bash -c 'until <check>; do sleep 30; done'`.

## Reward hacking inside loops
- About 4% of frontier coding-agent runs contain reward hacks; read-only tests do not stop special-casing.
- LLM monitors catch far fewer cheats on multi-file repositories than on single files.
- Both are required: the deterministic `doces-ou-travessuras` check and a reviewer reading the test hunks.
