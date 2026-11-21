# commands.sh — correção de premissas de teste (status: escrito, NÃO executado)

Escopo: só `extensions/claude-compat/test/acceptance/commands.sh`. Nenhuma mudança de produção.

| Passo | Contrato antigo (errado) | Contrato novo | Evidência |
|---|---|---|---|
| `/config theme=light` | esperava o toast `theme = "light"` | espera a mensagem FINAL `Tema aplicado agora.`; gravação provada pelo `settings.json` (tema + `tuiMode`/`quietStartup` preservados) | `commands/settings/config.ts` `apply`: notifica `theme = …` e logo `Tema aplicado agora.` (o segundo substitui o primeiro); red observado: tema aplicado, toast sobrescrito |
| Leitura do tema após reload | `/theme` | `/claude-theme` (consulta persistida: `Tema configurado: "light"`) | `aliases.ts`: `/theme` sem argumento → `/settings`; `/theme` puro não é status. Não se afirma que a saída de `/theme` puro seja pretendida |
| Limpar buffer Vim NORMAL (Unicode) | `C-u` | `gg0dGi` + `wait_draft ''` | `C-u` apaga só antes do cursor (cursor não está no fim após `iX`/Esc); `gg`/`G`/`dG` suportados (`vim/motions.ts`). Semântica do Vim inalterada |
| `/vim` off | digitava em NORMAL | `gg0dGi` (volta a INSERT) antes de `send` | `send` usa `C-u` + texto; em NORMAL viraria comandos |
| Transcrição (Ctrl+O) | `Transcrição.*(ajuda\|fecha)` e `Transcrição` solto | cabeçalho exato `Transcrição ? ajuda · q fecha` (`transcript-view.ts:78`), exigido ausente antes de abrir | evita casar texto velho/descrição de comando; ciclo: abre → presente; `q`/Ctrl+O → ausente |

Mantidas todas as asserções de movimento/operador/Unicode/paste/undo atômico (`wait_draft` com rascunho exato via atalho nativo).
Validação: `bash -n` OK; execução integrada pendente (main roda após todas as lanes).

## Correção do aceite TUI (commands.sh) — causa provada

- Falha "atalho de rascunho não respondeu": o fixture registrava `ctrl+shift+d`, mas Shift+Ctrl+D é o `/debug` global do TUI nativo (`pi-tui` `handleTerminalInput`, `ui.onDebug`), consumido ANTES do componente focado e das extensões. Prova: `agent/pi-debug.log` gravado exatamente ~5 s (timeout do `draft()`) antes do `FALHOU`, no primeiro `wait_draft` (antes do Ctrl+O), com o rascunho `rascunho-ctrlo` visível e sem modal. Ctrl+O/transcrição não tinham defeito (produção inalterada).
- Reparo: atalho de despejo `ctrl+shift+y` (CSI-u `ESC[121;6u`) em `fixture.ts`/`lib.sh`; todas as asserções mantidas.
- Falha seguinte (corrida de teste, não produção): `Esc` + `0dw` em sequência vira Alt+0 no TUI (`0` engolido, `dw` digitado). `commands.sh` agora usa `to_normal` (espera o rótulo `NORMAL`, sensível a maiúsculas, evidência real de modo) antes das teclas seguintes.
- Resultado: `commands.sh` exit 0 inteiro (inclui Ctrl+O, remap F9/F10 e /vim).
