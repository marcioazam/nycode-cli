# Design — AGT-04 argv-as-data

Requirements: [specs.md](specs.md). Pesquisa: onda 2 `research.md`.

## Abordagem

Manter o nome `bash` no catálogo desta fatia (GATE-11). Schema pinado
(AGT-03) muda: o pin antigo falha fechado, o que é o reviewable diff.
`sandbox::wrap` passa a receber `&[String]` e anexa o argv ao prefixo de
confinamento, sem `bash -c`.

## Erros

| Condição | Resultado |
|---|---|
| `command` presente | `ToolOutput::error`, sem spawn |
| argv vazio / NUL | recusa |
| `bash`/`sh` + `-c` | recusa |
| metacaracteres no slot | stdout literal |

## Alternativas recusadas

- Quoting (`shell-quote`) — ainda é string de shell.
- Tool `exec` nova no mesmo PR — estoura GATE-11; rename fica para depois.
- Copiar Codex `-lc`.

## Aprovação (SDD-04)

Pendente LGTM humano.
