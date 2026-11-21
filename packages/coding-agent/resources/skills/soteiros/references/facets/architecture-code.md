# Facet: architecture and code

## Checks
- One responsibility per module. Dependencies point toward the domain. No cycles (check the codegraph or the
  import graph). No god modules. The harness size gates hold: at most 800 lines per file and 7 code files per
  directory, where the repository adopts them.
- Explicit state ownership. No shared mutable globals across boundaries. Configuration is read once and
  validated.
- Current language idioms of the target version, verified against its official "what's new" or migration
  guide:
  - strict typing (`strict` TypeScript, typed Python checked by mypy or pyright);
  - no deprecated APIs (run with deprecation warnings as errors);
  - standard-library features over hand-rolled code.
- Formatter and linter enforced in CI (Ruff, Biome or ESLint, gofmt plus vet, rustfmt plus clippy).
- Consequential decisions are recorded (ADRs). The README is runnable. Comments state invariants, risks and
  units, not what the code does.
- No speculative abstraction: an interface with one implementation, a factory for one product, or
  configuration for a constant is a simplification finding only with a concrete cost (complexity that hides a
  defect, duplicated logic). Otherwise it is a note.

## Severity
- High: a dependency cycle or a god module that blocks safe change; a deprecated API scheduled for removal in
  the target version.
- Medium: missing strict typing on the public surface; no enforced formatter or linter.
- Low: documentation gaps with no runtime effect.

Depth: `architecture-decision`, `engineering-standards`, `code-simplification`.
