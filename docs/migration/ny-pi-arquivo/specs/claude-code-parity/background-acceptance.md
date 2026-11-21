# Aceite público do background (U3)

Spec: `background.md` (B1–B10), `claude-home/bin/session-transport/contract.json`. Teste: `extensions/claude-compat/test/acceptance/background.sh` + `background-fixtures/{provider.ts,helpers.sh}`. Estado: **AUTORADO, NÃO EXECUTADO** (só `bash -n`; sem RED/GREEN observado; sem E2E real enquanto U1/U2 são corrigidos). Fixtures: `{provider.ts,helpers.sh,cleanup.sh,scenarios-extra.sh}`.

## Execução
```
bash extensions/claude-compat/test/acceptance/background.sh [contract|main|plan|bypass|restart|multi|subagent|refuse|passthrough|all]   # padrão all
PI_BG_SESSION_BIN=<pi-session alternativo>  PI_BG_EXT_ROOT=<raiz extensions/ alternativa>              # só para a receita RED
```
Dependências: tmux 3.6, Python3, Node, SDK instalado em `~/.pi/agent/install/...` (resolvido antes de HOME virar falso), plan-mode nativo com patch `permission-control` (cenário `plan`; ausente = falha). Sem rede, Git, credenciais, clipboard do host nem bin/pi/local.env globais.

## Isolamento
`lib.acc_init` (HOME/CLAUDE_CONFIG_DIR falsos, `/tmp` privado) + tmux EXTERNO próprio (`-S $work/tmux.sock -f /dev/null`, env permitido). O tmux INTERNO é o criado por `pi-session start` em `$agent/session-transport/<id>/`; o teste só o toca pelo socket do registro (verificado sob o agentDir). `PI_SESSION_LAUNCHER` = launcher próprio com o `supervisor.sh` REAL e `.bin/pi` nativo como BIN. Pi: `-ne -ns -nc -e compat -e ui -e provider.ts --model fixture/background`. Guarda de entrada: todo prompt sem `BG-TAG:` vai a `unexpected` antes da inferência. Limpeza só do que é próprio; falha mantém `$work` (registro, telas, `calls`, `probe`).

## Cenários → requisito → falta que pegam
| Cenário | Verifica | Falha plausível detectada |
|---|---|---|
| main | tool `bash` bloqueada no FIFO; `/background` ocupado: cliente sai rc0, Pi vivo, 0 chamadas extras, 0 clientes; `list` sem prompt/argv; FIFO liberado SEM cliente → resultado + `bg-final`; `attach` real: mesmo PID/sessionId/arquivo, prefixo JSONL idêntico, sem replay/inferência, modo acceptEdits e bypass 0 preservados; C-a legado + CSI-u (Ctrl+Shift+Y) injetados no pane EXTERNO; resize → geometria do Pi; OSC52 → buffer do tmux externo; `/background <prompt>` com canários `!`, `$()`, crase, `{{x}}`: 1 mensagem literal exata, nada executado, 1 volta de inferência; erro de provedor visível (B1,B3,B4,B5,B7,B10) | detach que aborta/forka; replay no attach; prompt expandido/executado; teclas só via send-keys interno; resize ignorado |
| plan | plan nativo preservado após detach+attach e write não-plano segue bloqueado (disponibilidade do hook, não ausência de tools) | attach que reinicia permissão/plan |
| multi | 2 clientes: `/background` e `attach` recusam sem desanexar ninguém; `pi` direto e Pi com marker roubado (modelo de subagente herdando marker) recusam com erro de opt-in (B6) | detach amplo; confiar só no marker |
| refuse | id inexistente/não hex32, versão 99, registro obsoleto, `state.json` symlink: rc≠0, servidor-sentinela (outro tmux privado) intacto e sem clientes, alvo do symlink intacto, 0 inferência (B6,B9) | agir no socket do registro sem validar liveness; seguir symlink; apagar desconhecido |
| passthrough | `--version`, `-p`, `--mode rpc` (sem TTY e sob PTY): launcher original, sem registro nem tmux interno (B2) | criar tmux em headless |
| contract | Limpeza SEM Pi nativo: servidor interno próprio (registro sob `session-transport`) para com seus descendentes; sentinela e socket fora do transporte intactos; no instante de `acc_cleanup` PIDs/socket internos e sentinela já parados; falha de terminação => `acc_cleanup` recebe rc 1 (work preservado) | limpeza que só mata o servidor externo (vaza Pi/tmux e apaga estado vivo), mata socket alheio ou engole falha |
| bypass | `PI_BYPASS_ELIGIBLE=1` desligado: detach+attach mantêm PID/sessionId/arquivo, modo, `PI_BYPASS_PERMISSIONS=0`, 0 inferência; DEPOIS `/permissions bypassPermissions` (probe `mode=bypassPermissions`, `envBypass=1`) e outro detach+attach: mesmo PID/ID/arquivo/modo/`envBypass=1`, 0 inferência | attach/detach que religa bypass ao reentrar |
| restart | `/restart` real sob o transporte: mesmo ID/sessionId/arquivo/supervisor/marker, PID da raiz muda, registro acompanha (`rootPid` = novo PID, `rootStart` novo), modo de runtime preservado; `/background` e `attach` seguem válidos | registro com raiz velha (todo `/background` recusado) ou restart que perde o transporte |
| subagent | `PI_CODE_SUBAGENT=1` + marker herdado, com PID raiz próprio e com PID raiz herdado: `/background` recusa antes de qualquer controle (cliente gerenciado não sai, `state.json` idêntico) | controle liberado por marker/PID raiz sem checar a flag de subagente |

`psrun` (list/passthrough) leva `BASE_ENV`+`EXTRA_ENV` sob `env -i` com HOME/config falsos e sem chaves de provedor: o provedor fixture precisa de `PI_ACC_CALLS`. O EXIT é `bg_cleanup` (`cleanup.sh`): termina os servidores INTERNOS (registro regular sob `$agent/session-transport/<hex32>/`, socket validado dentro dessa árvore, sem `..`) com `tmux -S <socket> kill-server`, espera limitada pelos PIDs próprios (panes + descendentes, via /proc), encerra sentinela e o tmux externo, e só então `acc_cleanup`. Sem SIGKILL, pkill nem socket padrão; PID ainda vivo ou `work` não removido => rc≠0 e `work` preservado como recibo.

## RED (TDD crítico, uma vez, na verificação final)
Não reverter trabalho alheio. Em cópia temporária (`cp -r` de `extensions/` e `claude-home/bin/` para `/tmp`, sem Git), trocar o handler `/background` por no-op que não faz nada (o comando continua registrado; módulo/import ausente NÃO vale como RED) e rodar `PI_BG_EXT_ROOT=<cópia>/extensions bash extensions/claude-compat/test/acceptance/background.sh main`: o RED esperado é a falha de asserção "o cliente externo não saiu após /background" (e não erro de import/arquivo). Depois, com a implementação real, o runner final `background.sh all` roda UMA vez (sem repetições nem retentativas: flaky é defeito a corrigir). `contract` não depende de produção: sua falta seria mutação do próprio helper (ex.: acc_cleanup antes dos internos), não executada.

## Lacunas declaradas
- Nada foi executado (só `bash -n`); RED/GREEN, E2E com Pi nativo e a verificação do runner ficam para a execução final congelada.
- Subagente real não é lançado (custo/modelo): o cenário `subagent` reproduz o ambiente herdado (flag + marker + PID raiz próprio/herdado), não prova frota real. `multi` mantém o marker roubado. Hooks nativos do plan (`plan`) preservados.
- Limpeza (V10): `lib.sh` `acc_stop_server` é o dono único da parada do tmux PRÓPRIO (também usado por `bg_stop_server`, sentinela e `acc_cleanup`): espera limitada dos panes+descendentes e do processo do servidor (PID+birth) e remove só o arquivo de socket inerte (tmux 3.6 o deixa após sair) antes de apagar o work; falha = rc≠0 e work preservado. Regressão: `isolation-tests/cleanup-wait.test.sh` (tmux falso assíncrono; o controle com a lógica antiga tem de falhar).
- `bg_pty` usa sessão externa única por tentativa (contador), não reutiliza `pty-r` (duplicate session). `restart` recusa antes do 1º prompt (negativo explícito: PID/registro inalterados, 0 chamadas), depois semeia `BG-TAG:once` (1 chamada, JSONL com `bg-text`) e exige 0 chamadas NOVAS (baseline 1) após restart/detach/attach.
- Em `bypass`, o modo esperado vem do valor observado na largada (não fixa a string `default` de `status.mode`); `restart` assume que a raiz do registro é o PID do Pi (supervisor faz `exec`).
- Servidor tmux privado define `set-option -s set-clipboard on` (tmux 3.6: o padrão `external` ignora OSC52 da aplicação); coberto por `test_server_args_have_no_user_args` (RED→GREEN local, sem clipboard do host). O E2E real usa buffer externo falso e sink.
- OSC52: se o buffer do tmux externo não recebe o canário, `main` FALHA (não é ignorado); a causa pode estar no backend, mas o teste não passa.
- Cobertura de linha dos arquivos de teste/shell: NÃO MEDIDA. Cobertura de produção: medida só pelo gate final.
- Mensagens de erro verificadas só por regex genérica (`pi-session|opt-in|transport|subagent`).
- Limpeza não manda SIGKILL: Pi que ignore SIGHUP faz o aceite falhar com recibo, não ser morto à força.
