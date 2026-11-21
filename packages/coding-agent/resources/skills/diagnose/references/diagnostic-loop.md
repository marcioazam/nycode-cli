# Diagnostic loop

Adapted from concepts reviewed in `mattpocock/skills` at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT, Copyright (c) 2026 Matt Pocock). This is conditional guidance, not a mandate for a fixed run count or a promise of reproducibility.

1. Define expected versus observed behavior and a smallest red-capable signal.
2. Pin relevant environment, time, and seed. Record attempts and actual failure counts.
3. Minimize one input, dependency, or execution seam at a time without losing the symptom.
4. Rank competing hypotheses. For each probe, state the predicted observation and change one variable.
5. Prefer read-only debugger/profiler or targeted assertions. If temporary instrumentation is authorized, label and remove it.
6. Once repair is authorized: red, minimal causal fix, green, then rerun the original scenario.

If no reliable red signal can be built, stop and report what was tried, then ask for the missing access, a redacted artifact, or authorization for temporary instrumentation. If the defect has no correct seam for a regression test, record that as a finding instead of testing through an unrelated surface. These two rules were added 2026-10-03 from the same upstream at `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`.

Do not import upstream requirements for mandatory scripts, fixed hypothesis counts, or unattended stress loops. Diagnosis remains read-only until repair authorization.
