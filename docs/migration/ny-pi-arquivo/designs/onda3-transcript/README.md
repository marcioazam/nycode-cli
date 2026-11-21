# Onda 3 · transcript e tools

**Status: fase 1 aplicada (2026-11-14), sem commit.** Proposta com auditoria C01–C20 e antes/depois: `docs/ui-ux-gallery/proposta-onda3.html` (os "depois" dela são mocks). Capturas reais do que foi aplicado: `real-*.png` (reproduzir: `node docs/designs/onda3-transcript/check.mjs`).

## Objetivo
Transcript fácil de achar e compreender: uma linha por ação, estado no glifo e não no fundo, colunas fixas, português, detalhe sob demanda.

## Decisão do dono (2026-11-14)
Primeiro pediu auditoria e um exemplo HTML para avaliar. Depois: "Execute as melhorias propostas".

## Fase 1: o que entrou
| # | Item (ID) | Antes | Depois | Onde |
|---|---|---|---|---|
| 1 | Chrome de tools (C01, C20) | caixa com fundo verde/vermelho, 5 linhas por chamada | sem caixa (`renderShell: 'self'`), 1 linha: `estado verbo  alvo ……… resumo · tempo` | `extensions/ui-visual/tools.ts` |
| 2 | Chamadas consecutivas (C01) | linha em branco antes de cada tool | coladas; só a primeira do grupo mantém o respiro | `extensions/ui-visual/compact.ts` |
| 3 | Ícone por tool (C03) | estado + ícone + nome | estado + verbo em coluna de 5 | `tools.ts` |
| 4 | Duração (C01) | sempre, inclusive `0.0s` | só a partir de 1 s | `tools.ts` (`MIN_DURATION_MS`) |
| 5 | Resumo | linha própria abaixo | à direita da chamada, linha limitada a 100 colunas | `tools.ts` (`rightOf`, `MAX_ROW`) |
| 6 | Erro de bash | `Command exited with code 3` em linha própria | `código 3` / `tempo esgotado` / `interrompido` à direita, em `error` | `tools.ts` (`bashStatus`) |
| 7 | Clamp de bash (C18) | `[Output clamped: showing…` em inglês, cortado por `…` | `⋯ 395 linhas acima · log completo: <caminho>` no topo do preview; total à direita | `tools.ts` (`bashPreview`) |
| 8 | Saída escondida | preview sem aviso | `⋯ N linhas acima` | idem |
| 9 | Expandido (C04) | texto cru sem recuo; erro com linhas em branco (bug, abaixo) | render nativo recuado sob o verbo | `tools.ts` (`native`, `indented`) |
| 10 | Fundos (C20) | `toolPendingBg/SuccessBg/ErrorBg` coloridos, `customMessageBg` roxo | tools com caixa (todo, subagent, question, web) no fundo base; mensagens custom em `bgDark` | `themes/tokyo-night.json` |
| 11 | `grep x in src` | inglês | `em` | `tools.ts` |

> **Substituído (2026-11-14, pedido do dono depois da Onda 7: "gosto de bg como era antes e ícones… minimalistas e modernos"):** itens 1, 3 e 10. As tools voltam a usar a caixa nativa com fundo tingido por estado (`toolPendingBg/SuccessBg/ErrorBg` medidos ≥ 4,5:1) e ganham ícone Codicons por ferramenta, inclusive as que não são do harness (todo, subagent, question, web…). Continua valendo: uma linha por chamada, resumo à direita, português e duração só a partir de 1 s. Registro: `docs/designs/onda7-tokens/README.md`.

> **Substituído (2026-11-14, pedido do dono):** "resumo à direita". O resumo e a duração ficam colados ao alvo, à esquerda, após um `·` discreto (`bash  comando · código 1 · 1.2s`); a linha não é mais preenchida até a borda. Código: `extensions/ui-visual/tools.ts` (`callComponent`).

> **2026-11-14, variante 1 com fundo (escolha do dono em `docs/designs/bash-output/variantes.html`):** mantém fundo, ícones e o `│` da saída do bash; o bash ganha o total de linhas no cabeçalho (`· 7 linhas`) e a saída em vermelho quando falha. Correção: o pi 1.5.2 não chama `setArgsComplete` ao reconstruir o histórico, então `write  …` aparecia sem caminho; agora `…` só enquanto não há resultado.

### Bug corrigido no caminho
Os renderers nativos reaproveitam `context.lastComponent` (`lastComponent ?? new Text()` + `setText`). O pi entrega ali o componente que a extensão devolveu por último; o nativo quebrava e o pi caía no texto cru (visível na captura 06 da galeria: sem recuo, sem cor de erro, linhas em branco). Agora o nativo recebe o componente que ele mesmo criou, guardado em `context.state.uiNative`. Teste vermelho antes da correção: `text.setText is not a function`.

## Contratos de teste que mudaram (antigo → novo)
- Cabeçalho `✓ ▤ read src/a.ts` → ` ✓ read   src/a.ts` (recuo `outputPad`, sem ícone, verbo em 5 colunas).
- Duração sempre à direita (`0.4s`) → só ≥ 1 s.
- Resumo em linha própria (`  3 linhas`) → no fim da linha da chamada.
- Erro: manchete `  Command exited with code 2` + saída → `código 2` à direita + saída sob `│`.
- `grep foo in src` → `grep   foo em src`.
- Nativo (expandido, diff do edit) sem recuo → recuado 2 colunas além do `outputPad`, sem linhas em branco iniciais.
- Testes de alinhamento usam o tema ANSI: o tema de tags visíveis conta as tags como largura.

## Fora da fase 1 (não aplicado)
| Item | Por quê |
|---|---|
| todo em lista única (C08), subagent (C06), question (C07), goal (C09), web (C19) | vivem no pacote `pi-code`, que já recebe patches (`todo-collapse`, `subagent-render`); mexer exige ler e conviver com esses patches |
| Thinking com rótulo e duração (C05), Markdown/tabela/cercas (C10, C11), numeração do diff (C13) | render nativo do pi; só com patch no core |
| "Tool output: expanded" em inglês no transcript (C04) | string do core (`interactive-mode.js`, `showStatus`) |
| Nível Foco, rodapé de turno, índice de turnos (ctrl+g) | recursos novos; viabilidade no TUI não verificada |
| Imagem com dimensões (C16), abrir imagem (C17), /diff (C14) | não tocados |
| Tema `mono` | já não tem fundos |

## Riscos e limites conhecidos
- **Colagem das tools**: `compact.ts` acha o contêiner do chat pela forma (filho direto com `toolCallId`) e troca o `render` dele por uma cópia de `Container.render` do pi-tui 1.5.2 que omite a linha em branco. Se outra extensão já trocou esse `render`, ou se o pi mudar a forma, nada é embrulhado e cada tool volta a ter a linha em branco (2 linhas por chamada). A primeira tool de uma sessão aparece antes do embrulho; como ela nunca é colada, não há salto.
- **Clique**: a tool colada recebe o clique com o deslocamento da linha removida (testado em unidade, não com mouse real).
- **Expandido**: o conteúdo é do pi (`Command exited with code 3`, `Took 0.0s`, linhas em branco do bash): continua em inglês.
- `extensions/` e `themes/` são o que o pi do usuário carrega por symlink: vale para toda sessão nova. `compact.ts` e o teste dele ganharam symlink em `~/.pi/agent/extensions/ui-visual/` e entrada em `publish.list`.
- `tools.ts` e o teste já tinham mudanças não commitadas de outra sessão (`fit`); as duas convivem no arquivo.
- Voltar atrás: remover `renderShell: 'self'` de `wrap` e `compact` de `index.ts` devolve a caixa; os quatro tokens de fundo estão no diff do tema.

## Evidência
- `node --experimental-strip-types --test extensions/ui-visual/test/*.test.ts extensions/bash-clamp/*.test.ts extensions/sticky-prompt/*.test.ts extensions/up-dequeue/*.test.ts extensions/ui/test/*.test.ts`: 145 passam, 0 falham (43 em `ui-visual`, 6 novos em `compact.test.ts`).
- `node docs/designs/onda3-transcript/check.mjs` (kitty real em Xvfb, pi 1.5.2, provider fake): `real-tools.png` (8 chamadas, uma linha cada, coladas), `real-tools-expandidas.png` (nativo recuado), `real-clamp.png` (aviso de clamp em português, caminho inteiro).
- `scripts/check-refs.py` e `scripts/check-leaks.sh` falham por achados que já existiam em `docs/ui-ux-gallery/shots.json` e `docs/ui-ux-inventory.md`; nenhum nos arquivos desta onda.
- Não rodado: suíte completa do repositório, `scripts/test_install.sh`, clique com mouse real, tema claro, terminais além do kitty.
