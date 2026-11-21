# Fix round 2: fixture purity and instruction CLI

## session-cwd tests (`claude-home/patches/pi-core/session-cwd/{apply,runtime}.test.mjs`)
- Old contract: `tree()` reverted only our patch, so a live SDK already carrying ui-controls made `base` include ui; later `revertUi` vs `base` failed (190 bytes). The wrong-version tree wrote the bad version before cleaning.
- New: `tree()` pins `package.json` to 1.5.2, reverts ui-controls (existing `revertUi`) and ours on the COPY, captures `base` clean, then writes the requested bad version. The pin is not loosened; all deepEqual and other-patch assertions are kept.
- runtime negative control: previously skipped when the live SDK was patched (lost characterization). Now a bounded isolated copy (`.js` of `dist` only; `bundle`/`bun` excluded since the native SessionManager lives in `core/session-manager.js`; deps via read-only `node_modules` symlink) has our patch reverted by the existing applier on the copy. It asserts the native missing-cwd lookup, always; patched behavior is asserted on the live SDK as before. No skip depends on live patch state; the live SDK is never written.
- D11 test: the "older" genuine session in `b` is made older with `utimes` (an mtime tie made it flaky); the intent is unchanged.
- Pin stays 1.5.2; no provider/auth/store imports.

## arg-expansion-check CLI
- Bug (same as the permission applier): `import.meta.url === file://${argv[1]}` is false through a symlink, so exit 0 with no stdout and the JSON parse in `check-instructions.py` failed.
- Test first (`arg-expansion-check.test.mjs`, red then green): spawns the CLI through a symlink with a fake Markdown with `$1`; asserts the same JSON as the real path and a non-empty hit.
- Fix: compare with `pathToFileURL(fs.realpathSync(argv[1])).href`. Checks directory is now at 7 code files.
