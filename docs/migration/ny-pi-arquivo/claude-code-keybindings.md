# Inventário de atalhos do Claude Code → pi

Complemento de `docs/claude-code-compat.md`. Fontes primárias lidas em 2026-11-14 (relógio local): https://code.claude.com/docs/en/interactive-mode e `/keybindings`, por leitores independentes (um scout leu o keybindings completo; outro preencheu as seções de interactive-mode via HTML bruto) e por três leituras minhas com `web_fetch` em trechos (vim, transcript, voz, contextos). Pesquisa de apoio: Perplexity + Keenable pelo scout. Não confirmado: chords de painel `Ctrl+X Ctrl+=/-/_` e `Ctrl+X =/-` (nenhuma fonte primária os lista; não implementados). A seção de teclas reservadas do keybindings foi lida na íntegra por um scout (as minhas leituras com `web_fetch` vieram truncadas antes dela); o resumo está no apêndice no fim.

Status: `exact` (mesma tecla e efeito), `alias` (tecla traduzida), `partial` (existe com diferença), `unsupported` (sem equivalente local). Quando digo "pi" refiro-me ao pi 1.5.2 com pi-code e `~/.pi/agent/keybindings.json` desta instalação.

## Controles gerais (interactive-mode)

| Tecla Claude | Efeito | Status | pi |
|---|---|---|---|
| Ctrl+C | interrompe; ocioso: 1º limpa, 2º sai | partial | UiEditor: ocupado → `ctx.abort()`; ocioso nativo (limpa; 2º em <500 ms sai); texto limpo volta por ↑ |
| Ctrl+X Ctrl+K | para todos os subagentes em background (2 toques) | alias | duas confirmações em 3 s; usa stop do fleet da sessão |
| Ctrl+D | sai (2 toques); com texto apaga caractere | partial | sai de uma vez com o editor vazio |
| Ctrl+G, Ctrl+X Ctrl+E | editor externo | exact | ambos acionam `app.editor.external` |
| Ctrl+L | redesenha | exact | UiEditor força redesenho; o seletor de modelo saiu dessa tecla |
| Ctrl+O | transcrição detalhada | partial | abre o viewer de transcript (`interface/transcript.ts`, implementado; verificação TUI integrada pendente); a expansão de ferramentas `app.tools.expand` foi realocada para Alt+O |
| Ctrl+R | busca no histórico | exact | UiEditor: overlay de histórico de prompts |
| Ctrl+V (Alt+V no Windows/WSL) | cola imagem | exact | `app.clipboard.pasteImage` (Alt+V só é padrão no Windows/WSL) |
| Ctrl+B | background de tarefas | partial | fleet-ui desanexa subagente em primeiro plano; Bash não vai a background |
| Ctrl+T | lista de tarefas | alias | UiEditor → `ctrl+shift+t` (pi-code todo); raciocínio foi para Alt+T |
| Ctrl+Z | suspende | exact | `app.suspend` |
| Ctrl+X Ctrl+S, Ctrl+Enter | envia agora | exact | `send-now-runtime.mjs` (patch pi-core/send-now), instalado |
| Ctrl+X Enter | enfileira | alias | aciona o follow-up nativo Ctrl+Q |
| Esc | cancela | exact | `app.interrupt` |
| Esc Esc | rewind/resumo | partial | ação do duplo Esc do pi; checkpoints de código em `/rewind` |
| Shift+Tab (Meta+M no Windows sem VT) | alterna modo de permissão | partial | delega ao controlador real de permissões: default/Manual, acceptEdits, plan e bypass implementados, ainda não verificados pelo gate integrado; AUTO indisponível (sem API); Meta+M (contexto de plataforma) segue lacuna até haver implementação |
| Alt+P | seletor de modelo | alias | `app.model.select` = alt+p |
| Alt+O | modo rápido | unsupported | sem modo rápido; a tecla expande/recolhe saída de ferramentas (`app.tools.expand`, realocada de Ctrl+O; `mergeKeybindings` não sobrescreve valor personalizado do usuário) |
| Alt+T | liga/desliga raciocínio | partial | `app.thinking.toggle` (recolhe blocos); nível: Alt+Shift+T ou `/thinking` |
| Up / Down | histórico | exact | nativo |
| Ctrl+P / Ctrl+N | cursor/histórico (nos menus: item anterior/próximo) | alias | UiEditor traduz para ↑/↓ nativos; ciclo de modelo: `ctrl+shift+.` e `ctrl+shift+,` |
| Ctrl+S | guarda o rascunho | exact | UiEditor; `app.thinking.save` fica sem tecla (`[]`) para não colidir (`/atalhos`) |
| Enter | envia | exact | `tui.input.submit` |
| Ctrl+J | nova linha | exact | `tui.input.newLine` |
| Alt/Option+Enter | nova linha | exact | `tui.input.newLine` inclui alt+enter (follow-up segue em ctrl+q) |
| Shift+Enter | nova linha | exact | padrão do pi em terminais com protocolo Kitty |
| `\` + Enter | nova linha | alias | remove a barra e insere nova linha, sem submeter |
| Ctrl+_ , Ctrl+Shift+- | desfaz | exact | `tui.editor.undo` = ctrl+- e ctrl+_ |
| Ctrl+Y, Alt+Y | cola texto apagado, alterna | exact | `tui.editor.yank`, `yankPop` |
| Ctrl+A / Ctrl+E | início/fim da linha | exact | nativo |
| Ctrl+K / Ctrl+U | apaga até fim/início da linha | exact | nativo |
| Ctrl+W | apaga até o espaço anterior | partial | apaga a palavra anterior |
| Alt+B / Alt+F / Alt+D | palavra anterior/seguinte, apaga palavra | exact | nativo |
| Ctrl+T (no `/theme`) | alterna realce de sintaxe | unsupported | `/theme` abre `/settings` |
| `/` no início | comando/skill | exact | nativo |
| `!` no início | modo shell | exact | `!cmd`, `!!cmd` |
| `@` | menção de arquivo | exact | nativo |
| `:` | emoji | unsupported | — |
| `?` com editor vazio | painel de atalhos | alias | UiEditor abre o painel da extensão `comandos` (teclas efetivas, 3 colunas); sem ela, `/hotkeys`. Todos os atalhos e como mudar: `/atalhos` |
| Space (segurar/tocar) | ditado por voz | unsupported | sem voz |
| Cmd+K | limpa a tela | unsupported | depende do terminal |

## Transcript viewer (Ctrl+O)

| Tecla | Efeito | Status | pi |
|---|---|---|---|
| ? | painel de atalhos | partial | ajuda no viewer (`transcript-view.ts`); verificação pendente |
| { / } | prompt anterior/próximo | partial | salta entre prompts no viewer; `tui.altScreen.previousPrompt/nextPrompt` na tela cheia |
| Ctrl+E | mostra tudo (renderer clássico) | partial | alterna recolhido/tudo no viewer; verificação pendente |
| [ | despeja a conversa no scrollback | unsupported | modo regular do pi já usa o scrollback do terminal |
| v | abre a conversa no `$EDITOR` | partial | viewer chama `openFull`; verificação pendente; `/export` grava a sessão |
| q, Ctrl+C, Esc | sai | partial | viewer sai também com Ctrl+O; busca na tela cheia: `tui.altScreen.search` |

## Modo vim

Local: `/vim` (seis módulos em `extensions/claude-compat/vim/`: engine, motions, ops, text, render, host) implementa modos normal/insert/visual/visual-line, movimentos, operadores, objetos de texto e repetição. **Implementação ≠ verificação**: nada abaixo foi aprovado pelo gate integrado (pendente) e nenhuma linha afirma paridade `exact`; diferenças de semântica ficam por medir. `Ctrl+[` como Esc: `partial` (terminal costuma entregar o mesmo byte).

| Grupo | Teclas Claude | Status | pi |
|---|---|---|---|
| Modo | Esc, Ctrl+[ | partial | implementado (vim/), verificação integrada pendente |
| Inserir | i, a | partial | implementado (vim/), verificação integrada pendente |
| Inserir | I, A, o, O | partial | implementado (vim/), verificação integrada pendente |
| Visual | v, V | partial | implementado (vim/), verificação integrada pendente |
| Mover | h j k l | partial | implementado (vim/), verificação integrada pendente |
| Mover | Space | partial | implementado (vim/), verificação integrada pendente |
| Mover | w, b | partial | implementado (vim/), verificação integrada pendente |
| Mover | e, ^, gg, G | partial | implementado (vim/), verificação integrada pendente |
| Mover | 0, $ | partial | implementado (vim/), verificação integrada pendente |
| Mover | f F t T ; , % | partial | implementado (vim/), verificação integrada pendente |
| Mover | `/` (busca de histórico) | partial | implementado (vim/); histórico também em Ctrl+R; verificação pendente |
| Histórico no limite | j/k, ↑/↓ no início/fim | partial | implementado (vim/), verificação integrada pendente |
| Editar | x | partial | implementado (vim/), verificação integrada pendente |
| Editar | r{c}, dd, D, dw/de/db, df/dt, dj/dk, dgg/dG, d0 c0 y0, d% c% y%, cc, C, cw/ce/cb, s, S, yy/Y, yw/ye/yb, p, P, >>, <<, J, u, . | partial | implementado (vim/), verificação integrada pendente |
| Text objects | iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ | partial | implementado (vim/), verificação integrada pendente |
| Visual (operadores) | d x y c s p P r ~ u U > < J o v V; sem bloco (Ctrl+V) | partial | implementado (vim/), verificação integrada pendente |
| Remap INSERT | `vimInsertModeRemaps` (ex.: jj) | partial | `remaps` no engine; verificação integrada pendente |

## Contextos do keybindings.json do Claude

O arquivo do Claude (ações `contexto:ação`, chords, `command:<nome>`) não tem equivalente: o do pi usa ids `app.*`/`tui.*`, sem chords configuráveis (os de send-now são fixos).

| Contexto | Ações = tecla | Status | pi |
|---|---|---|---|
| Global | app:interrupt Ctrl+C, app:exit Ctrl+D, app:toggleTodos Ctrl+T, app:toggleTranscript Ctrl+O, app:redraw (livre) | partial | ver tabela geral; redraw: Ctrl+L |
| History | history:search Ctrl+R, previous Up, next Down | exact | nativo + overlay |
| Chat | cancel Esc | exact | `app.interrupt` |
| Chat | clearInput Ctrl+L, clearScreen Cmd+K | partial | Ctrl+L redesenha (não limpa entrada) |
| Chat | killAgents Ctrl+X Ctrl+K | alias | duas confirmações em 3 s, apenas source da sessão |
| Chat | cycleMode Shift+Tab | partial | manual/plan; demais modos ainda pendentes |
| Chat | modelPicker Meta+P | alias | alt+p |
| Chat | fastMode Meta+O | unsupported | — |
| Chat | thinkingToggle Meta+T | partial | alt+t |
| Chat | submit Enter | exact | — |
| Chat | queueSubmit Ctrl+X Enter | alias | encaminha para Ctrl+Q |
| Chat | sendNow Ctrl+Enter, Ctrl+X Ctrl+S | exact | send-now |
| Chat | newline Ctrl+J | exact | — |
| Chat | undo Ctrl+_, Ctrl+Shift+- | exact | — |
| Chat | externalEditor Ctrl+G, Ctrl+X Ctrl+E | exact | ambos acionam o editor externo |
| Chat | stash Ctrl+S | exact | — |
| Chat | imagePaste Ctrl+V | exact | — |
| Chat | abovePrompt:toggle Ctrl+X Ctrl+A, focus Ctrl+X Tab | unsupported | sem painel acima do prompt |
| Chat | voice:pushToTalk Space | unsupported | — |
| Autocomplete | accept Tab, dismiss Esc, previous Up, next Down | exact | nativo (`tui.input.tab`, `tui.select.*`) |
| Confirmation | yes Enter, no Esc, previous Up, next Down, nextField Tab | exact | diálogos do pi usam `tui.select.*` (confirm = Enter, cancel = Esc) |
| Settings | search `/`, retry R, fixUsage F, accept Enter/Space, no Esc | partial | `/settings` do pi: seleção, Enter e Esc; sem busca/retry/fixUsage |
| Tabs | next Tab/Right, previous Shift+Tab/Left | unsupported | sem abas |
| Help | dismiss Esc | exact | `/hotkeys` fecha com Esc |
| Transcript | toggleShowAll Ctrl+E, exit q/Ctrl+C/Esc | unsupported | ver Transcript viewer |
| HistorySearch | next Ctrl+R, accept Esc/Tab, cancel Ctrl+C, execute Enter, cycleScope Ctrl+S | partial | overlay do pi: escopos próprios, Enter escolhe |
| Task | background Ctrl+B, Ctrl+X Ctrl+B | partial | ambas desanexam subagentes; Bash continua pendente |
| ThemePicker | toggleSyntaxHighlighting Ctrl+T | unsupported | — |
| Attachments | next Right, previous Left, remove Backspace/Delete, exit Down/Esc | unsupported | imagens coladas viram texto/anexo sem navegação |
| Footer | next Right, previous Left, up Up/Ctrl+P, down Down/Ctrl+N, openSelected Enter, clearSelection Esc, close x, dismiss | unsupported | rodapé não é navegável |
| MessageSelector | reutiliza Select | partial | `/tree` e `/fork` usam `tui.select.*` |
| DiffDialog | dismiss Esc, previous/nextSource Left/Right, previous/nextFile Up,K/Down,J, scroll pageUp/pageDown, fullPage Shift+Space,B/Space, top G/Home, bottom Shift+G/End | partial | `/diff` (extensions/ui/diff.ts): ↑/↓ arquivo ou cursor, Enter, PageUp/PageDown, Esc voltam/fecham; sem Left/Right de fonte, J/K, B, G, Home/End |
| DiffPanel | app:cycleDiffBase Ctrl+X B, diffFileListUp/Down Ctrl+Up/Down, Meta+Up/Down | unsupported | — |
| ModelPicker | decreaseEffort Left, increaseEffort Right, thisSessionOnly s | unsupported | seletor do pi sem esforço; `/thinking` |
| EffortSlider | Left, Right, toggleUltracode Tab, thisSessionOnly s | unsupported | `/thinking` |
| Select | next Down/J/Ctrl+N, previous Up/K/Ctrl+P, pageUp/pageDown, first Home, last End, accept Enter, cancel Esc | partial | `tui.select.*`: Up/Down/PageUp/PageDown/Enter/Esc; sem J/K, Home/End |
| Plugin | toggle Space, install I, favorite F | unsupported | — |
| AbovePrompt | next Tab/Right, previous Shift+Tab/Left, press Enter/Space, leave Esc, highlightNext Down, highlightPrevious Up | unsupported | — |
| AbovePromptInput, AbovePromptSelect | (sem teclas próprias) | unsupported | — |
| Pane | scrollUp/Down Up/Down, pageUp/Down, top Home, bottom End, grow Ctrl+X Left/Up, shrink Ctrl+X Right/Down, close Ctrl+X X | unsupported | sem painéis |
| PaneField | close Ctrl+X X | unsupported | — |
| Agents | switchView Ctrl+S, togglePin Ctrl+T, find Ctrl+F, rename Ctrl+R, previousGroup/nextGroup Ctrl+Up/Down, Meta+Up/Down | partial | painel de subagentes do pi-code (fleet-ui) tem navegação própria |
| Scroll | lineUp/Down wheel, pageUp/Down PageUp/Down, top Ctrl+Home, bottom Ctrl+End, halfPage/fullPage (livres), selection:copy Ctrl+Shift+C / Cmd+C | partial | tela cheia do pi: PageUp/Down, `tui.altScreen.top/bottom` = ctrl+home/end (mesmas teclas), roda do mouse, cópia por seleção/`app.message.copy` |
| /btw (overlay) | dispensa Space/Enter/Esc; Up/Down rolam; Shift+Left/Right e `[` `]`, Tab/Shift+Tab percorrem as respostas; `c` copia; `f` faz fork; `x` limpa (verificado por scout) | partial | `/btw` local (extensions/ui/btw.ts): só Enter e Esc fecham; sem rolagem, navegação, cópia, fork ou limpeza |

Itens de diálogo/painel citam `diff.ts`/`btw.ts` (lidos) e `keybindings.md` do pi; não os testei na TUI.

## Apêndice: teclas reservadas e limites do terminal

Fonte: página `/keybindings`, seção de teclas reservadas, lida por scout (as leituras diretas deste registro vieram truncadas antes dela).

| Tecla | Situação no Claude | Status | Local (pi) |
|---|---|---|---|
| Ctrl+C, Ctrl+D | reservadas: não podem ser religadas | partial | no pi são `app.clear` e `app.exit`, religáveis; não alterei |
| Ctrl+M | igual a Enter no terminal | exact | idem (o terminal envia o mesmo byte) |
| Ctrl+[ | igual a Esc | exact | idem |
| Ctrl+I | igual a Tab | exact | idem |
| Ctrl+H | igual a Backspace | exact | idem |
| CapsLock | o terminal não a reporta | exact | idem |

Por isso nenhum alias deste projeto usa essas teclas. Chords `Ctrl+X …` e teclas com `Shift`/`Super` dependem do protocolo Kitty/modifyOtherKeys: sem ele o terminal manda o mesmo byte para combinações distintas (ex.: Ctrl+Shift+- e Ctrl+_ são ambos 0x1f; por isso `tui.editor.undo` lista os dois).
