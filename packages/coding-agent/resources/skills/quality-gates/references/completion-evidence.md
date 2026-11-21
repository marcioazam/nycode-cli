# Completion evidence

Read before a consequential completion or release-confidence claim. Identify the exact assertion, command/artifact that could establish it, tested content revision, and observed result. A previous check applies only if its inputs remain unchanged. A successful build is not test evidence, and a worker summary is not inspected execution output.

For a regression, show the test failed for the intended cause and passed with the repair where this can be checked safely. Never revert or discard unrelated user changes merely to manufacture a red result. Record skipped, unavailable, flaky or blocked checks explicitly. Do not re-run broad suites when unchanged evidence already covers the claim.

Claim and the evidence it needs:

| Claim | Evidence |
|---|---|
| Tests pass | A fresh run of the named command, its output and exit code, at the tested revision |
| Bug fixed | The reproduction test failing before and passing after, or failing with the fix reverted |
| Delegated work done | The VCS diff and the checks you ran yourself; never the worker's summary |
| Requirements met | A line-by-line check against the spec or plan, with gaps listed |
| Build succeeds | The build's exit code; never test evidence |

State completion only for the requested scope. Local success does not establish CI, merge permission, live-provider compatibility or deployment state. A draft finding or report may be prepared within the task; publishing it is a separate authority boundary.

Adapted from obra/superpowers, revision `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT). The upstream license is kept in [a local copy]($CLAUDE_CONFIG_DIR/docs/third-party/obra-superpowers/LICENSE); this reference replaces the selected techniques, not the upstream orchestration policy.
