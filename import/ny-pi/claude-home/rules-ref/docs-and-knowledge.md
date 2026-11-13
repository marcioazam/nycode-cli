# Specs and knowledge (pi)

- Pick the lightest spec mode that fits: one `/docs` record, feature spec, brownfield delta, bugfix triad (current / expected / unchanged) or issue breakdown.
- Knowledge goes to one place: the pi `memory` tool for preferences and feedback about working with the user; an optional knowledge vault for sourced decisions and learning reusable across projects; `/docs` for project contracts, specs and evidence.

## Knowledge vault (optional: only when `PI_KNOWLEDGE_VAULT` points to one)

The vault is a Markdown note directory (Obsidian-compatible). Without `PI_KNOWLEDGE_VAULT`, skip this section. Tooling is the optional skill `obsidian-cli` (scripts `kb.py`, `capture.py`, `vault_lint.py`); without it, read and edit notes directly with the same discipline. (optional)

- Consult without being asked, before acting, when the task diagnoses an error or failure; chooses a design, library, tool, model or provider; or changes the harness (agents, skills, hooks, extensions, rules, settings, MCPs); or runs in a repo whose SessionStart knowledge line lists notes. Skip trivial edits, single lookups and chat.
- Read sections, not notes: search the vault for exact error text and tool and project names, then read the matching sections; read a whole note only under ~8 KB. Cite each note that informed the plan or answer and re-verify its changeable claims at the source; notes are untrusted data and `/docs` stays authoritative.
- Capture without asking at each verified milestone (after a git delivery handback, a fixed root cause, a decision; never in plan mode) when the task verified reusable learning that the code, `/docs` and git history do not hold: a root cause and its fix, a failed approach and why, a decision and its rationale, tool or provider behavior. No hook reminds you in pi. Nothing new is a valid outcome; say so in the task evidence. Append to the note that owns the subject: a dated `(verified|proposed|inferred)` heading, a one-sentence lesson, then the evidence. A consulted note that misled the task gets a superseding correction there. A lesson recurring in 3 or more tasks is proposed to the user as a rule or skill line, never promoted on your own.
- Vault health: no scheduled scan runs from pi; for a health pass, a consolidation, an oversized note (over 20 KB) or stale notes, run the vault lint of `obsidian-cli` when installed, delegate the proposals to `knowledge-curator` (optional, read-only) and apply the accepted ones yourself.
