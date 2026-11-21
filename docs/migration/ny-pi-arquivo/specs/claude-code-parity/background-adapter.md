# U2: adaptador Pi do `/background`

Derivado de `background.md` (B3, B5, B6, controle e isolamento). Contrato fixo: `claude-home/bin/session-transport/contract.json` (v1, lido de forma preguiçosa por caminho relativo `../../../claude-home/...`, válido no checkout e em `~/.pi/agent`).

## Comportamento
- `extensions/claude-compat/background/`: `record.ts` (contrato, /proc, registro), `tmux.ts` (controle), `index.ts` (comandos e `session_start`); testes em `test/`.
- `session_start`: só com `PI_SESSION_TRANSPORT_ID` hex32, UI, sem `PI_CODE_SUBAGENT` e `PI_LIFECYCLE_ROOT_PID == process.pid`. Valida `<agentDir real>/session-transport/<id>` (dir 0700, `state.json` 0600, UID igual, O_NOFOLLOW, ≤16 KiB, campos exatos, socket derivado do runDir, birth do pane em `/proc/PID/stat`, ascendência até `panePid`). Grava atomicamente `state=running, rootPid, rootStart, sessionId, sessionFile` (null sem sessão); demais campos preservados; `rootPid/rootStart/paneStart` espelham o tipo (número ou string) de `paneStart`. Sem marcador/direct/subagente/headless: silêncio. Capacidade gerenciada inválida: erro claro com dica `pi-session start`.
- `/background [prompt]` e `/bg`: sem UI recusa; revalida capacidade e que a raiz registrada é este processo; `list-clients -t =pi` deve devolver exatamente 1 cliente; prompt não vazio (args intactos) vai uma vez por `sendUserMessage(args, {deliverAs:'followUp', expandPromptTemplates:false})`, mesmo ocioso; revalida o mesmo cliente e executa só `detach-client -t <cliente>`. Falha após enfileirar: avisa "já foi enfileirada", sem retry. tmux: `execFile` com `-S <socket> -f /dev/null`, timeout 3 s, saída ≤4 KiB. Nenhum abort/waitForIdle/newSession/fork/permissão/modelo.
- Matriz: `/background` passa de `unsupported` para `partial` (condicional ao transporte opt-in).

## Suposições a confirmar com U1
- `owner` é o UID (número ou string); `paneStart/rootStart` são o starttime (campo 22 de `/proc/PID/stat`); `paneId` casa `%N`; `tmuxSocket` é `<runDir>/tmux.sock`; sessão tmux `pi` (contrato).

## Pendências fora desta unidade
- Regerar a seção "Matriz completa" de `docs/claude-code-compat.md` (`renderMatrix()`); `clear.test.ts` falha nesse teste até lá.
- Publicar `extensions/claude-compat/background/` e `claude-home/bin/session-transport/` no manifesto.
