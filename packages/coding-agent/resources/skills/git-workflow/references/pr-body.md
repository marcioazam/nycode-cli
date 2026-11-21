# PR body

Read only when creating or editing a pull request description is authorized. Keep prose brief and skip preambles; use the project's own terms.

```markdown
## Summary
<smallest visual that makes the change clear>

## Evidence
- **Before:** <failing test, output or screenshot>
  **After:** <passing test, output or screenshot>

## Merge danger
**Door:** <one-way or two-way>
**Blast radius:** <who or what can break>
```

- **Summary**: pick the smallest view that explains the change: pseudocode for logic, a call tree for control flow, a file or component tree for structure, a diff sketch for a focused edit, or a Mermaid diagram for interactions. Place each visual beside the sentence it supports; use one or two, not all.
- **Evidence**: show before and after. A screenshot fits a visual change; otherwise show the exact test or command output that failed before and passes now. Link real CI results instead of claiming them.
- **Merge danger**: a two-way door can be reverted cheaply; destructive operations, data migrations, public contract changes and hard-to-reverse decisions are one-way doors. Blast radius names the consumers, environments or behaviors that can break.

Adapted 2026-10-03 from Matt Pocock [pr](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/pr/SKILL.md), MIT, whose visual menu credits Dex Horthy's show-me skill (HumanLayer); modified without the glossary dependency.
