# Report template

Write in the user's language but keep the `##` headings verbatim: `report_check.py` finds Findings by them. Every finding cites the ids of the `supported` or `partial` ledger rows it asserts, as `[C1]`, plus each row's URL; do not cite from memory.

```markdown
# <question, restated>

**Answer.** 2-5 sentences with the conclusion and its confidence.

**Scope.** Mode, accessed date, assumptions made at scope, what was out of scope.

## Findings
### <section per plan item or perspective>
- <finding> (<confidence>) [C1, C3] — <URL of C1>, <URL of C3>

## Conflicts and open questions
- <claim A> vs <claim B>: which is newer or primary, what would settle it.

## Gaps
- <item or claim> — unverifiable, blocked or never found; what was tried.

## Evidence
| id | claim | URL | quote | provider | verdict |
|---|---|---|---|---|---|

## Method and cost
Agents run (by role), gap rounds, calls per provider, Perplexity calls against the cap, failures and fallbacks, refuted claims dropped.
```

Short questions can collapse Findings into one list and drop empty sections, but keep the `## Findings` heading, Gaps and Evidence.
