# Backend `pi-session` (U1): decisões de implementação

Complementa `background.md` (autoridade) e `claude-home/bin/session-transport/contract.json` (v1, congelado, só o coordenador altera). Escopo: CLI `pi-session start [-- args] | list | attach <hex32>`; `bin/pi` e o supervisor ficam intactos.

## Layout
`claude-home/bin/pi-session` (shell, só `exec python3 …/cli.py`) · `session-transport/`: `cli.py` (comandos, resolução do launcher, headless, fluxo de exit), `transport_tmux.py` (tmux privado, handoff, liveness, attach), `transport_state.py` (registro, ownership, limites, cleanup), `bootstrap.py` (dono do wait no pane), `tests/` (stdlib `unittest`).

## Decisões onde o record deixava margem
- **agentDir**: `PI_CODING_AGENT_DIR`, senão `$HOME/.pi/agent`; `realpath`, dono = UID atual. Transporte em `<agentDir>/session-transport/<hex32>/{state.json,tmux.sock,attach.lock}` (dirs 0700, arquivos 0600). Caminho de socket > 100 bytes é recusado (limite `sun_path`).
- **Launcher**: `PI_SESSION_LAUNCHER` (absoluto, executável, contém `supervisor.sh` e `pi_run_supervised`; sem fallback se inválido) → `<repo>/bin/pi` do checkout (dois níveis acima de `claude-home/bin`, realpath do helper) → `~/.local/bin/pi` com os mesmos marcadores. Nunca `command -v pi`.
- **Headless/passthrough** (B2): sem TTY (stdin e stdout), ou `pi_lc_headless` do `supervisor.sh` real (executado via `sh -c '. supervisor; pi_lc_headless "$@"'`), ou `PI_CODE_SUBAGENT=1` no ambiente (subagente real; o marker sozinho, de chamador interativo, NÃO é headless) ⇒ `exec` do launcher, sem tmux nem registro. Os args do usuário aparecem brevemente no argv do `sh` de classificação (mesmo usuário, igual ao argv do próprio pi).
- **Handoff**: `tmux start-server ; set-option … ; new-session -d` numa invocação (opções valem no primeiro pane); o pane executa `python bootstrap.py <id> <runDir>`. Pai: `load-buffer -b pi-startup -` (stdin, sem `-w`) e `wait-for -S pi-startup`. Bootstrap: `wait-for` (≤10 s) → `save-buffer -` em memória → `delete-buffer` → `Popen(argv)` sem shell. Payload JSON `{"argv":[launcher,…args]}` ≤ 1 MiB.
- **Estados**: bootstrap grava `starting` (panePid/paneStart/paneId de `TMUX_PANE`), muda para `running` **antes** do spawn (sem corrida com a raiz) e só volta a gravar após o launcher terminar (`ended` + exitCode, lendo o registro FRESCO; ilegível ⇒ base própria). `state=ended` ⇔ `exitCode` inteiro 0–255. `owner` = UID numérico.
- **Saída**: filho por sinal ⇒ 128+sinal; TERM/HUP encaminhados uma vez ao filho próprio ⇒ 128+sinal; INT = handler no-op. Falha de handoff = 70, spawn = 127 (ambíguo com o mesmo código vindo do Pi; o CLI avisa).
- **Após o cliente sair** (`finish`): `ended` ⇒ exitCode; `running` + rc 0 + liveness (socket socket-do-dono, `panePid`+birth `/proc/<pid>/stat` campo 22, `list-panes`) ⇒ 0 (detach); qualquer outra coisa ⇒ erro 1, sem relançar. Falha de attach após o handoff nunca mata o servidor; imprime a recuperação.
- **Attach**: `flock` não bloqueante em `attach.lock` + `list-clients` exatamente 0 ⇒ `attach-session -t pi` (sem `-d/-a/-P`). Início rápido que termina antes do attach devolve o exitCode direto.
- **Limites/cleanup**: ≤128 diretórios; excesso tenta limpar encerrados (só `state.json`, `tmux.sock`, `attach.lock`, `.state-*`; recusa symlink/dir/estranho sem remover nada), depois falha. `list` imprime só `id estado live|stale|invalid|exit=N`.

## Verificação
`python3 -m unittest discover -s claude-home/bin/session-transport/tests` (usa tmux 3.6 privado em socket próprio, PTY externo, launcher fixture com supervisor real e CLI nativo fictício; HOME/agentDir/env temporários). Cobertura por arquivo via `tests/claude-compat/pycov` (todos ≥80 %). Não verificado aqui: attach sob tmux aninhado, teclas CSI-u através de cliente real, resize, `/background` (U2), E2E com Pi real (U3).

## Fix-round1 (integração)
- **Commit do start**: após o handoff sinalizado nada é morto nem apagado; falha em `wait_running` mantém ID/servidor/estado e orienta `pi-session list|attach <id>` (nunca relança). Kill/limpeza só antes do handoff.
- **Cleanup**: só `ended` com pane morto (PID+birth), socket sem ouvinte e `attach.lock` próprio obtido sem bloquear; `attach` lê o exitCode ainda sob o lock. Artefato desconhecido/symlink: intocado.
- **Alocador**: `allocate(root)` sob flock de `session-transport/.alloc.lock` (regular, dono, 0600, nofollow, não bloqueante); ≤128 com varredura `scandir` limitada; criação dentro do lock. ID: `fullmatch` + 32 chars.
- **Schema v1 estrito**: inteiros numéricos (não bool), `panePid/paneStart>0`, `paneId` `%N`, `rootPid/rootStart` null ou >0, `exitCode` 0..255 sse `ended`; escrita completa com fechamento do FD em exceção.
