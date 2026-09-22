# Ledger GitHub do NyCode

Como projetar o fluxo SOTA-2026 neste repositório sem transformar Issue em
segunda spec. Regras: `SDD-01`–`SDD-16`, `AI-01`–`AI-12`, `CI-03`–`CI-05`.
Guia do padrão pinado: `guides/github-agent-workflow.md` em
`base-software-rules` v1.4.0.

Issue [#70](https://github.com/marcioazam/nycode-cli/issues/70) é o intake
desta adoção.

## Autoridade

Arquivos `docs/specs/` (ou a pasta `changes/`) são o aceite. A Issue
coordena dono, estado e links. Project é vista, não fonte.

## Superfícies deste repo

- Issues: ligadas. Form de história em `.github/ISSUE_TEMPLATE/story.yml`.
- Sub-issues e dependências: REST (`gh api`); o `gh` local 2.46.0 ainda não
  tem `--parent` (isso é ≥ 2.94.0). Neste repo de usuário a rota
  `POST .../issues/{n}/sub_issues` responde 404 — o substituto é Issue filha
  com `Parent: #70` no body (AGT-01..08 = #71–#78).
- Issue types: indisponíveis em conta pessoal — usar labels.
- Wiki: desligada (`has_wiki=false`) para não virar segundo spec.
- Fila de merge: **não se aplica**. GitHub só oferece fila em repositório
  público de **organização**. Este repo é `marcioazam/nycode-cli`. Substituto
  local: 12 checks obrigatórios + `strict` (ADR-0034). O workflow já escuta
  `merge_group` para o dia em que o repo migrar.
- Project “NyCode harness”: criar exige `gh auth refresh -s project`. Sem
  esse scope, a Issue basta.

## Issue antes de `/plan`

Se faltar Issue ou requisitos aprovados, parar. Shape:

```markdown
Authority: intake snapshot; superseded by approved requirements when linked below.

## Outcome
…

## Story
Como <ator>, quero <capacidade>, para <valor>.

## Acceptance
- Given … when … then …
- Failure path: …

## Non-goals
- …

## Risk and ownership
- Critical path: sim/não
- Owner: @marcioazam

## Durable artifacts
- Requirements / Design / Tasks: link ou pending
```

Depois da aprovação, substituir Acceptance/Non-goals pelo link do arquivo.
Não manter duas listas.

## PR

Ver `.github/PULL_REQUEST_TEMPLATE.md`. `Assisted-by` fica no commit, não
no body. Agente não aprova nem mergeia o próprio PR (`AI-03`).

## Progresso

Um comentário por item, atualizado só em transição:

```markdown
<!-- agent-progress:<id> -->
State: requirements | design | tasks | implementation | review | blocked
Completed: …
Blocker/decision: none | …
Next: …
Updated: <UTC>
```
