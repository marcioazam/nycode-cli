# UI SOTA no pi (2026-11-12)

Origem: auditoria deep-search `/tmp/deep-search/01a1d1e7-8117-7169-9fd0-3639dc291e2b-cli-harness-ui/REPORT.md`
(ledger `LEDGER.json`). Decisões do usuário: sem paleta de comandos (o `/` já lista), som de fim de turno
sem mudança, sem HUD compacto.

Correção da auditoria: o "resumo ao sair do fullscreen" já existe (`fullscreenExitOutput`, padrão
`transcript`; `interactive-mode.js` `stopInteractiveTui`). Nada a fazer.

## Estado final verificado (fonte única; 2026-11-12 22:03)

Gate reproduzível: `bash ~/.pi/agent/claude-home/bin/tests/pi-ui-final-gate.sh` (sha256 `d8996f4b…`; só lê fora de
`mktemp`; sai 0 só se as 14 checagens passarem). Última execução 22:03, depois de 24 min sem mudança em nenhum
arquivo coberto: `GATE_EXIT=0`, manifesto SHA-256 `259b34cf68c83ee1` igual antes e depois. ui 39/39 (5 arquivos 100%
linhas); patches da tarefa 72/72 (git-checkpoint 99,43%, todo 100%, notify 84,05%); pi-code 206/206 (inclui os testes
da frota); HUD 15/15; som + bash-clamp + syntax-check + pi-docs 18/18; hooks/dispatch OK; `bash -n` OK;
`structure.py` `[]`; `check-instructions` 0; pilha: desfazer 8×0 e, por patch na ordem, dry-run 0 + aplicação 0,
refeita == instalada; patches novos sobre `orig` 0; `subagent-panel.patch` (21:24:48) mais novo que todos os seus
alvos (21:24:39); `pi -p` → `ok`, stderr vazio. Sem git: `~` não é repositório e a regra do workspace
proíbe inicializar git; o manifesto é a prova de estado. As seções abaixo registram o histórico das mudanças;
contagens de teste e cobertura valem só por esta seção.

## Objetivo e aceite

| Item | Aceite observável |
|:-|:-|
| `?` com o editor vazio | abre o painel nativo de atalhos (`/hotkeys`); com texto, `?` é digitado normalmente |
| `/vim` | alterna o modo vim (normal/insert), indicado na borda; persiste em `~/.pi/agent/ui-state.json` |
| `/rename` e nome na borda | sem regressão (código migra de `extensions/rename.ts` para `extensions/ui/editor.ts`) |
| `NO_COLOR` | não vazio → tema `mono` (todas as cores `""`) só nesta sessão; `settings.json` não muda |
| `PI_REDUCED_MOTION=1` | indicador de trabalho e título sem animação |
| Título do terminal | `⠋ pi - nome - cwd` enquanto trabalha; `✓ ...` ao terminar fora de foco; volta ao normal ao focar |
| Foco (OSC 1004) | evento `pi-ui:terminal-focus {focused}` no bus; notify.ts notifica só fora de foco quando há sinal de foco |
| ~~Painel de subagentes~~ (substituído pelo fleet-ui do pi-code, ver abaixo) | 1 linha acima do editor com os subagentes ativos (tipo, tempo); some quando não há nenhum |
| `/diff` | lista de arquivos alterados (+N/−M) e diff rolável; fora de git avisa |
| `/btw <pergunta>` | resposta num overlay, sem gravar na sessão; funciona durante o streaming |
| Rewind unificado | `/tree` (Esc Esc) pergunta "restaurar código?" quando o destino tem checkpoint; `/rewind` ganha "Summarize from here"; sem pergunta dupla |
| Recolher todo | `ctrl+shift+t` ou clique alterna lista ↔ `Todos 3/7 · ◐ atual`; concluída recolhe sozinha (ver `todo-widget-ui-2026-11-13.md`) |

## Grafo de unidades

- Lane A (`extensions/ui/{index,editor,a11y,terminal}.ts`, `ui/test/`, `themes/mono.json`, remove `extensions/rename.ts`).
- Lane B (`extensions/ui/{tasks-panel,diff,btw}.ts`, `ui/test/` com prefixos próprios).
- Lane C (`claude-home/patches/pi-code/{rewind-tree,todo-collapse,notify-focus}.patch`, `orig/`, testes, este doc, `goal.md`).
- Sem arestas de código entre lanes; contrato compartilhado: bus `pi-ui:terminal-focus` `{ focused: boolean }`.

## Custo e qualidade

Zero bytes sempre carregados (nada em CLAUDE.md, rules, skills ou agentes). Custo por execução: só os
listeners das extensões; `/btw` gasta uma chamada de modelo quando usado. Patches no pi-code podem deixar
de aplicar num upgrade; o wrapper avisa (mesmo risco do `statusline-multiline.patch`).

## Rollback

Backups em `/tmp/pi-ui-backup` (rename.ts, git-checkpoint.ts, todo.ts, notify.ts, settings.json).
Remover `extensions/ui/`, restaurar `rename.ts`, reverter os três patches (`patch -R`) e apagá-los.

## Checkpoint

- [x] Lanes A, B, C
- [x] Gate (testes, cobertura, patches aplicam/revertem, structure.py)
- [x] Teste ao vivo no tmux
- [x] plan-reviewer complete (2026-11-12; Esc Esc → `/tree` é o padrão `doubleEscapeAction: "tree"`, docs/settings.md:34)

## Mudanças depois das lanes

- **Painel de subagentes retirado** (`ui/tasks-panel.ts`, cópia em `/tmp/pi-ui-backup/dropped/`): outra sessão
  está entregando o painel de frota completo no pi-code (`subagent/fleet-ui`, `docs/pi-agent-fleet-2026-11-12.md`,
  aceite A1-A8), que cobre e supera esta linha única. Dois painéis acima/abaixo do editor seriam duplicados.
- **Foco no fullscreen**: o viewport do pi-tui consome `\x1b[I`/`\x1b[O` antes dos listeners das extensões
  (`tui-alt-screen.js:106`, `tui.js:719-727`, `tui-alt-screen.js:490,514`). `ui/terminal.ts` lê o foco de um
  observador extra em `process.stdin` `'data'` (não consome) e só usa `onTerminalInput` para engolir as
  sequências no modo regular.
- **NO_COLOR no status de bypass**: `extensions/bypass-permissions.ts` gerava o texto com a cor do tema anterior
  (roda antes de `ui/a11y.ts`); agora sem cor quando `NO_COLOR` está definido.

## Evidência (2026-11-12)

- Testes: `env -u PI_CODE_SUBAGENT node --experimental-strip-types --test ~/.pi/agent/extensions/ui/test/*.test.ts`
  e `patches/pi-code/*.test.ts` (contagens atuais em "Estado final verificado").
  Todos os arquivos tocados ficam ≥ 80% de linhas (lacuna de cobertura do pi-code fechada na rodada final).
- Dry-run: os 3 patches novos aplicam no `orig` e revertem no instalado. O aviso "não aplica" do
  `subagent-nesting.patch` visto nesta etapa era falso positivo do wrapper (resolvido na rodada final).
- `structure.py` em `extensions/`: a raiz tinha 9 arquivos de código (limite 7, preexistente); a remoção do
  `rename.ts` e a mudança de `bypass-permissions.ts` para `bypass-permissions/index.ts` (só o caminho; comentário
  em `hooks/guard.py:31` atualizado) a deixam com 7: `findings: []`. O pi carrega `bypass-permissions` (visto no tmux).
- Gate intermediário desta etapa: contagens superadas; o estado vale só pela seção "Estado final verificado".
- `mono.json`: as 56 cores do `dark.json` embutido, todas `""`.
- Ao vivo (tmux, `pi --no-session`, repo git descartável em `/tmp/uit`): `?` abriu o painel de atalhos (com
  `Ctrl+Shift+T` listado); `/vim` ligou, `ab` Esc `h` `i` `X` → `aXb` e borda `INSERT`; `/diff` listou `f.txt +1 −0` e
  `g.txt (novo)` e abriu o diff colorido; título `⠏ pi - uit` durante o turno; `/btw quanto é 2+2?` respondeu `4`
  num overlay com o agente rodando `sleep 12`; `Ctrl+Shift+T` recolheu para `Todos 0/3 · ◐ Fazendo a`; com foco fora
  (`\x1b[O` enviado) o título terminou `✓ pi - ...` e voltou ao normal com `\x1b[I`, sem lixo no editor; `/tree`
  (Esc Esc) num prompt com `write` perguntou "Restore code to that point?"; `/rewind` → "Summarize from here"
  terminou com "Rewind complete" sem pergunta dupla; `NO_COLOR=1 PI_REDUCED_MOTION=1`: título e indicador `●`
  estáticos, borda e status de bypass sem cor.
- ~~Limite residual: o HUD ignora `NO_COLOR`~~ resolvido (rodada final, abaixo).

## Rodada final: pendências zeradas (2026-11-12)

- **Aviso "subagent-nesting.patch não aplica" era falso positivo do wrapper.** A pilha inteira desfaz limpa em
  ordem reversa e refaz limpa em ordem (8/8 exit 0), mas `subagent-panel.patch` (sessão da frota) sobrepõe trechos
  do `nesting`, e o wrapper testava o reverso de cada patch sozinho. Correção em `~/.local/bin/pi`:
  `pi_patch_stack_applied` (cópia tmp de 1,5 MB, reverso em ordem reversa) pula o loop quando tudo está aplicado.
  Testes: `pi -p` sem aviso; árvore sem patches num HOME falso → snippet aplica tudo, `diff -rq` igual à instalada,
  2ª partida sem aviso. `goal.md` atualizado. Backup: `/tmp/pi-ui-backup/pi-wrapper`.
- **HUD com `NO_COLOR`**: `bin/hud/claude-hud-statusline.mjs` e a cópia `plugins/claude-hud/statusline.mjs` tiram
  SGR da saída quando `NO_COLOR` não é vazio (links OSC 8 ficam). Red: script antigo com `NO_COLOR=1` → 3
  sequências SGR; green: 0. Teste novo `bin/hud/tests/claude-hud-statusline.test.mjs` (depende do claude-hud
  instalado nos caches do Claude Code; sem ele falha explicitamente). HUD: 15/15.
- **Cobertura dos arquivos do pi-code inteiros**: testes estendidos (test-author) em `rewind-tree.test.ts` e
  `todo-collapse.test.ts`, sem tocar produção nem asserções antigas: `git-checkpoint.ts` e `todo.ts` passaram de
  80% (valores atuais em "Estado final verificado"; descobertos em git-checkpoint só dois `catch` de falha de escrita).
- **Estrutura**: outra sessão criou `extensions/up-dequeue.ts` às 20:34 (raiz de novo com 8). Sem tocar no arquivo
  dela, `sound-notify.ts` → `sound-notify/index.ts` (conteúdo igual; referências atualizadas em
  `bin/tests/sound-notify.test.ts`, `bin/checks/check-instructions.py`, `docs/pi-hooks-port.md`, `docs/pi-instructions.md`
  e na memória `pi-global-instructions`). `structure.py` → `findings: []`; `check-instructions.py` → 0 problemas;
  teste do som 1/1; o pi lista `sound-notify`, `bypass-permissions`, `ui` e `up-dequeue.ts` na partida.
- Gate intermediário desta etapa: contagens superadas; o estado vale só pela seção "Estado final verificado".
- **Bug achado na verificação ao vivo, corrigido**: com `NO_COLOR=1` o logo do cabeçalho embutido seguia colorido
  (`48;2;79;142;179`; `pi-logo.js` usa cores fixas da marca, fora do tema, e o pi-tui não tem modo sem cor). `ui/a11y.ts`
  agora instala com `setHeader` um wrapper do `BuiltInHeader` (achado pelo campo `onLogoClick`; no `/reload`, pelo
  `plainInner` do wrapper anterior) que tira SGR e repassa `setExpanded`/`invalidate`; o clique no logo (easter egg
  3D colorido) fica desligado nesse modo. TDD: red `does not provide an export named 'plainHeader'` → green 39/39,
  `a11y.ts` 100% linhas. tmux: `NO_COLOR=1` → 0 cores na tela, Ctrl+O mostra a ajuda expandida (5 linhas) sem cor;
  sem `NO_COLOR` → logo colorido como antes.
- **"Summarize from here" visto ao vivo**: em `/tmp/uit`, prompts ALFA e BETA, `/rewind` → checkpoint BETA →
  "Summarize from here" → `[branch] Branch summary` (Ctrl+O mostra o resumo nativo do galho "BETA"), `Rewind
  complete`, prompt BETA de volta no editor e `git status` de `/tmp/uit` inalterado (modo não restaura código).
- Gate intermediário desta etapa: contagens superadas; o estado vale só pela seção "Estado final verificado".
- Sem gate git: `~` não é repositório e a regra proíbe inicializar git aqui; as checagens acima rodaram
  direto. Componentes apontados como atrasados (relatório de 2026-11-09) já estão na versão mais nova:
  `computer-use-linux` 0.7.53 = npm; `mcp-server-fetch` 2026.11.11 e `package-version-check-mcp` 1.2.40 fixados em
  `~/.config/mcp/mcp-gateway.json` = PyPI; gateway responde 200.

## Lane C: patches no pi-code (2026-11-12)

Arquivos em `claude-home/patches/pi-code/` (`*.patch`, `orig/`, `*.test.ts`); esquema do `goal.md`.

- **rewind-tree** (`git-checkpoint.ts`): `session_before_tree` pergunta "Restore code to that point?" só quando
  `event.preparation.targetId` é exatamente o `entryId` de um checkpoint com `ref` (o checkpoint é chaveado pela
  mensagem do usuário que iniciou a run, `turn_end`; é essa mensagem que o `/tree` seleciona ao voltar a um prompt).
  Outros alvos (resposta do assistente, tool result) não têm snapshot próprio e não perguntam. Cancelar o diálogo ou
  falha mantém o código e nunca cancela a navegação. O `/rewind` marca uma flag em volta do `navigateTree`, para
  não perguntar duas vezes. Modo novo "Summarize from here": `navigateTree(id, { summarize: true })`, código intacto.
  Para o Esc Esc abrir o `/tree`: `doubleEscapeAction: "tree"` em settings.json (já é o que o plano prevê).
- **todo-collapse** (`todo.ts`): `ctrl+shift+t` (livre: nenhum default do pi 1.5.2 em docs/dist, nenhum `registerShortcut`
  do pi-code ou de `~/.pi/agent/extensions`; `alt+shift+t` é só a árvore de sessões) alterna lista ↔
  `Todos 3/7 · ◐ atual`. Estado por processo; sem todos, não faz nada.
- **notify-focus** (`notify.ts`): `pi.events?.on('pi-ui:terminal-focus')`; foco `true` não notifica, `false` notifica
  (respeitando abortado e canal), `undefined` mantém `isAway`. `sound-notify.ts` intocado.

Testes: `node --experimental-strip-types --test patches/pi-code/{rewind-tree,todo-collapse,notify-focus}.test.ts`
(inclui dry-run do patch no original e do reverso no instalado).

## sticky-prompt (2026-11-12, pedido do usuário)
`extensions/sticky-prompt/`: no modo fullscreen, quando o prompt do usuário mais recente acima da janela sai de vista,
uma linha flutuante no topo do transcript mostra o texto (`❯ …`, fundo próprio azul-aço ANSI 256 cor 24, texto 255); clique rola até ele (atalho
de teclado equivalente: `ctrl+shift+up`). Usa campos internos do pi-tui 1.5.2 (`currentLayout`, `showOverlay`
não-capturante); se sumirem, vira no-op. Prompt do usuário identificado pelo texto das mensagens `user` do ramo da sessão (o tema mono deixa `userMessageBg` vazio, então a cor não serve). Testes: `sticky.test.ts` 4/4, cobertura de `sticky.ts` 100% linhas / 85% ramos; E2E em tmux: aparece no
PageUp, clique leva ao prompt, some quando o prompt está visível. Custo: zero tokens. Reverter: apagar o diretório.

## Correção 2026-11-12: NO_COLOR gravava o tema mono para sempre

- **Sintoma**: o pi inteiro perdeu as cores; `settings.json` tinha `"theme": "mono"`.
- **Causa**: `ui/a11y.ts` chamava `ctx.ui.setTheme('mono')`. Por nome, o pi 1.5.2 também grava o tema
  (`interactive-mode.js`: `setThemeName` e depois `settingsManager.setTheme`). O E2E `NO_COLOR=1 pi --no-session`
  da validação acima rodou uma vez e deixou o mono salvo para todas as sessões seguintes.
- **Conserto**: `ctx.ui.getTheme('mono')` e `ctx.ui.setTheme(<objeto Theme>)` (`setThemeInstance`, não grava).
  `settings.json` voltou a `"theme": "tokyo-night"` (`themes/tokyo-night.json`, válido no `validateThemeJson` do 1.5.2).
- **TDD**: o teste `NO_COLOR aplica o tema mono só nesta sessão` falhou antes do conserto
  (`actual: [['theme','mono'], …]`, esperado o objeto) e passou depois; `a11y.test.ts` 8/8.
- **E2E (tmux, CLI real)**: `NO_COLOR=1 pi --no-session` → 0 cores na tela e hash de `settings.json` igual
  antes e depois; `pi --no-session` → truecolor do Tokyo Night (`#7aa2f7`, `#9d7cd8`, `#f7768e`, `#737aa2`).

## Rodada seguinte (2026-11-13)

Histórico Ctrl+R, rascunho Ctrl+S, Ctrl+C→↑, comentários por linha no `/diff`, `/copy-code`, `/keybindings` e Tokyo
Night oficial em sintaxe, markdown, sticky-prompt e HUD: `pi-terminal-sota-2026-11-13.md` (gate e E2E em
`bin/tests/terminal-sota/`).

> Atalhos: trocados em 2026-11-13 para não usar Alt — ver `hotkeys-no-alt-2026-11-13.md`.

## sticky-prompt × seleção com arraste (2026-11-13, verified)
- Bug: com o sticky visível (transcript rolado para cima), arrastar uma seleção para baixo não rolava o chat e a
  seleção pegava editor e status line. Causa: o pi-tui 1.5.2 só ancora a seleção no transcript (e liga o
  auto-scroll) quando `hasOverlay()` é falso, e o sticky é um overlay, mesmo com `nonCapturing`.
- Correção: o `visible()` do sticky devolve falso enquanto `tui.selectionPressActive` (marcado pelo pi-tui antes da
  checagem); `selecting()` em `extensions/sticky-prompt/sticky.ts`. Clique no sticky segue rolando até o prompt.
- Testes: `sticky.test.ts` 8/8 (vermelho antes: export ausente). E2E em pty com pyte (`/tmp/selrepro/repro.py`, 120×40,
  sessão copiada): antes `NOT SCROLLED` no `pi` e em `pi-lite -e sticky-prompt`, e `SCROLLED` no `pi-lite` puro;
  depois `SCROLLED` nos dois; clique no sticky `SCROLLED`.
