# Onda 7 · tokens de design

**Status: aplicado (2026-11-14), sem commit.**
- Proposta interativa: `proposta.html`. Para abrir já num estado: `?pal=claro&cor=off&ico=ascii&lar=60`.
- Capturas reais do que foi aplicado: `real-{escuro,claro}-{tools,todo,markdown,trabalhando}.png`. Para reproduzir: `node docs/designs/onda7-tokens/check.mjs`.

## Objetivo
Os tokens G01–G14 (cores, fundos, bordas, espaçamento, ícones, animação, a11y) ficam com visual minimalista no estilo Apple, fáceis de achar e entender. São quatro camadas: paleta → 13 papéis → 56 tokens do pi → componentes. Todo contraste é medido, e só uma coisa se move na tela.

## Decisão do dono (2026-11-14)
“execute” sobre a tabela “O que decidir”, ou seja, com as recomendações:
- **1b:** o par `pi-claro/pi-escuro`.
- **De 2 a 6:** claro/escuro automático, raciocínio com 3 cores, um só movimento, ASCII real com `NO_COLOR` desacoplado dos glifos, e portão de contraste como teste.
- **Recusadas, 7 e 8:** exportação DTCG e variante de alto contraste.

Isso **substitui** a decisão de tema da Onda 1 (marcada em `docs/designs/onda1-cromo/README.md`).

## Aplicado
| Item | Antes | Depois | Onde |
|---|---|---|---|
| Tema ativo | `tokyo-night` | `"theme": "pi-claro/pi-escuro"`: o pi escolhe pelo fundo que o terminal reporta (OSC 10/11) e acompanha a troca (modo 2031) | `~/.pi/agent/settings.json`, `settings.json.example` |
| Temas novos | — | `pi-claro.json` e `pi-escuro.json`: 20 vars (papéis) → 56 tokens; fundos de ferramenta `""` (fundo do terminal) | `themes/`, `publish.list`, links em `~/.pi/agent/themes/` |
| `tokyo-night` (rollback) | 9 pares abaixo do mínimo; 3 vars mortas; `border` ≈ `borderMuted`; raciocínio com 7 cores | contraste corrigido; 7 vars mortas removidas; separador único; raciocínio com 3 cores. Mapeamento oficial do tokyonight.nvim preservado (keyword, link, bullet, código, operador), como exige `terminal-sota/gate.sh` item 4 | `themes/tokyo-night.json` |
| G07 espaçamento | `editorPaddingX` 0 | 1 | settings |
| G09 ícones | `PI_ASCII_ICONS` devolvia Unicode; `NO_COLOR` desligava a Nerd Font | conjunto ASCII real (`+ x * > $ ~ …`) com `PI_ASCII_ICONS`, `TERM=dumb` ou `TERM=linux`; `NO_COLOR` só tira a cor | `extensions/ui-visual/icons.ts` |
| G10 animação | braille de 8 quadros (indicador) + braille de 10 quadros reescrevendo o título a cada 90 ms | um spinner só, braille de 10 quadros a 80 ms (`FRAMES` em `a11y.ts`); título estático `●` | `working.ts`, `terminal.ts`, `a11y.ts` |
| G11 movimento | `PI_REDUCED_MOTION`, `NO_PROGRESS` | + `TERM=dumb` | `extensions/ui/a11y.ts` |
| G13 portão | nenhum | teste que falha com par de texto < 4,5:1 ou controle < 3:1 em qualquer tema; tema escuro também medido sobre o fundo do kitty do dono (`#1a1b26`) | `extensions/ui-visual/test/theme-contrast.test.ts` |

Achado na captura real e corrigido: o rótulo de linguagem dos blocos de código ("ts", "diff") é desenhado com `mdCodeBlockBorder`, que portanto conta como texto. O token passou para o papel terciário e entrou no teste.

## Ajuste pós-aplicação (2026-11-14, pedido do dono)
"Achei muito minimalista esta parte; gosto de bg como era antes e ícones no que fez: todo um ícone, bash outro… minimalistas e modernos."

| Item | Antes | Depois | Onde |
|---|---|---|---|
| Fundo das tools | sem caixa (`renderShell: 'self'`, Onda 3); temas com `tool*Bg` vazios | caixa nativa do pi (Box, `tool-execution.js:52,213-223`), com fundo tingido por estado: pendente neutro, sucesso verde, erro vermelho. Todo texto ≥ 4,5:1 sobre os três fundos (pares no teste de contraste) | `tools.ts`, `themes/*.json` |
| Ícones | só estado (`✓`), sem ícone por tool; tools de fora do harness sem ícone | um Codicon por ferramenta (família do VS Code, traço fino): file, terminal, edit, new_file, search, search_fuzzy, folder_opened, checklist (todo), hubot (subagent), question, globe (web/MCP de busca), bookmark (memory), symbol_class (lsp), map (plan), play (run) e tools (padrão). Fallback Unicode/ASCII. Vale também para todo, subagent, question, MCP… via `toolIcon` + `withIcon` (só prefixa o `renderCall`) | `icons.ts`, `tools.ts` |

O `edit` continua sem caixa: o renderer nativo dele desenha o diff no próprio shell, igual a antes da Onda 3. Os codepoints vêm do `glyphnames.json` v3.4.0 do Nerd Fonts e foram conferidos com `fc-list :charset=` na JetBrainsMono Nerd Font Mono. Substitui os itens 1, 3 e 10 da Onda 3, marcados no README dela.

Contrato de teste: o cabeçalho ` ✓ read   src/a.ts` virou `✓ <ícone> read   src/a.ts`, porque o Box aplica o `outputPad` e o ícone é novo. O detalhe agora é recuado em 4 colunas, sob o verbo. O resolver deixou de devolver `next()` para ferramentas desconhecidas: embrulha a base, mantendo os campos dela. Vermelho observado pelo worker: 15 falhas; depois, verde.

## Diff do edit no estilo Xcode (2026-11-14, escolha do dono: exemplo 1 de `exemplos/diff-exemplos.html`)
- **Renderer:** `extensions/ui-visual/diff.ts` substitui o diff nativo do `edit`, colapsado e expandido.
- **Linha:** número em dim, barra `▎` verde ou vermelha, fundo de linha inteira `toolSuccessBg`/`toolErrorBg`, realce de sintaxe (`highlightCode`) e `⋯` no lugar de `...`.
- **Ênfase de palavra:** pares N:N, LCS de tokens com teto de 40.000. O fundo forte mistura 30% da cor do diff com o fundo da linha, e o texto dentro dele fica em `text`. Contraste medido: escuro 7,5/9,0; claro 10,1/8,9; tokyo 4,6/5,7.
- **Sem cor:** `+`/`-` no lugar da barra.
- **Fallback:** se o desenho lançar exceção ou o diff vier vazio, volta o nativo.
- **Testes:** `test/diff.test.ts` é novo, com 14 casos. Em `tools.test.ts`, o edit com diff deixou de esperar `native-result` e passou a esperar as linhas inline. `index.test.ts` passou a copiar `diff.ts`.

### Ajuste: caixa neutra e numeração (2026-11-14, pedido do dono: "edit com fundo bg, porém não verde, senão confunde")
- **Caixa do `edit`:** o `edit` pinta a própria caixa (`renderShell: 'self'`, `boxed` em `tools.ts`). O fundo é `toolPendingBg` (neutro) tanto em pendente quanto em sucesso, e `toolErrorBg` em erro. Tem recuo `outputPad` e uma linha de respiro acima e outra abaixo. Verde e vermelho ficam só nas linhas mudadas.
- **Numeração:** o diff do pi numera o contexto pelo arquivo antigo e as linhas adicionadas pelo novo, o que gerava `6, 6` e `15, 14, 15`. Agora o contexto mostra o número no arquivo novo: antigo + (adicionadas − removidas), acumulado através dos `...`.
- **Testes:**
  - Vermelho observado: 10 falhas.
  - Asserção alterada: `renderShell` do `edit` passou de `undefined/'default'` para `'self'`.

## Mensagens do usuário e caixa da compactação (2026-11-14)
- **Pedido do dono:** "isso não vai confundir com minhas msg que têm o mesmo bg?". Era verdade: `customMessageBg` = `userMessageBg` (`#2c2c2e` / `#f2f2f7`). Escolhida a variante B de `exemplos/sinais-variantes.html#comp3`.
- **Fundo das suas mensagens:** `userMessageBg` virou um tom de 12% do azul da borda, `#202b39` no escuro e `#e0edf9` no claro. Texto 13,2 / 14,2; o pior par é `dim` no claro, com 4,52. Um teste novo exige `userMessageBg` ≠ `customMessageBg`, `toolPendingBg` e `selectedBg`.
- **Fundo das suas mensagens, escuro (2026-11-14, substitui `#202b39`):** `#243246`, o tom mais claro que mantém `dim` ≥ 4,5:1 no teste de contraste (4,52). A faixa se destaca mais do fundo `#1c1c1e` (1,31:1 contra 1,19:1); o texto fica em 11,9:1. Preto com letra branca foi descartado: 21:1 de texto, mas a faixa quase some contra o fundo (1,23:1) e branco puro em preto puro cansa.
- **Caixa da compactação, versão final (variante 1 de `exemplos/sinais-variantes.html#comp4`, escolhida pelo dono):** no ritmo das tools, no fundo neutro `toolPendingBg`: `✓ ⟲ compactar  252 mil → ~18 mil tokens · 14 lidos, 6 editados`, com `12:07 · ctrl+o` à direita. Aberta, o resumo em pt-BR fica recuado com `│`, como a saída de uma tool. Em terminal estreito a linha quebra, sem passar da largura.
- ~~Primeira versão (variante B):~~ substituída pela variante 1. Continuava cinza, em pt-BR: `⟲ Contexto resumido · 12:07` e `252 mil → ~18 mil tokens · N arquivos lidos, M editados · ctrl+o abre o resumo`. Aberta, mostra o resumo com títulos em pt-BR (Objetivo, Feito, Próximos passos…) e as listas de arquivos como seções. Só exibição: o texto enviado ao modelo não muda. O "~depois" é uma estimativa local (4 caracteres por token).
- **Onde:** gancho `compactacao` do patch `claude-home/patches/pi-core/avisos`, que agora tem 5 alvos (`components/compaction-summary-message.js` e o chunk). Prova em `check-comp.mjs` → `real-{escuro,claro}-compactacao{,-aberta}.png`.
- **Limite:** o `bin/pi` só reaplica os avisos quando o marcador falta. Um dist com a versão anterior dos avisos precisa de `apply.mjs <dist> --revert` seguido de `apply.mjs <dist>`; feito aqui no 1.5.2.

## Imagem: moldura e barra de rolagem (2026-11-14)
- **Moldura:** pedido do dono, "borda ou sombra pra não misturar com o bg". `extensions/image-open/fundo.ts` desenha em volta de cada imagem kitty uma moldura fina arredondada (`╭─╮ │ ╰─╯`) na cor `dim`. Ela fica dentro do fundo da tool. Nos fallbacks (sem `c=`/`r=`, iTerm2 ou terminal estreito) a imagem sai como antes.
- **Barra de rolagem:** pedido do dono, "a barra de scroll fica com um buraco". O pi-tui pula a célula da barra em toda linha que contém imagem (`layout.js` `replaceScrollbarCell`: `if (isImageLine(line)) return line`). O patch do core `claude-home/patches/pi-core/scrollbar-imagem/` (`apply.mjs`, idempotente, `--revert`) pinta a célula depois da sequência kitty. Ele altera `pi-tui/dist/layout.js` e o chunk do bundle; o `bin/pi` aplica.
- **Prova no kitty real, sem tmux (`check-img.mjs` → `real-escuro-imagem.png`):** sem o patch, a trilha some na linha da imagem (y 340–360); com o patch, a trilha é contínua.
- **Teste do apply:** a versão do worker dependia do estado do dist instalado (já com o patch). Ele passou a partir da base nativa, revertendo a cópia antes, para ser determinístico.

## Contrato alterado (testes antigos → novos)
- `icons.test`:
  - `nerdFont({kitty, NO_COLOR})` era false e agora é true.
  - `icon('pending', {PI_ASCII_ICONS})` era `●` e agora é `*`.
  - Motivo: NO_COLOR trata só de cor (no-color.org), e o nome `PI_ASCII_ICONS` prometia ASCII.
- `working.test`: o spinner tinha 8 quadros e agora tem 10.
- `terminal.test`: o título animado (`⠋ proj`, mudando a cada 90 ms) virou `● proj` estático, sem escritas novas.
- Motivo das duas últimas: ficar um só movimento na tela (G10). As demais asserções foram mantidas.

## Evidência (estado final, depois da última edição)
- **Testes de extensões:** `node --experimental-strip-types --test` nos 37 arquivos `*.test.{ts,mjs}` de `extensions/`. São 313 testes: 312 passam, 0 falham, 1 skip (contraste do tema `mono`, que usa as cores do terminal). `ui/` + `ui-visual/` também rodaram sem `--test-force-exit` e terminaram sem timer aberto.
- **Vermelho TDD observado antes das correções:**
  - teste de contraste sobre o tokyo-night anterior: 9 pares reprovados, exatamente os da auditoria;
  - testes de ícones, movimento e título sobre o código antigo: 7 falhas, relatadas pelo worker.
- **Portão de contraste:** `node docs/designs/onda7-tokens/contraste.mjs` → exit 0. As paletas `tokyo`, `escuro` e `claro` passam 43/43.
- **`claude-home/bin/tests/terminal-sota/gate.sh`:**
  - itens 1–5, 7, 9, 11 e 12 passam; o item 1 inclui cobertura de 100% em `a11y.ts` e `terminal.ts`;
  - FAIL nos itens 6, 8 e 10, preexistentes e de outros trabalhos no mesmo checkout: `symlink-file` em `~/.pi/agent/extensions`, links quebrados nas skills `engineering-standards` e `tdd`, `rules-ref/research-and-tools.md:15` e o detector de commands. Nenhum toca arquivo desta onda.
- **Kitty real (Xvfb, pi 1.5.2, provider fake):** com fundo `#1a1b26` o pi escolheu `pi-escuro`; com fundo `#ffffff`, `pi-claro`. Capturas de tools, Markdown e indicador de trabalho.
- **Esquema:** os 4 temas validam no `validateThemeJson` do pi 1.5.2.
- **Não executado:** `scripts/test_install.sh` (o instalador não mudou, só `publish.list` ganhou 2 linhas; `install.sh --link` em dry-run deu `skip(same)` para os 4 temas), leitor de tela e `forced-colors`.

## Limites conhecidos
- O texto do corpo usa a cor padrão do terminal. No kitty do dono ela é `#c0caf5` (azulado), não o `#f5f5f7` do `pi-escuro`. Para o visual Apple completo, troque no kitty `foreground #f5f5f7` / `background #1c1c1e`. Isso não foi feito, porque fica fora do repositório.
- O pulse dot do fleet e as etiquetas do HUD vêm da pilha de patches do pi-code e ficaram fora desta onda.
- `docs/ui-ux-gallery/images/*` ainda mostra o tema antigo.

## Rollback
- **Tema:** voltar `"theme": "tokyo-night"` em `~/.pi/agent/settings.json`. Há cópia anterior em `/tmp/settings.json.bak-onda7`, que é volátil.
- **Código:** reverter `extensions/ui-visual/{icons,working}.ts` e `extensions/ui/{a11y,terminal}.ts` junto com os testes correspondentes. Atenção: esses diretórios têm mudanças de outros trabalhos no mesmo checkout, então reverta por hunk, não pelo arquivo inteiro.

## Vocabulário de estado e mensagens de hook (2026-11-14)

Pedido do dono: um vocabulário único de estado, com ícone, cor e fundo, em tudo que mostra estado.

| Estado | Ícone | Cor | Fundo |
| --- | --- | --- | --- |
| executando | ● | ciano (`syntaxType`, o único token ciano dos temas) | `toolPendingBg`, agora tingido de ciano: escuro `#12363f` (2026-11-14, era `#243034`: mais ciano e claro até o piso de 4,5:1 do `dim`), claro `#ebf1f4`, tokyo `#1c2c38` |
| pede atenção | ▲ | `warning` | derivado: média de `toolSuccessBg` e `toolErrorBg` com 4% do amarelo (o tema do pi não aceita token novo) |
| feito | ✓ | `success` | `toolSuccessBg` |
| erro | ✕ | `error` | `toolErrorBg` |

- Dono da regra: `extensions/ui-visual/icons.ts` (`estadoGlyph`, `estadoBg`, `warnBgRgb`, ícone `warn`). Contraste ≥ 4,5:1 de texto, estado e diff em cada fundo, inclusive o derivado, em `theme-contrast.test.ts`.
- Aplicado em: tools (● ciano enquanto executam), indicador de trabalho (ciano), mensagens de hook (extensão nova `extensions/hook-msgs/`, variante de `exemplos/sinais-variantes.html#hook`), faixa do plan-gate (fundo de aviso), compactação (fundo verde, substitui o fundo neutro da variante 1), bloco de erro do provedor (faixa vermelha), painel `/avisos` ("Terminou" com ✓ verde no lugar de ● cinza), `✗` → `✕` (doctor de skills e Unicode das tools), `⚠` → `▲` (conflito de atalhos, cache da statusline).
- Exceção mantida: a caixa do `edit` terminado segue neutra (`customMessageBg`), porque verde confundiria com linha adicionada; enquanto executa fica ciano e em erro fica vermelha.
- Fora do vocabulário, de propósito: ● de aba ativa e de comentário no diff, `● automática ligada` (liga/desliga), `■ interrompido` (faixa vermelha já decidida) e o aviso de bypass em vermelho (pedido explícito do dono).
- Pendente: as linhas `▲` de nova tentativa e `■ novas tentativas canceladas` do core não ganharam fundo (componente do pi sem função de fundo).
- Evidência: `node docs/designs/onda7-tokens/check-estados.mjs` → `real-{escuro,claro}-estados.png` e `-estados-aberto.png`. O estado "executando" de uma tool não foi capturado (o provedor falso não tem tool lenta); está coberto por teste.

## Tema `pi-noite` (2026-11-14) — superado por `docs/designs/onda9-noite/README.md`

- **Estado:** arquivo criado (`themes/pi-noite.json`), não ativado. Ativar: `"theme": "pi-claro/pi-noite"` em `~/.pi/agent/settings.json`; voltar: `"pi-claro/pi-escuro"`.
- **Medida do "muito colorido":** `pi-escuro` usa 10 cores de texto com croma (azul, verde, vermelho, amarelo, roxo, rosa, coral, areia, ciano, verde-água) sobre um cinza neutro `#1c1c1e`, num terminal cujo fundo real é `#1a1b26` (azulado).
- **Regra do `pi-noite`:** 6 matizes, os do Tokyo Night (folke/tokyonight.nvim `colors/storm.lua` e `night.lua`, lidos em 2026-11-14): azul `#7aa2f7` é o único destaque; verde `#9ece6a`, vermelho `#f7768e` e amarelo `#e0af68` só para estado; ciano `#7dcfff` para "executando" e tipos; magenta `#bb9af7` para código e palavras-chave. A sintaxe reaproveita essas seis (função = azul, string = verde, número = amarelo, comentário = `dim`).
- **Fundos:** `bg` `#1a1b26` (o do terminal); todos os fundos são o `bg` com 7–12% de uma das seis cores: superfície `#262734`, sua mensagem `#262b3f`, executando `#242d3c`, sucesso `#25292b`, erro `#302430`.
- **Contraste:** passa `theme-contrast.test.ts` (todo par ≥ 4,5:1; `dim` `#8a93bd` é o corrigido da Onda 7, não o `comment` `#565f89` original, que dá 2,8:1).

