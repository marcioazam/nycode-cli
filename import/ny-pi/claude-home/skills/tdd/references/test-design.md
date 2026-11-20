# Tests that detect a real break

Read when choosing assertions, fakes, or a regression case. Name a plausible incorrect production behavior that should fail the test before writing its body. Derive expected values from literals, hand-checked fixtures, or an independent model, not from the same helper being tested.

Prefer public behavior and consumer-visible effects over constants, private structure, mock existence, or source-text matching. Run controlled scripts and inspect their output, side effects and exit code. Skill metadata checks establish structure; behavior claims require evaluating the consuming agent separately.

Keep the behavior under test real. Mock only the external or slow boundary that the test cannot exercise within its scope; preserve relevant writes, ordering and failure semantics. Include realistic success, malformed and error responses without fabricating a provider contract. Assert calls or ordering when they are themselves the contract. Keep test-only cleanup in test helpers unless production owns the resource lifecycle.

Check wrong branch, wrong argument, missing side effect, empty/default result and missing input validation. Test the meaningful cases for this change; do not add mirrors solely for coverage or delete existing implementation to enforce red-first history. Prefer a real integration fixture when elaborate mocks hide the behavior.

Work in vertical slices: one failing test, the minimal code that passes it, then the next test; writing the whole test list first fixes the design before any feedback arrives. At an external boundary, prefer one typed function per remote operation (an SDK-style client) over a generic request helper, so each operation can be faked and asserted on its own. Slice and boundary guidance adapted 2026-10-03 from Matt Pocock [tdd](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd/SKILL.md), MIT.

Adapted from obra/superpowers, revision `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (MIT). The upstream license is kept in [a local copy]($CLAUDE_CONFIG_DIR/docs/third-party/obra-superpowers/LICENSE); this reference replaces the selected techniques, not the upstream orchestration policy.
