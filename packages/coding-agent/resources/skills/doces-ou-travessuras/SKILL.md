---
name: doces-ou-travessuras
description: "Check a git diff for test gaming (loosened assertions, skip/only, deleted tests, lowered thresholds, test-keyed code). Use when a diff touches tests or a fix turns a failing test green."
---

# Doces ou travessuras (trick or treat, for diffs)

Run it before a handback or commit that touched tests, test configuration or coverage settings, and whenever a
fix turns a failing test green:

`python3 ~/.pi/agent/claude-home/skills/doces-ou-travessuras/scripts/doces.py [--base REF] [--json]`

It compares the working tree, untracked files included, with `--base` (default `HEAD`; after commits pass the
branch point, such as `--base origin/main`). It only reads. Exit 0 DOCE, 1 TRAVESSURA, 2 error.

## Reading the findings
- `TRAVESSURA file:line - reason` (high): treat it as test gaming until justified; revert it or fix the code.
  - Tests: assert-removed, assert-loosened, tolerance-loosened, test-removed, test-deleted, skip-added (skip,
    xfail, only, todo, ignore, deselect), harness-hook (conftest hooks that change collection or outcomes).
  - Gates: threshold-lowered, threshold-removed, coverage-exclusion, coverage-pragma.
  - Production: test-detection (`"pytest" in sys.modules`, `PYTEST_CURRENT_TEST`, `NODE_ENV === 'test'`,
    `testing.Testing()`), special-case (a branch on test literals that returns test literals), always-equal
    (`__eq__` returning True).
- `REVIEW file:line - reason`: expected-changed (a test's expected value changed), call-state (a call counter
  steers behavior), and test-removed-documented / test-deleted-documented (a removed test that a docs record added
  in the same diff names). Acceptable only with recorded evidence; the record must cite the spec, not just the name.
- DOCE means no known pattern matched. The analyzer is heuristic; it does not prove the change honest.

## Contract
- The request and the spec outrank the tests. Change a test only when the test itself is wrong: cite the spec,
  doc or observed behavior that proves it, and record the old and new contract with that evidence in the task's
  `/docs` record and in the final report.
- When a test contradicts the spec and the evidence does not settle which one is right, stop and report the
  conflict instead of making the test pass. In ImpossibleBench an explicit abort option cut GPT-5's cheating on
  Impossible-SWEbench from 54% to 9%.
- Never special-case inputs, detect the test runner, overload comparisons or count calls to pass a test. Never
  lower a threshold or add an exclusion to turn a gate green.
- List every TRAVESSURA you keep, with its justification, in the handback.

## Integration
- In pi nothing runs it for you: the Claude Code sensors (`test_edit_sensor` in `~/.claude/hooks/hook-dispatch.sh`
  and the cadê-o-print Stop hook) are not installed here (`~/.pi/agent/claude-home/settings.json` registers only
  `guard.py`). Run it yourself at the moments listed above, and require it in a worker's handback when a delegated
  change touched tests.
- The analyzer's TEST_PATH pattern mirrors that hook's; `scripts/tests/test_doces.py` checks the two stay equal
  while `~/.claude/hooks/hook-dispatch.sh` exists and skips otherwise.

Sources: ImpossibleBench (arXiv 2510.20270, §4.1 cheating strategies, §5.3 abort option);
`~/.pi/agent/claude-home/skills/agent-systems/references/evaluation-design.md`, "Guard against reward hacking".
