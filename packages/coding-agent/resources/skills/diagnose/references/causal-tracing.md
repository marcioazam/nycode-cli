# Causal tracing and asynchronous failures

Read when the symptom appears far from its trigger or depends on ordering. Trace the failing value backward through callers to the first violated precondition. Record the actual value and lifecycle state at each boundary with bounded, non-secret instrumentation. Prefer a discriminating trace over adding logs everywhere; preserve command exit status when filtering output.

For test pollution, isolate fixtures and compare individual versus ordered runs. Bisect the smallest reproducing sequence, retaining both the original order and any minimized reproducer. Do not execute archived helper scripts automatically: use the repository runner with explicit path/time/output limits.

Wait for an observable event or fresh state with a finite timeout, cancellation where available, and useful timeout evidence. Use fake time for time-dependent contracts where appropriate. An arbitrary delay does not establish readiness; a real timing requirement needs a named trigger, clock, interval and tolerance.

Fix at the responsible boundary. Add another guard only for an independently reachable unsafe path, not at every layer mechanically. Regression checks must exercise the causal chain and relevant callers; passing them does not prove a bug impossible in every environment.

Adapted from obra/superpowers, revision `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT). The upstream license is kept in [a local copy]($CLAUDE_CONFIG_DIR/docs/third-party/obra-superpowers/LICENSE); this reference replaces the selected techniques, not the upstream orchestration policy.
