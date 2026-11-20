---
name: security-audit
description: "Audit authorized code, config, dependencies, MCP tools, skills or a diff for exploitable risk, including authn/authz and data exposure. Use for security reviews. Not for style, threat-modeling or exploiting live systems."
---

# Security audit

Define the target and trust boundaries. Trace attacker-controlled input through authorization, validation, secrets, external calls, persistence, CI, dependencies, and tool descriptions. Prefer demonstrated exploit paths over generic checklist findings.

Delegate substantial scans to the `security-reviewer` agent (`subagent {agent: "security-reviewer", task}`); for broad targets fan out one task per attack class or subsystem with `subagent {tasks: [...]}` (at most 8 per call, 4 at once; children cannot delegate, so the parent merges and dedupes). Add contract or CI review only when the target warrants it. Report severity, evidence, attack preconditions, affected boundary, and remediation direction. Do not exploit live systems, change code, or install scanners without authorization.

For Rust, explicitly inspect `unsafe`/FFI boundaries, panic-induced denial of service, async cancellation and runtime misuse, concurrency ordering, and ABI assumptions; safe-code compilation does not establish these properties. Keep secret zeroization and supply-chain review as separate skills.

For harness targets, inspect untrusted tool/instruction input, shell interpolation in hooks, executable provenance, and actual runtime permissions. Do not read secret stores or install AgentShield merely to finish a checklist; use the existing authorized checks and distinguish prompt guidance from sandbox enforcement.

Before executing target-controlled code in any review mode, read and enforce
[universal execution safety](references/full-audit/WORKFLOW.md#universal-execution-safety).
If the OS sandbox controls are unavailable, continue source inspection and mark
runtime claims `needs_validation`; loading this safety section does not start a
full audit. In reports, keep unverified candidates separate from confirmed
findings and do not assign confirmed severity to `needs_validation` records.

For an explicit full codebase audit or requested audit report, load the
[full audit protocol](references/full-audit/WORKFLOW.md). Its directory is the
companion-library root: preserve OS-enforced execution sandboxing, independent
validation, coverage ledger, artifact promotion, and `needs_validation` states.
Focused questions use only relevant guidance; they do not trigger full artifacts.
This protocol consolidates the former cloudflare-security-audit entrypoint.

For installed/imported skills or agent plugins, use
[skill boundary review](references/skill-boundaries.md). A clean pattern scan does
not establish safe behavior or runtime confinement.

When documented permissions or invariants exist, compare each claim with its
actual enforcement path, including alternate entrypoints and tenant/resource
filters. Cite the intended rule and observed implementation separately; comments
and architecture documents are claims, not enforcement. Missing documentation is
an evidence gap, not a reason to invent policy or stop source-based review.

Intent comparison adapted 2026-09-20 from Pawel Huryn
[intended-vs-implemented](https://github.com/phuryn/pm-skills/blob/8607e3b077817f89bf4a9b623246219734ac3be0/pm-ai-shipping/skills/intended-vs-implemented/SKILL.md),
MIT, with local scope and reporting rules preserved.

Map findings to a CWE ID (prioritize the 2025 CWE Top 25, released 2025-12-11, https://cwe.mitre.org/top25/), OWASP Top 10:2025 (https://owasp.org/Top10/2025/), the OWASP Top 10 for LLM Applications 2026 (`LLMxx:2026`, https://genai.owasp.org/download/56857/), the OWASP Top 10 for Agentic Applications 2026 (`ASI01`-`ASI10`, https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/), ASVS 5.0.0 (https://owasp.org/projects/asvs) and SLSA v1.2 (https://slsa.dev/spec/v1.2/), all read 2026-10-24 and re-verified current 2026-11-11; never cite `:2021` or `LLMxx:2025` IDs from memory. A diff that touches manifests, lockfiles, action pins or base images also loads [supply-chain-risk-auditor](../supply-chain-risk-auditor/SKILL.md). MCP authorization checks by protocol version are in [AI and LLM](references/full-audit/AI-AND-LLM.md).

Variant analysis, sharp-edge checks and offline scanners (semgrep, gitleaks, trivy; `/skill:semgrep`, `/skill:variant-analysis`, `/skill:sarif-parsing` and `/skill:codeql`, licence-limited, are ported under `~/.pi/agent/claude-home/skills/`; the `offensive-*` skills do not exist in pi) plus the CodeQL licence limit: [companion tools](references/companion-tools.md). (optional)
