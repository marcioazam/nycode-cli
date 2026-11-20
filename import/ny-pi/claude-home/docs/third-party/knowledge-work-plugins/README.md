# Knowledge Work Plugins adaptation

Source: https://github.com/anthropics/knowledge-work-plugins/tree/67e216dbe5621470581dd3d944df22d1cc8231ce

Modified 2026-09-20 for the local Codex harness. These are adaptations, not
verbatim plugin installations. Apache-2.0 license copies are retained exactly:
[repository root](LICENSE-root), [data](LICENSE-data),
[product management](LICENSE-product-management), and
[enterprise search](LICENSE-enterprise-search). The root license file includes
additional trailing text from upstream; it was retained without treating it as
instructions. No NOTICE file was present in the selected source scopes.

| Source skill | Local integration |
| --- | --- |
| design/design-handoff | skills/design-handoff, with bounded handoff checklist |
| design/ux-copy | skills/ux-copy |
| data/validate-data | skills/validate-data, with analysis QA reference |
| design/research-synthesis | design-review/references/research-synthesis.md |
| product-management/metrics-review | sdd-workflow/references/product-outcomes.md; conversion routing |
| enterprise-search/knowledge-synthesis | evidence-research/references/knowledge-synthesis.md |

Changes: concise native entrypoints; conditional references; removal of Claude
slash-command placeholders and assumed connectors; evidence-based defaults;
no fabricated design measurements, causes, analytical verification, or causal
claims; domain-aware metric bounds; reuse of existing authorization. Connector
operations are optional and remain subject to available tools and task authority.
No upstream scripts, manifests, MCP registrations, or business-wide automations
were installed. Native agent roles are updated through focused local routing.

All three new skills permit implicit invocation. Existing skill discovery policy
is preserved. No global AGENTS.md or runtime permission settings were changed.

Source blob identities and hashes of changed skill/agent artifacts are recorded
in [provenance.json](provenance.json). The integration status and validation record
are in [skill curation](../../skill-curation.md).
