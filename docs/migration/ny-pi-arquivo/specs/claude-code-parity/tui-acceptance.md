# Aceite TUI (E2E público) da paridade Claude Code — contrato e checkpoint

Status do checkpoint: **escrito, NÃO executado** (nenhuma suíte/TUI rodou; o gate-runner executa uma vez, com tudo estável e aplicado).
Código: `extensions/claude-compat/test/tui-acceptance.sh` (legado atualizado) e `extensions/claude-compat/test/acceptance/*`.

## Regras comuns (lib.sh / fixture.ts)
- Pi real do release instalado (`PI_ACC_PI_BIN` substitui) em tmux, `PI_CODING_AGENT_DIR`, `PI_UI_STATE`, sessões e projeto em `/tmp/pi-acc-*`; `--offline -ne -ns -nc` + `-e` só das extensões do repo e da fixture. Sem MCP, credenciais, rede ou Git.
- `--offline` NÃO impede inferência: a fixture trata TODO prompt (grava em `unexpected`) exceto `FIXTURE-TAG:*` com `ctx.model.provider === 'fixture'`. Provedor `fixture` = `streamSimple` local: uma chamada `write` a um arquivo próprio e texto final fixo; `calls` conta cada chamada. Todo script termina com `no_unexpected`.
- Sondas: `/probe` (cwd, sessionId/arquivo, pid/ppid, env de permissão, `status()` do controlador, estado do plano, ferramentas ativas), `/guard-probe` (guard.py REAL com o ambiente vivo; o comando é só texto), Ctrl+Shift+D (rascunho exato do editor).
- Esperas por condição observável (tela, arquivo, JSONL) com limite; capacidade ausente = `fail`/`need` (nunca pulo). Trap só mata a própria sessão tmux e remove o `mktemp` próprio.

## Execução (um comando por TUI independente)
```
bash extensions/claude-compat/test/tui-acceptance.sh                      # legado: aliases, atalhos, /clear /reset (3 sessões A/B/C + rótulo)
bash extensions/claude-compat/test/acceptance/commands.sh                 # /effort /config /color /mobile /stickers /upgrade, Ctrl+O, /vim
bash extensions/claude-compat/test/acceptance/modes.sh real               # Shift+Tab, /permissions, guard, /focus com pi-code plan-mode REAL (exige patch permission-control)
bash extensions/claude-compat/test/acceptance/modes.sh fixture            # idem com controlador de plano MÍNIMO de fixture (NÃO é o nativo completo)
bash extensions/claude-compat/test/acceptance/directory.sh                # /cd (exige patch pi-core session-cwd)
bash extensions/claude-compat/test/acceptance/restart.sh                  # /restart sob supervisor novo
```
Pré-requisitos de capacidade (falha se ausentes): patch `permission-control` aplicado em `~/.pi/agent/npm/node_modules/pi-code`; patches pi-core `session-cwd`, `editor-actions`, `ui-controls`; supervisor `claude-home/bin/lifecycle/supervisor.sh` (`PI_ACC_REQUIRE_INSTALLED=1` exige o helper global instalado pelo updater); `tmux`, `python3`, `node`.

## Matriz requisito → verificação → falha que pega
| Requisito | Script / passo | Falha que detecta |
|---|---|---|
| `/effort bogus` é falha explícita; válido muda só a sessão | commands: nível antes/depois; sem `defaultThinkingLevel` gravado | volta a delegar ao `/thinking` nativo, aplica lixo, grava settings |
| `/config` chave/valor inválidos recusados sem gravar; tema válido persiste e sobrevive a reload | commands: `cmp` do settings.json, JSON preservado, `/theme` após reload | gravação parcial, outras chaves perdidas, tema só em memória |
| `/color`: SGR real da borda | commands: SGR red≠default, blue≠red, inválida inalterada, default restaura | cor só no texto, cor presa, inválida aceita |
| `/mobile` QR fixo, `/stickers` texto real, `/upgrade` nunca abre navegador | commands: stubs `xdg-open`… gravam chamadas; `/upgrade now` recusado | abertura de navegador/rede |
| Ctrl+O modal rolável, rascunho intacto, sem escape injetado | commands: rascunho antes/depois, teclas do modal não vazam | rascunho perdido/poluído |
| `/vim` insert/normal, `dw`/`u` atômico, Unicode e paste, teclas nativas remapeadas | commands: rascunho exato por passo (CJK, emoji, ñ) | undo em vários passos, grafema partido, dependência das teclas padrão |
| Shift+Tab: default→acceptEdits→plan→default (bypass inelegível, sem auto) | modes: `status.mode` == `PI_PERMISSION_MODE`, bypass 0, plano real/fixture ativo, `write` fora das ferramentas no plano real | ciclo para bypass, variável sem estado real, plano no-op |
| `/permissions` status/modos/auto indisponível/inválido | modes | auto aceito, inválido muda modo |
| guard.py por modo com env vivo | modes: default `touch` ask; acceptEdits `touch` none; `sudo`/`.env` ask em todos | modo não chega ao guard; guardas relaxadas |
| Pipeline real de ferramenta sem rede/modelo | modes: 2 chamadas fixture, arquivo gravado, `unexpected` vazio | prompt vazando ao modelo, provedor errado |
| `/focus` | modes: só último prompt + resumo + resposta; `on/off` não grava; bare persiste `viewMode` | filtro some com mensagens, persistência errada |
| `/cd`: mesma sessão/arquivo/entradas, cabeçalho só com `cwd` novo, ferramenta no novo escopo | directory | novo id, arquivo movido, ferramenta no cwd velho |
| `/cd` recusas (inexistente, arquivo, `~/.ssh`) e confiança com config de projeto (Esc no prompt) | directory: arquivo byte a byte igual, marcador `EXECUTED` ausente | config de terceiros executada, rollback incompleto |
| `--session` em processo novo honra o cwd do cabeçalho | directory | resume no cwd antigo |
| `/restart` sob supervisor, mesma sessão, sem reenvio do prompt inicial, permissão de runtime preservada, sem provedor | restart | prompt reexecutado, volta ao modo de largada, nova sessão, bypass ligado |

## Lacunas conhecidas (não verificadas)
- Nada foi executado: seletores de tela, teclas em tmux (CSI-u Ctrl+Shift+Y, F9/F10 remapeados, `BTab`) e o provedor fake (`@earendil-works/pi-ai` importado de /tmp, nomes de eventos) são hipóteses até a primeira execução.
- Probe do guard fora da TUI: `cat .env` em modo `plan` devolve vazio (sem pergunta); o teste exige `ask` em todos os modos (contrato §6 "guardas não mudam"), logo pode nascer vermelho. A decisão é do dono do guard.
- `/restart` ocupado/efêmero, `/cd` com sessão ocupada, `/focus` com subagentes, `/vim` visual/Ctrl+V e paste muito grande, recarga viva de keybindings (`/reload` com novo remap) e o prompt de confiança nativo aceito não têm TUI própria (cobertos só por testes unitários).
- `bin/pi` real não é executado no restart (lê `local.env` e aplica patches ao instalado); só a fiação é checada por grep. O helper global ainda não instalado é testado pelo supervisor do repositório.
- Cada script é uma TUI; não há repetição para flakiness medida.
