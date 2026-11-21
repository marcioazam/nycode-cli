# Fix: editor-actions patch tests (integrated gate A, round 1)

## Observed
Gate A: 3 of 80 patch tests failed (`unit-patch-mjs.log`).

1. `editor-actions/apply.test.mjs:302` and `:325` (wrong-version cases) threw `pi não é 1.5.2` from `tree()`, not from the case under test.
2. `session-cwd/apply.test.mjs:55` ("preserva outros patches"): not an editor-actions defect (see Open).

## Root cause (1)
The installed 1.5.2 dist already carries the editor-actions block. `tree({version})` wrote the wrong `package.json` version first, then called `revert()` to restore the native base. `revert` runs the same version pin, so it threw. The applier and its pin are correct: the installed SDK is 1.5.2 and `apply`/`revert` must keep refusing other versions.

## Fix
Fixture contract only (`editor-actions/apply.test.mjs`): `tree()` writes the pinned version, reverts the block if present, and only then writes the version under test. The pin, the assertions and `apply.mjs` are unchanged. Result: `apply.test.mjs` + `wrapper.test.mjs` 26/26 pass.

## Open (outside the owned files)
`session-cwd/apply.test.mjs` "preserva outros patches": the installed dist also carries ui-controls, so `base` includes it. After `revertUi` the final `deepEqual(read(t), base)` loses the ui-controls block (190 chars in interactive-mode.js and the chunk). The fixture must revert ui-controls (`revertUi`) in `tree()` before taking `base`. Needs an edit in `session-cwd/apply.test.mjs`.
