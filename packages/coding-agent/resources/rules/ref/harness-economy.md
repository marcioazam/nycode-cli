# Harness changes: quality floor, then economy

Applies to every change to the pi harness (the wrapper `bin/pi`, `~/.pi/agent/settings.json`, `mcp.json`, extensions,
and `$CLAUDE_CONFIG_DIR`: CLAUDE.md, rules, commands, skills, agents, hooks, patches, settings) and to a repository's
harness (gates, CI workflows, local rules and agent instructions, hooks, test and lint configuration).

- Quality is the floor: never buy economy by weakening a gate, check, assertion, security control or mandatory rule
  (CLAUDE.md, Verification).
- Above the floor the cheaper option wins. Weigh what a change spends on every run against the quality it buys:
  always-loaded bytes (CLAUDE.md, rules, skill and agent descriptions; subagents load them too), model tier, subagent
  calls, turns and context, hook latency per tool call, CI minutes, runners and reruns.
- Tighten or reuse the existing owner before adding a rule, skill, agent, hook, extension, job or always-on check;
  propose removing what nothing uses, and remove it only with the user's approval. A requirement that must hold
  without exception belongs in a hook (`hooks/guard.py`), not in more emphatic prose.
- The change's `/docs` record states its expected cost and the quality it buys. pi harness: run the checks of what
  changed, then report residual failures: `python3 $CLAUDE_CONFIG_DIR/bin/checks/check-instructions.py` (CLAUDE.md,
  rules, commands), `python3 $CLAUDE_CONFIG_DIR/bin/checks/check-agents.py` (agents),
  `cd $CLAUDE_CONFIG_DIR/hooks && for d in . dispatch; do (cd $d && python3 -m unittest test_*.py); done` (hooks),
  the extension and patch tests under `$CLAUDE_CONFIG_DIR/bin/tests/` (`node --experimental-strip-types --test <file>`),
  `npm test` in a third-party extension you changed, and
  `python3 $CLAUDE_CONFIG_DIR/bin/structure/structure.py --project-root <dir> --json` (each changed code directory).
  Adoption on eval evidence (optional: the `pelo-em-ovo` skill and an eval suite driven by `bin/evals`) needs a spend
  ceiling set by the user and a cost ratio ≤ 1.20; cost is read from the per-message usage in pi's session JSONL
  (`~/.pi/agent/sessions/`). Repository harness: CI duration and pass and flake rates before and after.
