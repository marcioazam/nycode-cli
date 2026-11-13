---
description: "Revisão de PR/diff por aspectos (code, tests, errors, comments, types, simplify) com revisores especializados em paralelo"
disable-model-invocation: true
argument-hint: "[aspectos: code tests errors comments types simplify all] [sequential]"
---

<!-- Porte para o pi (2026-11-11) do /pr-review-toolkit:review-pr (plugin desligado no Claude, Apache-2.0). Os 6 agentes
do plugin viraram prompts de referência em claude-home/vendor/pr-review-toolkit/agents/ (não registrados, para não mudar
o roster); cada aspecto roda num agente do pi que segue o prompt do plugin. O pi não tem modelo por chamada: os
revisores herdam o modelo da sessão. Mudanças: paralelo por padrão (o original era sequencial), `simplify` só edita
quando pedido explicitamente e depois da revisão, e todo achado precisa de arquivo:linha. -->

Aspectos pedidos: `$ARGUMENTS` (vazio = `all`).

## 1. Escopo (somente leitura)

- `git status --short`, a base (`git symbolic-ref --short refs/remotes/origin/HEAD`, sem o `origin/`; sem remoto,
  `main`) e o diff `git diff <base>...HEAD` mais as mudanças não commitadas (`git diff HEAD`).
- `gh pr view --json number,title,body,url 2>/dev/null` (há PR? título e descrição dão a intenção).
- Arquivos de instrução que valem para os arquivos mudados: `AGENTS.md`/`CLAUDE.md` da raiz e dos diretórios deles.
- Diff vazio: diga "Nada para revisar" e pare.

## 2. Aspectos aplicáveis

| Aspecto | Quando roda (em `all`) | Agente do pi | Prompt do plugin a seguir |
|---|---|---|---|
| code | sempre | `code-reviewer` | `vendor/pr-review-toolkit/agents/code-reviewer.md` |
| tests | arquivos de teste mudaram, ou código sem teste novo | `test-reviewer` | `.../pr-test-analyzer.md` |
| errors | mudou try/catch, retorno de erro, fallback, retry | `reliability-reviewer` | `.../silent-failure-hunter.md` |
| comments | comentários ou docstrings adicionados/alterados | `code-reviewer` | `.../comment-analyzer.md` |
| types | tipos, interfaces, structs ou schemas novos/alterados | `code-reviewer` | `.../type-design-analyzer.md` |
| simplify | **só se pedido por nome** (edita código) | `swarm-worker` | `.../code-simplifier.md` |

(`vendor/` = `~/.pi/agent/claude-home/vendor`.) Aspecto pedido por nome roda mesmo fora da condição.

## 3. Revisão

Despache os aspectos de revisão num único `subagent` com `tasks` (paralelo; com `sequential` nos argumentos, um por
vez). Cada brief, autocontido: o repositório, a base, a lista de arquivos mudados, o título e a descrição do PR, os
arquivos de instrução aplicáveis, e: "Leia `<prompt do plugin>` e siga-o como suas instruções de revisão; onde ele
cita o Task tool ou outros agentes, ignore. Somente leitura: não altere arquivos. Só problemas no código mudado.
Cada achado: severidade (critical / important / suggestion), `arquivo:linha`, problema, por que importa, correção
sugerida. Termine com os pontos fortes que viu."

## 4. Consolidação

Descarte achados sem `arquivo:linha`, pré-existentes ou duplicados (mantenha um, citando os agentes). Responda:

```markdown
# Resumo da revisão
## Críticos (N)
- [agente] descrição [arquivo:linha]
## Importantes (N)
## Sugestões (N)
## Pontos fortes
## Próximos passos
1. Corrigir os críticos  2. Os importantes  3. Avaliar as sugestões  4. Rodar /review-pr de novo
```

## 5. simplify (só quando pedido)

Depois da revisão, e só se não houver crítico aberto: `subagent` `{agent: "swarm-worker", task: ...}` com os arquivos
mudados como arquivos donos, "leia `vendor/pr-review-toolkit/agents/code-simplifier.md` e
`~/.pi/agent/claude-home/skills/code-simplification/SKILL.md`; simplifique só o código mudado, sem mudar
comportamento, e rode os testes do projeto antes de devolver". Mostre ao usuário o diff resultante.
