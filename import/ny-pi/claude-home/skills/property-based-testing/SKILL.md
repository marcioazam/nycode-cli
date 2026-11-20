---
name: property-based-testing
description: "Design, review and debug property-based tests (Hypothesis, fast-check, proptest) for parsers, codecs, validators and invariants with a checkable rule. Not for plain examples, fuzzing, mutation or UI e2e."
license: CC-BY-SA-4.0
---

# Property-based testing

Use the project's existing library; do not add a dependency without the user's decision. First identify the strongest non-tautological property supported by the code, then generate valid domain inputs rather than filtering most cases with assumptions.

Prefer, in descending strength: roundtrip (`decode(encode(x)) == x`), inverse, independent oracle, idempotence, invariant, sortedness, commutativity/associativity, and only then no-crash. A property that merely repeats the implementation is not evidence.

Common libraries, when the project already has one: Hypothesis (Python), fast-check (JS/TS), proptest or quickcheck (Rust), rapid (`pgregory.net/rapid`) or `testing/quick` (Go), jqwik (Java/Kotlin), FsCheck (.NET), StreamData (Elixir). Check the installed version's API with context7 (`tool_search` first) before writing generators. Keep runs reproducible: print or pin the seed, keep shrinking on, and bound example counts so the suite stays fast; save found counterexamples as explicit regression examples (`@example` in Hypothesis, `examples` in fast-check, `proptest-regressions` files) rather than relying on a database cache.

For failures, preserve the smallest counterexample, distinguish a false property from a product bug, and add a regression example when the defect is fixed. Report generation limits, rejected cases, and any untested domain boundary.

Source reviewed: Trail of Bits `property-based-testing`, revision `d3323cefbcf645678b8dc481de204b02ad3d02dc` (CC-BY-SA-4.0), adapted to this harness (pi port 2026-11: library pointers and reproducibility notes).
