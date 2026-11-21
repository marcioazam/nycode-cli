# Onda 10 · execução das propostas aprovadas

**Status: onda 1 aplicada e verificada, sem commit; onda 2 com viabilidade lida (2026-11-18).** Catálogo e fontes: `README.md` deste diretório. Branch `feat/ui-onda9-harness`,
árvore com trabalho anterior não commitado; nada é commitado sem pedido do dono.

Tier: T2 (várias extensões, sem dado persistente crítico; a onda 2 toca patch do pi e sobe para T3).

## Decisão do dono (2026-11-18)
Aprovadas 24: P01, P02, P04 a P25 (P25 na variante **só no envio**). Rejeitada: P03 (tokens de movimento), então
as durações continuam como constantes locais de cada arquivo.

## Ondas
- **Onda 1 (só extensões e HUD, nesta execução):** P01, P02, P04, P05, P06, P08, P09, P10, P12, P13, P17, P18, P19,
  P22, P23, P25.
- **Onda 2 (precisa de patch no pi-code ou no pi-tui; viabilidade lida antes):** P07, P11, P14, P15, P16, P20, P21, P24.

## Decisões de desenho (onda 1)
- D1 (P01). Uma função `movimento()` em `extensions/ui/a11y.ts` devolve `normal | reduzido | desligado`. Vale o mais
  restritivo entre ambiente e chave salva. Ambiente: `TERM=dumb` ou `NO_PROGRESS` não vazio → desligado;
  `PI_REDUCED_MOTION` não vazio e diferente de `0`/`false`, ou `TERM=linux` → reduzido. Chave: `/movimento <nível>`
  grava `movimento` em `ui-state.json` (onde o `/vim` já grava); sem ela vale `movimento` de `settings.json`.
  O pi carrega cada extensão com cache de módulo próprio (`moduleCache: false` no jiti), então a escolha fica em
  `globalThis[Symbol.for('pi-harness:movimento')]`. `NO_COLOR` não vazio só tira os efeitos de cor (no-color.org),
  não muda o nível; antes `NO_COLOR` vazio também desligava em `motion.ts`.
- D2 (P02). O barramento `subscribe120Hz` vira `assinarQuadro(chave, passo, { transicao })`: um timer só, 16 ms
  enquanto há transição (≤ 300 ms), senão 33 ms; 66 ms em tmux ou SSH; sem foco os contínuos caem para 1 tique por
  segundo (o tempo continua, a varredura para). Em `reduzido` os contínuos também ficam em 1 tique por segundo; em
  `desligado` nada assina. `unlock120Hz` sai: 16 ms já é o piso do pi-tui.
- D3 (P04). `highlightPeak(base, fundo)` clareia o próprio token em OKLCH (+0,16 de L) e recua até a mistura de 88%
  manter 3:1 contra o fundo; sem fundo conhecido usa preto ou branco pelo lado oposto do texto. Shimmer: 900 ms com
  aceleração e freio, 500 ms de descanso. Corrige também o settle e os dois usos do editor.
- D4 (P05). Travamento = 10 s sem `message_update` nem evento de tool, e nenhuma tool rodando (tool longa não é
  travamento). O spinner troca de cor em 25 quadros (2 s) numa chamada só, porque `setWorkingIndicator` zera o quadro.
- D5 (P06). `executando · 14s` a partir de 2 s, pela hora de `tool_execution_start`; em `desligado` não aparece.
- D6 (P08). Barra de 6 células em oitavos (48 passos), avanço de 200 ms a partir do fim da chamada `complete`.
  O Task sempre tem total, então o cometa sai do Task e `progressBarWithComet` é removida (sem outro uso).
- D7 (P09). A dica é a 2ª linha da mensagem de trabalho, depois de 5 s, trocando a cada 8 s; só atalhos lidos no
  código. `/dicas` liga e desliga (grava `dicas` em `ui-state.json`). A linha aparece aos 5 s (o transcript sobe 1).
- D8 (P10). O provedor só informa os tokens de saída no fim de cada mensagem. Durante o stream o número é estimado
  (caracteres ÷ 4) e sai com `~`; mensagens já fechadas do turno entram com o valor exato.
- D9 (P12). O aviso do `syntax-check` (hoje só texto para o modelo) passa a aparecer na caixa do `edit`/`write`:
  estado `erro de sintaxe` e linha `✕ linha L:C` com o trecho em sublinhado ondulado (`4:3` + `58`); terminal sem
  suporte conhecido ou tmux usa sublinhado simples; `NO_COLOR` tira a cor.
- D10 (P13). Links `OSC 8` (função `hyperlink` do pi-tui, só com `getCapabilities().hyperlinks`): alvo de arquivo nos
  títulos de `read`/`edit`/`write`/`ls` (o `edit` aponta para a 1ª linha alterada, `file://host/caminho#linha`, a
  convenção do kitty); no texto do assistente um transformador de Markdown liga caminhos que existem no disco e
  `#123` quando o `origin` é GitHub. URL solta o pi-tui já liga.
- D11 (P17). O HUD guarda o histórico de contexto por sessão em arquivo de estado e desenha 8 blocos; o rótulo
  `acima de 70%` / `acima de 85%` acompanha a cor.
- D12 (P18). Texto dim no editor vazio; some com a primeira tecla (é desenho, não conteúdo).
- D13 (P19). Cabeçalho revela por coluna em 320 ms com saída suave, uma vez por `session_start`.
- D14 (P22). Versão do kitty por XTVERSION (`CSI > q`), porque kitty anterior à 0.47 mostra `OSC 9` como notificação;
  iTerm2 por `TERM_PROGRAM_VERSION`. Estado 1 com percentual a partir do resultado do `todo`; estado 4 enquanto há
  pergunta aberta.
- D15 (P23). kitty → `OSC 99`; iTerm2, foot e Windows Terminal → `OSC 9`; os demais → `OSC 777`; terminal não
  reconhecido recebe `OSC 777` e `BEL`.
- D16 (P25). O brilho por tecla sai; fica só no envio.

## Aceite (onda 1)
- A1. Um só critério de movimento: `working.ts`, `motion.ts`, `editor.ts` e `a11y.ts` consultam `movimento()`.
- A2. No pico do shimmer a letra mantém pelo menos 3:1 contra o fundo nos tokens de `pi-noite` e `pi-claro`.
- A3. Nenhum timer de animação abaixo de 16 ms; sem assinante o timer desliga.
- A4. Cada item tem teste focado; as suítes `extensions/ui`, `extensions/ui-visual`, `extensions/avisos`,
  `extensions/syntax-check` e `claude-home/bin/hud/tests` passam; `structure.py` sem achado novo.
- A5. `desligado`, `reduzido`, `NO_COLOR` e terminal sem truecolor seguem o fallback escrito em cada cartão.

## Viabilidade da onda 2 (lida no pi 1.5.2, sem patch aplicado)
Caminhos relativos a `@earendil-works/pi-coding-agent/dist` (pc) e `@earendil-works/pi-tui/dist` (tui).

| Item | Onde o pi decide | Leitura | Caminho |
|---|---|---|---|
| P07 fundo em transição | pc `modes/interactive/components/tool-execution.js:52-53, 213-222` troca o `bgFn` de uma vez | as tools com caixa própria (`tools.ts`) já pintam o fundo pelo `bgToken`; dá para misturar os 200 ms ali com `tocar(ctx)`; as caixas nativas precisam de patch | extensão para as nossas caixas; patch no pc para as nativas |
| P11 streaming suave | pc `components/assistant-message.js:76` `updateContent` a cada `message_update` | sem novo delta não há redesenho; segurar texto no transformador de Markdown exigiria invalidar o componente por timer (mesma busca na árvore do P25) | patch no pc (buffer com cadência no componente) |
| P14 manchete do raciocínio | pc `interactive-mode.js:1955-1963` `setHiddenThinkingLabel` | a API existe, mas troca o rótulo de todos os blocos recolhidos, inclusive os antigos; a mistura de 200 ms não cabe num rótulo de texto | patch no pc (rótulo por componente) |
| P15 aviso com entrada e saída | pc `interactive-mode.js:3225` `showStatus`, `showWarning`, `showError` | o aviso é um componente do pc sem gancho de animação | patch no pc |
| P16 véu atrás de overlay | tui `tui.js:984-1055` `compositeOverlays` | o véu é escurecer as linhas de base antes de compor; não há gancho | patch no tui |
| P20 assinatura no fim do plano | pi-code `extensions/plan-mode/done-view.ts` | o desenho é do pacote pi-code (npm), fora deste repositório | patch no pi-code |
| P21 hover e ponteiro | tui `tui-alt-screen.js:17` liga `?1003` só na tela alternativa; OSC 22 não aparece no tui | fora da tela alternativa não chega movimento do mouse | patch no tui (modo de mouse e OSC 22) |
| P24 títulos em escala | tui `components/markdown.js:426` monta o título | `OSC 66` muda a altura da linha; o tui conta 1 linha por linha e o tmux não repassa | patch no tui, só kitty ≥ 0.40 fora do tmux |

## Progresso
- [DONE:1] P01 `/movimento` e `movimento()` em `ui/a11y.ts` (nível salvo em `ui-state.json`, senão `settings.json`).
- [DONE:2] P02 e P04 em `ui-visual/motion/motion.ts`: um relógio (16/33/66 ms, 1 s sem foco), pico OKLCH com piso 3:1.
- [DONE:3] P05, P09, P10 em `ui-visual/working.ts` (trava em 10 s, dica após 5 s e `/dicas`, tokens com `~`).
- [DONE:4] P06 e P08 (`motion/vivo.ts`, `motion/chrome.ts`), P12 e P13 (`motion/marcas.ts`, `tools.ts`,
  `syntax-check/index.ts`, transformador do assistente em `ui-visual/index.ts`).
- [DONE:5] P18 placeholder (`ui/editor.ts`), P25 brilho só no envio (`ui-visual/index.ts`), P19 abertura (`header.ts`).
- [DONE:6] P22 (`avisos/progresso.ts`, `avisos/index.ts`), P23 (`avisos/notificar.ts`), P17 (`hud/calm-statusline.mjs`).
- [DONE:7] Viabilidade da onda 2 na tabela acima.
- [DONE:8] Verificação única (abaixo). Links em `~/.pi/agent/extensions` e `publish.list` para `vivo.ts`, `marcas.ts` e
  `marcas.test.ts`.

## Surpresas e log de decisões
- 2026-11-18. Módulos não são compartilhados entre extensões (jiti com `moduleCache: false`): estado comum vai em
  `globalThis`, como o `Symbol.for('pi-harness:retry-cancelado')` já fazia.
- 2026-11-18. `syntax-check` nunca desenhou nada: o "antes" do cartão P12 (erro só em cor) não existe no TUI; o erro
  hoje só chega ao modelo. A P12 passa a incluir mostrar o aviso.
- 2026-11-18. D14 mudou: a versão do kitty vem do binário do processo (`/proc/<KITTY_PID>/exe --version`, senão
  `kitty` do PATH), não de XTVERSION, porque a resposta do terminal chegaria no stdin que o pi-tui lê.
- 2026-11-18. P25: o `Markdown` guarda o desenho em cache; o brilho invalida a mensagem nova achada na árvore do TUI
  (o `TUI` chega pelo widget de `compact.ts`). Mensagem com bloco Markdown (lista, título, cerca) ou várias linhas não
  brilha, porque a cor inline quebraria o bloco.
- 2026-11-18. Os testes de `tools` dependiam do terminal (Nerd Font no kitty); `test/tools/base.ts` fixa um terminal
  neutro. `alias/autocomplete.test.ts` (não rastreado, de antes) só roda por `with-sdk.sh`, como diz o cabeçalho dele.
- 2026-11-18. `README.md` lista "cometa do Task" em "fica como está" e a P08 aprovada diz que o cometa fica só sem
  total. Vale a P08 (decisão mais recente e específica).

## Resultados
Verificação única em 2026-11-18, Node v24.22.3, pi 1.5.2, árvore não commitada sobre `4e38f41`.
- Suítes `extensions/ui` (com `vim/`), `extensions/ui-visual` (com `tools/` e `motion/test`), `extensions/avisos` e
  `extensions/syntax-check`: 454 testes, 453 passam, 0 falham, 1 pulado (`mono` no contraste, que usa as cores do
  terminal). Rodado três vezes com o mesmo resultado: no kitty, com `TMUX` e com `TERM=xterm-256color` sem kitty.
- `extensions/ui/test/alias/autocomplete.test.ts` por `with-sdk.sh`: 11 passam.
- `node --test claude-home/bin/hud/tests/*.test.mjs`: 77 passam.
- `structure.py --project-root . --json`: 0 achados (776 arquivos de código).
- Não rodado: gate completo do repositório, cobertura por arquivo, teste visual no kitty de verdade.
