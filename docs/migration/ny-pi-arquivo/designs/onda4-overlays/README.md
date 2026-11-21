# Onda 4 · overlays e comandos — proposta “Uma folha”

**Status: aplicado em parte (2026-11-14), sem commit.** Itens 2, 4, 5 e 7 no código (seção “Execução”); itens 1, 3 e 6 seguem como proposta. Exemplo com antes/depois: `proposta.html` (os “depois” são mocks em HTML; as capturas reais são os `real-*.png`).

## Objetivo
Seletores, confirmações, telas de informação e mensagens de comando (D01–D28) minimalistas, fáceis de achar e de entender, com uma visão de gestão do que está ligado.

## Pedido do dono (2026-11-14)
Pesquisar, auditar a Onda 4 e trazer um exemplo em HTML para avaliar a mudança. Aplicar depende de aprovação.

## Auditoria (capturas de `docs/ui-ux-gallery/images`)
| # | Achado | Capturas |
|---|---|---|
| 1 | Nove contêineres diferentes para a mesma função | 20, 21, 95, 24, 312, 23, 211, 200, 104, 22 |
| 2 | Três marcadores de seleção (`→`, `›`, `>`); `✓` ora é “em uso”, ora “habilitado” | 20, 21, 203, 23, 24, 211, 91 |
| 3 | Cinco gramáticas de rodapé de teclas | 20, 21, 203, 312, 211 |
| 4 | Telas de informação sem título, moldura, ação nem fechamento | 104, 106, 107, 212, 213, 214, 261 |
| 5 | Confirmação de risco com “Yes” pré-selecionado, botões “Yes / No”, texto todo roxo | 203, 206, 302, 95 |
| 6 | Teclas demais antes do conteúdo | 24, 23 |
| 7 | `/hotkeys` como tabela de bordas grossas impressa na conversa | 22 |
| 8 | Inglês dentro de um cromo em português | todas |
| 9 | Caminho absoluto longo como conteúdo principal | 106, 212 |
| 10 | Avisos empilhados em cores diferentes; seletores sem título | 21, 20 |

Conferido por um revisor separado (`ux-reviewer`) que abriu as 34 capturas. A preservar: régua fina sem caixa, busca ao digitar, descrição do item em `/settings`, escopo em `/resume`, diálogo do LSP (262), `/session` (26).

## As 6 regras
1. Uma folha só: mesmo lugar, duas réguas, título na régua de cima, resumo à direita.
2. Uma gramática de linha: `❯` + fundo = ativo; `✓` + palavra = em uso; valor à direita; grupos com rótulo.
3. Um rodapé, no máximo quatro teclas; o resto atrás de `?`.
4. Confirmação diz o risco e o verbo; a opção segura vem primeiro e selecionada; Esc é a opção segura.
5. Informação vira painel de gestão: título, número, grupos, estado com glifo e palavra, próxima ação.
6. Português, e estado nunca só por cor.

## Itens e recomendação
| # | Item | Onde mexe | Risco | Recomendo |
|---|---|---|---|---|
| 2 | Visão geral `/painel` (novo) | extensão nova do harness | baixo | primeiro |
| 7 | Mensagens do harness | `extensions/*` | baixo | aplicar |
| 4 | Confirmações | pi-code e core (`/trust`) | médio | aplicar (segurança) |
| 5 | Painéis de gestão | pilha de patches do pi-code | médio | aplicar |
| 6 | Atalhos em painel | comando nativo → painel de extensão | médio | aplicar |
| 3 | Seletores nativos | core do pi (`showSelector`) | alto | decidir depois |
| 1 | Central de comandos agrupada | autocomplete nativo | alto | decidir com o 3 |

O risco vem da origem de cada tela em `docs/ui-ux-inventory.md`. **A viabilidade no código não foi verificada**: é o primeiro passo do plano.

## Execução (dono: “execute”, 2026-11-14)
Viabilidade lida no código (pi 1.5.2, pi-code 1.7.0):
- Comando com nome repetido não substitui o outro (`runner.js:564-592`: os dois viram `nome:N`); comando nativo roda antes de qualquer extensão (`interactive-mode.js:2648`). Logo `/context`, `/memory`, `/hooks`, `/agents`, `/hotkeys`, `/trust` não podem ser substituídos por extensão.
- `ui.confirm` tem `Yes`/`No` fixos e nasce em `Yes` (`interactive-mode.js:2278`), sem parâmetro de rótulo.
- `ctx.ui` é um objeto único (`runner.js:355-368`, `625-628`): dá para embrulhar `confirm` e `notify` nele, como `up-dequeue` embrulha o `render` da fila.

Plano (uma extensão nova, `extensions/folha/`, desligada com `PI_FOLHA=0`):
| Unidade | O que faz | Aceite |
|---|---|---|
| U1 confirmações (item 4) | embrulha `ui.confirm`: usa `ui.select` com a opção segura primeiro, rótulos com verbo e título em português; título desconhecido vira `Não` / `Sim`; erro cai no confirm nativo | Enter sem mover devolve `false`; só o rótulo de ação devolve `true`; Esc devolve `false` |
| U2 painéis (item 5) | embrulha `ui.notify`: a saída de `/context`, `/memory`, `/agents`, `/hooks` abre numa folha que fecha com Esc; texto que não casa segue nativo | cada formato real vira título, resumo, grupos e linhas; formato desconhecido não é tocado |
| U3 `/painel` (item 2) | folha com modelo, contexto, permissões, confiança e atalhos para os gerenciadores; Enter leva o comando ao campo | linhas montadas só de dados da API; sem dado, sem linha |
| U4 mensagens (item 7) | `/bypass`, `/pi-docs`, `/rename` em português com o próximo passo | testes dos textos |

Fora desta execução: visual da confirmação (título e corpo seguem no estilo do seletor nativo; só ordem, rótulos e título mudam), corpo das confirmações em inglês, `/hotkeys` (item 6: nativo; um `/atalhos` duplicaria o comando), `/mcp` e `/tasks` com execuções (telas próprias), itens 1 e 3.

### Resultado (2026-11-14, sem commit)
Aplicado: U1 a U4. Extensão em `extensions/folha/` (5 arquivos, maior com 117 linhas), ligada em `~/.pi/agent/extensions/folha` por links; vale na próxima sessão do pi. Desliga com `PI_FOLHA=0`.

Evidência:
- Testes: `node --experimental-strip-types --test extensions/folha/test/*.test.ts extensions/ui/test/*.test.ts extensions/pi-docs/index.test.ts extensions/up-dequeue/index.test.ts extensions/dev-commands/test/*.test.ts` → 133 passam, 0 falham.
- Confirmação, vermelho e verde: com a ordem das opções invertida em `confirm.ts`, 6 testes falham; com a ordem certa, 9 passam.
- Capturas reais (`node docs/designs/onda4-overlays/check.mjs`, kitty + pi 1.5.2 + pi-code 1.7.0, provider falso): `real-painel.png`, `real-painel-enter.png` (Enter leva `/context` ao campo), `real-context.png`, `real-memory.png`, `real-agents.png`, `real-hooks.png`, `real-confirmar.png` (nasce em `Não executar`), `real-confirmar-enter.png` (Enter direto: `resposta: false`), `real-confirmar-acao.png` (↓ Enter: `resposta: true`), `real-bypass-status.png`.
- Testes mudados por contrato novo de texto: `pi-docs/index.test.ts:67` e `ui/test/editor.test.ts:128` (mensagens agora em português).

Não verificado: `/trust` nativo e as confirmações de imports e de hooks em uso real (só o caminho `ui.confirm` com o texto de agentes do projeto); leitor de tela; `NO_COLOR`; terminal com menos de 80 colunas; `/bypass` segue sem teste automático (só captura).
Risco: a folha depende do texto de saída do pi-code 1.7.0; se o formato mudar, a saída volta ao aviso nativo (testado). Em `/hooks`, um comando que termine em ` (palavra)` tem esse final lido como origem.

## Limites conhecidos
- Mocks mostram disposição e texto, não pixels do kitty; largura estreita e `NO_COLOR` não foram desenhados.
- A opção segura pré-selecionada, o `/painel` e as teclas atrás de `?` são decisão de desenho, não regra de fonte externa.
- Traduzir os 33 rótulos de `/settings` e as descrições dos comandos nativos tem custo de manutenção a cada versão do pi.
- Fora: D09 `/login`, D10 onboarding, D12, D18.

## Evidência
- `proposta.html` aberta no Chrome (2026-11-14) em 1366 px e 390 px, claro e escuro: sem rolagem horizontal da página, 15 imagens carregam, console limpo, todas as linhas dos mocks com 88 colunas, demo testada (filtro, acento, vazio, ↑↓, Enter, Esc, clique).
- Contraste computado: página 16,2:1 (texto), 6,8:1 (secundário), 6,4:1 (link); terminal 10,6 / 8,1 / 5,7:1; na linha selecionada 6,8 / 5,2:1.
- Não executado: `forced-colors`, leitor de tela, teclado físico, teste em Safari e Firefox.
- `.impeccable/config.json`: ignora `low-contrast` só neste arquivo (o scanner estático lê `light-dark()` como preto sobre escuro).

## Pesquisa
Fontes e o que ficou sem verificar: fim de `proposta.html`. Dois agentes independentes (Perplexity + Keenable; Parallel + Exa), ambos com orçamento esgotado antes de cobrir tudo.
