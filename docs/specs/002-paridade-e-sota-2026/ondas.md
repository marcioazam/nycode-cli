# Ondas 2–5 — fatiamento em PRs

A Frente 0 fechou o instrumento. O estado de cada delta vive na
[`traceability.md`](traceability.md); este arquivo só parte as ondas em PRs
que cabem no teto GATE-11 (400 linhas, 15 arquivos). Não duplica estado.

## Onda 2 — contexto e ferramentas

Ordem travada pelo [`plan.md`](plan.md): transformação de mensagem **antes**
da compactação por limiar. Compactar um histórico com chamada órfã produz
resumo de um estado que nunca existiu — falha silenciosa, não erro de build.

| PR | Deltas | Nota |
|---|---|---|
| 2.1 | A6, B13, B14 | Descarte de turno com erro/cancelamento; resultado sintético para chamada órfã |
| 2.2 | B15, B16 | Imagem em modelo sem visão; raciocínio cross-model vira texto |
| 2.3 | A4, C4, B9 | Compactação por limiar; estimativa ancorada no último usage |
| 2.4 | B10, B11, B12 | Resumo com seções; marcador autocontido; sumarização de ramo |
| 2.5 | B17, B18, B19 | `edit` disjunto; `bash` com prazo; `read` de imagem |
| 2.6 | B20, B21, B22 | Teto de `grep`/`find`/`ls`; `terminate`; direcionar vs enfileirar |
| 2.7 | B23, B24 | Instruções ancestrais; Agent Skills completo, skill não invocável |
| 2.8 | C6 | Consentimento MCP fixa a definição declarada (ADR-0028). Revisão adversarial em contexto limpo **antes** do commit |

B8 ficou na Onda 3; B9 veio para cá — a rastreabilidade vence o `plan.md` nesse ponto.

## Onda 3 — superfície de comando

Depende da Onda 2. Um PR por grupo de flags, não um PR com B8+B25–B31:

| PR | Deltas |
|---|---|
| 3.1 | B8, B25 | `tool_choice` canônico e restrição de ferramentas por nome |
| 3.2 | B26 | System prompt substituível e acrescentável |
| 3.3 | B27, B28 | Sessão nomeada, bifurcada, importada; estatísticas e recarga |
| 3.4 | B29, B30, B31 | Shell do usuário; ambiente de sessão; argumentos de prompt |

## Onda 4 — ACP

Independente. Um PR (C5) sob as restrições do ADR-0029: o cronograma é o do
protocolo, não o nosso. Não inventar cliente enquanto o SDK Rust do ACP não
cobrir o que a spec pede.

## Onda 5 — TUI

Independente. B36 (temas) entra aqui, não no roadmap de produto genérico.

| PR | Deltas |
|---|---|
| 5.1 | B32, B33 | Autocomplete e localizador aproximado |
| 5.2 | B34, B35 | Colagem grande, anel de corte; atalhos remapeáveis |
| 5.3 | B36 | Temas |
| 5.4 | B37, B38, B39 | Markdown rico; hiperlink/progresso/clipboard; imagem no terminal |

Cada PR fecha com chamador de produção para símbolo público novo (NFR-2
local) e `scripts/ci-local.sh --full` verde.
