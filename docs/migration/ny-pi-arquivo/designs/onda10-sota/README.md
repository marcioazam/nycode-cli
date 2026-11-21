# Onda 10 · movimento e design SOTA: catálogo para aprovação

**Status: decidido (2026-11-18); onda 1 aplicada nas extensões, sem commit; onda 2 só com viabilidade lida (ver `PLANO.md`).** Mock: `docs/designs/onda10-sota/proposta.html`.
Régua SOTA (`soteiros`): só release estável, fonte primária lida, data de acesso 2026-11-18. O que não tem fonte
verificada entra como **ideia**, nunca como lacuna.

## Objetivo
Reunir todas as melhorias de animação, design e interação que cabem no TUI do pi-harness numa página HTML com demo
viva por item, para o dono aprovar item a item. A página não muda o TUI; o que for aprovado vira plano depois.

## Aceite
- AC1. `proposta.html` abre offline por `file://`, sem rede e sem erro no console.
- AC2. 25 propostas `P01`–`P25`; cada uma mostra título, antes × depois, demo viva (exceto P23), tipo de evidência,
  custo, fallback, recomendação, fonte com link quando houver, e o controle `Aprovar · Depois · Rejeitar`.
- AC3. Decisões persistem em `localStorage` (`onda10-decisoes`), com contador “N de 25”, filtro por seção e por decisão,
  e botão que copia a lista em Markdown.
- AC4. Chave global de movimento `normal · reduzido · desligado` muda todas as demos; começa em `reduzido` quando o
  sistema pede `prefers-reduced-motion: reduce`; há “pausar tudo”; demo só roda visível.
- AC5. O mock de terminal usa os tokens reais: `pi-noite` no escuro e `pi-claro` no claro (tema do dono `pi-claro/pi-noite`).
- AC6. pt-BR; no máximo 800 linhas por arquivo e 7 arquivos no diretório; foco visível; texto da página ≥ 4,5:1.
- AC7. Só `docs/designs/onda10-sota/` muda.

## O que já existe (não repropor)
Lido no disco em 2026-11-18 (árvore não commitada).
- Relógio único `subscribe120Hz` de 8 ms que desliga sem assinantes (`extensions/ui-visual/motion/motion.ts:15-52`).
- Shimmer gaussiano de 1350 ms na linha de trabalho e no estado `executando` (`motion.ts:100-125`, `working.ts:68-76`).
- Settle flash de 240 ms em `executando → concluído` (`motion.ts:134-150`).
- Cometa na barra do Task, pílulas de atalho/hora (`motion.ts:155-194`), brilho de tecla 165 ms e varredura da
  régua do editor 225 ms (`extensions/ui/editor.ts:354-395`).
- Spinner único braille de 10 quadros a 80 ms; título do terminal estático `●`/`✓` (decisão da Onda 7).
- Estado por nome colorido, hora à direita, `❯`, cursor beam, diff estilo Xcode com palavra alterada (Ondas 7 e 9).
- No pi-tui 1.5.2: saída sincronizada `?2026`, troca de tema por `?2031`, mouse `?1003`, progresso `OSC 9;4` (estado 3).
- Rejeitado antes e mantido fora: exportação DTCG, variante de alto contraste, par claro do `pi-noite`, pulso nos
  blocos de espera do plano, título de aba animado.

## Propostas
Evidência: **código** = lacuna lida no repo; **fonte** = fonte primária verificada; **ideia** = juízo de design sem
fonte verificada. Custo: P (uma extensão, horas) · M (várias, ou invalidação por frame) · G (patch no pi-code).
Rec.: ✔ recomendo · ◐ opcional · ✕ não agora.

### 1. Fundamentos de movimento
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P01 | Um modo de movimento em 3 níveis | dois critérios que divergem: `a11y.ts:14` (`PI_REDUCED_MOTION==='1'`, `NO_PROGRESS`, `TERM=dumb`) e `motion.ts:10-11` (qualquer valor, mais `NO_COLOR` até vazio e `TERM=linux`); só variável de ambiente | uma função e uma chave `movimento: normal\|reduzido\|desligado` (settings + `/movimento`); reduzido tira varredura, cometa e sweep e mantém troca de cor ≤ 200 ms; desligado mostra texto fixo `trabalhando…` | código + fonte (Claude Code `prefersReducedMotion`, Codex `tui.animations`, gh ACCESSIBILITY, WCAG 2.2.2, Apple HIG) | P | ✔ |
| P02 | Cadência adaptativa | 120 Hz (8 ms) para tudo, com ou sem foco | 30 fps nos contínuos, 60 fps só em transições ≤ 300 ms, pausa sem foco (`?1004` já rastreado em `ui/terminal.ts:51`), 15 fps em tmux/SSH | fonte (Codex 32 ms por quadro, Ink `maxFps` 30); medir bytes/s e CPU antes | P | ◐ |
| P03 | Tokens de movimento | constantes soltas em quatro arquivos: 80 ms (`ui/a11y.ts:8`), 165 e 225 ms (`ui/editor.ts:353,361`), 240 ms (`motion.ts:133`, `icons.ts:179`), 1350 ms (`motion.ts:115`), seno `0.0048` (`motion.ts:172`), decaimento quadrático | durações `rápido 120 · padrão 200 · lento 320 · contínuo 1400` e curvas `saída` (ease-out cúbico), `movimento` (in-out cúbico), `contínuo` (linear) num só lugar | fonte (NN/g 100–500 ms, Material 3 tokens, Textual `in_out_cubic`) | P | ✔ |

### 2. Trabalho e estados
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P04 | Shimmer que clareia em vez de apagar | `highlightPeak` (`motion.ts:100-101`) escolhe o pico pela luminância do texto, não do fundo: grafite `rgb(15 23 42)` no pi-noite e branco-gelo `rgb(245 250 255)` no pi-claro, o inverso do comentário da linha 99. No centro da varredura a letra fica entre 1,0:1 e 1,3:1 do fundo (medido em 2026-11-18 chamando a função real com os tokens dos dois temas) | pico é o próprio token clareado em OKLCH, com piso de 3:1 contra o fundo; varredura de 900 ms in-out e pausa de 500 ms | código (medição) + ideia (cadência; Oklab para a mistura) | P | ✔ |
| P05 | Aviso de travamento | spinner igual por minutos sem evento | 10 s sem evento: rótulo `sem resposta há 12s` e spinner vai de `accent` a `warning` em 2 s; volta no próximo evento | fonte (NN/g: 10 s é o limite da atenção) | P | ✔ |
| P06 | Tempo vivo em cada tool | duração só depois de concluir e se ≥ 1 s (`tools.ts:53,213`) | `executando · 14s` no título a partir de 2 s, 1 tick por segundo | fonte (Crush v0.101.0) | P | ✔ |
| P07 | Fundo que transita entre estados | fundo pula de `toolPendingBg` para `toolSuccessBg`; erro não tem sinal de chegada | mistura do fundo em 200 ms ease-out; erro ganha um settle espelhado, uma passada só | ideia | M | ◐ |
| P08 | Barra de progresso sub-célula | `━`/`╌`, passo de 1 célula | oitavos de bloco `▏▎▍▌▋▊▉█` (8 passos por célula) e avanço em 200 ms; cometa só quando não há total | fonte (NN/g: percentual acima de 10 s) | P | ✔ |
| P09 | Dicas rotativas na espera | nada | depois de 5 s, linha dim `dica: ctrl+o abre a saída`, troca a cada 8 s, desligável | fonte (Claude Code `spinnerTipsEnabled`, Gemini `loadingPhrases`) | P | ◐ |
| P10 | Contador de tokens na linha de trabalho | `pensando · 12s · esc interrompe` | `pensando · 12s · ↓ 1,2k · esc interrompe`, números tabulares | ideia | M | ◐ |

### 3. Texto e transcript
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P11 | Streaming suave | texto chega em rajadas | cadência constante que alcança o atraso; últimos ~12 caracteres entram de `dim` a `text` em 150 ms | ideia | G | ◐ |
| P12 | Undercurl em diagnósticos | erro de sintaxe só em cor | sublinhado ondulado colorido (`SGR 4:3` + `58`), fallback sublinhado simples | fonte (kitty underlines; Alacritty 0.11, foot, tmux) | P | ✔ |
| P13 | Caminhos e URLs clicáveis | `OSC 8` só no botão copiar (`code-blocks/blocks.ts:134`) | `caminho:linha` nos títulos de tool e no diff, URLs e `#123`; em tmux depende de `Hls` | código + fonte (OSC8-Adoption, delta) | M | ✔ |
| P14 | Manchete do raciocínio | `raciocínio · clique abre` | a última manchete do raciocínio em itálico dim, troca por mistura de 200 ms | ideia | M | ◐ |

### 4. Cromo, overlays e avisos
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P15 | Aviso com entrada, contagem e saída | aparece e some seco | entra em 160 ms, linha de contagem regressiva, sai em 100 ms | ideia (duração dentro de NN/g 100–500 ms) | M | ◐ |
| P16 | Véu atrás de overlays | transcript igual atrás do overlay | transcript misturado 40% com o fundo enquanto o overlay está aberto | ideia (composição em camadas existe no Lip Gloss v2) | G | ◐ |
| P17 | Sparkline de contexto no HUD | número de contexto | histórico por turno em oitavos de bloco e limiar 70/85% (os do HUD atual, `calm-statusline.mjs:3-4`) com rótulo, não só cor | fonte (WCAG 1.4.1; blocos Unicode) | M | ◐ |
| P18 | Placeholder do prompt | editor vazio sem texto (grep em `ui/editor.ts` e no editor do pi-tui) | dim `Pergunte, ou / comandos · @ arquivos · ! shell`, some na primeira tecla | código | P | ◐ |
| P19 | Abertura do cabeçalho | logo 2×2 aparece seco | revela em 320 ms, uma vez por sessão | fonte (Codex anima a tela de boas-vindas) | P | ◐ |
| P20 | Assinatura no fim do plano | `concluído` igual a qualquer tool | uma varredura de gradiente de 600 ms no título, só em plano ou goal concluído | ideia | P | ◐ |
| P21 | Hover e ponteiro nos clicáveis | pílulas e `clique abre` sem resposta ao mouse | realce no hover e `OSC 22` ponteiro de mão | fonte (kitty ≥ 0.31, Ghostty 1.4) | M | ◐ |

### 5. Terminal
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P22 | Progresso na aba para kitty e iTerm2, com estados | `suportado()` só aceita Ghostty e Windows Terminal (`avisos/progresso.ts:11-16`); só estados 3 e 2 | kitty ≥ 0.47 e iTerm2 ≥ 3.6.6; estado 1 com % quando o Task tem total; estado 4 esperando permissão ou pergunta | código + fonte (kitty changelog 0.47.0, iTerm2, Ghostty 1.2) | P | ✔ |
| P23 | Notificação `OSC 9` de reserva | só `OSC 99` e `777` (`avisos/notificar.ts:36-40`) | `OSC 9` para iTerm2, foot e Windows Terminal, `BEL` por último | código + fonte (Codex prefere OSC 9 e cai para BEL; WezTerm) | P | ✔ |
| P24 | Títulos em escala (`OSC 66`) | H1 do Markdown no tamanho do texto | H1 em 2× | fonte (kitty ≥ 0.40; Ghostty só interpreta); quebra a conta de altura do pi-tui | G | ✕ |

### 6. Revisar o que já anima
| ID | Proposta | Antes | Depois | Evidência | Custo | Rec. |
|---|---|---|---|---|---|---|
| P25 | Brilho de tecla | pinta o último caractere por 165 ms a cada tecla | variantes: manter · só no envio (Enter) · remover | ideia (ação de teclado repetida centenas de vezes por dia não se anima) | P | ◐ só no envio |

Fica como está: spinner braille único, título estático, pílulas, cometa do Task, estado por nome, hora à direita.
Não animar: abrir/fechar tool por tecla, paleta `/`, troca de aba, navegação de lista.

## Vocabulário do mock (linhas reais do TUI)
- Trabalho: `⠹ pensando · 12s · esc interrompe`: spinner em `accent`, texto em `syntaxType`, shimmer só antes do primeiro ` · `.
- Tool: `bash · npm test · executando` + à direita pílula ` ctrl+o abre ` e ` 10:42 `; caixa com fundo do estado;
  estados `executando` (`syntaxType`), `concluído` (`success`), `atenção` (`warning`), `erro` (`error`); corpo com trilho `│` dim e até 5 linhas.
- Task: `━━━━━━╌╌╌╌  3/5  60%`. Usuário: `❯ texto` sobre `userMessageBg` com hora. Editor: régua `─` com nome da sessão em cima e rótulos embaixo.
- Cabeçalho: logo 2×2 `rgb(228 138 122)`, `rgb(79 142 179)`, `rgb(234 182 93)`, versão, `? atalhos · / comandos · ! shell`.

| Token | pi-noite | pi-claro |
|---|---|---|
| bg / text | `#1a1b26` / `#c0caf5` | `#ffffff` / `#1d1d1f` |
| muted / dim | `#a9b1d6` / `#8a93bd` | `#424245` / `#6a6a6f` |
| accent / syntaxType | `#7aa2f7` / `#7dcfff` | `#0066cc` / `#0b4f79` |
| success / error / warning | `#9ece6a` / `#f7768e` / `#e0af68` | `#1d7a34` / `#d70015` / `#8a5a00` |
| border / selectedBg | `#3b4261` / `#283457` | `#c7c7cc` / `#e8f1fd` |
| userMessageBg / customMessageBg | `#262b3f` / `#262734` | `#e0edf9` / `#f2f2f7` |
| toolPendingBg / SuccessBg / ErrorBg | `#242d3c` / `#29302a` / `#3b2934` | `#ebf1f4` / `#eef7f0` / `#fdf1f0` |
| mdCode | `#bb9af7` | `#8944ab` |

## Fontes (verificadas pelos scouts em 2026-11-18)
- Codex, quadro de 32 ms e `Esc to interrupt`: https://github.com/openai/codex/blob/2bdf9617bbf2aeedac065c097a4b524886fb05e1/codex-rs/tui/src/status_indicator_widget.rs
- Codex `tui.animations`: https://developers.openai.com/codex/config-reference · OSC 9 e BEL: https://developers.openai.com/codex/config-file/config-advanced
- Claude Code `prefersReducedMotion`, dicas, progresso: https://code.claude.com/docs/en/settings-reference · tela cheia e tmux: https://code.claude.com/docs/en/fullscreen · acessibilidade: https://code.claude.com/docs/en/accessibility
- Gemini CLI `loadingPhrases`, `showSpinner`: https://geminicli.com/docs/reference/configuration/
- Crush, tempo por tool: https://github.com/charmbracelet/crush/releases
- Ink `maxFps` 30: https://github.com/vadimdemedes/ink · Textual easing: https://textual.textualize.io/guide/animation/
- NN/g limites 0,1/1/10 s: https://www.nngroup.com/articles/response-times-3-important-limits/ · duração 100–500 ms: https://www.nngroup.com/articles/animation-duration/
- Material 3 tokens: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs · Apple HIG: https://developer.apple.com/design/human-interface-guidelines/motion
- WCAG 2.2.2: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html · 1.4.1: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- gh, animação opcional com alternativa em texto: https://github.com/cli/cli/blob/trunk/.github/ACCESSIBILITY.md · NO_COLOR: https://no-color.org/
- kitty changelog (0.50.0 em 2026-11-03; OSC 9;4 em 0.47.0; OSC 66 em 0.40.0; OSC 22 em 0.31.0): https://sw.kovidgoyal.net/kitty/changelog/ · underlines: https://sw.kovidgoyal.net/kitty/underlines/
- Ghostty 1.4.0 e 1.2.0: https://ghostty.org/docs/install/release-notes/1-4-0 · https://ghostty.org/docs/install/release-notes/1-2-0 · iTerm2: https://iterm2.com/3.6/documentation-escape-codes.html
- OSC 8: https://github.com/Alhadis/OSC8-Adoption · delta: https://github.com/dandavison/delta · Oklab: https://bottosson.github.io/posts/oklab/
- Lip Gloss v2.0.0: https://github.com/charmbracelet/lipgloss/releases/tag/v2.0.0 · WezTerm OSC 9/777: https://wezterm.org/escape-sequences.html

## Ambiente do dono (fora do repo, observado em 2026-11-18)
- `kitty 0.45.0`; a barra `OSC 9;4` (P22) precisa de 0.47 ou mais; estável atual 0.50.0.
- `tmux 3.6`; saída sincronizada `?2026` entrou na 3.7; estável atual 3.8.

## Limites
- Sem fonte primária lida: suavização de streaming, contador de tokens, manchete de raciocínio em outros agentes
  (P10, P11, P14 são ideias). opencode, Amp e Warp ficaram sem fonte primária.
- Viabilidade no pi 1.5.2 não foi lida no código para P07, P11, P15, P16 e P21; é o primeiro passo do plano de cada
  item aprovado.
- O mock é HTML: mostra a intenção, não pixels do kitty. Captura real fica para a execução (critério 7 do inventário).
- Sem codegraph neste repo: mapeamento por `rg` e leitura.

## Arquivos
- `proposta.html`: página, decisões e filtros. `proposta.css`: folha. `dados.js`: as 25 propostas e as fontes (única
  origem do conteúdo dos cartões). `demos.js`: motor (um relógio, só o visível) e as demos.

## Verificação (2026-11-18)
Chrome headless dirigido por CDP em `file://`, 1280×900 e 390×844, temas claro e escuro.
- AC1: 0 erros e 0 avisos no console; a página só referencia `proposta.css`, `dados.js` e `demos.js`.
- AC2: 25 cartões `P01`–`P25`, cada um com duas janelas preenchidas (P23 é tabela, sem animação).
- AC3: “Aprovar as recomendadas” marcou 10; com uma rejeição o contador foi a “11 de 25”; o estado e a variante da P25
  voltaram depois de recarregar; o Markdown saiu com os quatro blocos; filtro “Aprovadas” deixou 10 cartões em 4 grupos.
- AC4: em `normal` as demos mudam entre dois quadros; em `desligado` e com “Pausar tudo” ficam iguais; em `reduzido` o
  spinner é `●`; com `prefers-reduced-motion: reduce` a página abre em `reduzido`.
- AC5: fundo do mock `#1a1b26` no escuro e `#ffffff` no claro; nenhuma célula do mock usa transform, opacidade, filtro
  ou transição (0 de todos os elementos em `.term`).
- AC6: maior arquivo com 370 linhas, 5 arquivos; menor contraste de texto da página 7,99:1 no escuro e 6,15:1 no claro;
  sem rolagem horizontal em 1280 e 390; `impeccable detect` e `structure.py` sem achados.
- AC7: `git status` mostra só este diretório como novo.
- Não verificado: Firefox e Safari, leitor de tela, percurso manual por teclado e o desenho real no kitty.

## Achados da construção
- P04 deixou de ser ideia: `highlightPeak` foi chamada com os tokens reais e o pico vai para a cor do fundo nos dois
  temas (por exemplo `executando` no pi-noite: letra central `rgb(28 45 68)` sobre `#242d3c`, 1,00:1).
- Fora do escopo, só calculado: a pílula de hora e de atalho no pi-claro usa `dim` sobre o fundo da caixa escurecido
  8% (`motion.ts:190`), cerca de 3,95:1 sobre `toolPendingBg`. Não virou proposta.
