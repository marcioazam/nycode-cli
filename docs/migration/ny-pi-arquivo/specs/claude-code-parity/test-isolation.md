# Isolamento padrão das TUIs de aceite (tmux, HOME, credenciais)

Status: **implementado; contrato `isolation.test.sh` verde; boot real privado provado uma vez; os seis aceites NÃO foram rodados aqui** (o runner integrado roda após o congelamento do código).
Escopo: só isolamento de TESTE (`extensions/claude-compat/test/acceptance/lib.sh`, `commands.sh`, `test/tui-acceptance.sh`). Nenhum código de produção muda.

## Problema (observado)
Execuções focadas de `modes.sh` ignoraram o `-L/-f` exigido e usaram o servidor tmux PADRÃO e o `CLAUDE_CONFIG_DIR` real: o isolamento dependia de instrução ao chamador (shim externo). Um script rodado sozinho era inseguro.

## Contrato (sem opt-in; não há flag que o chamador possa esquecer)
1. `lib.sh` resolve ANTES de trocar `HOME`: `real` (`$HOME/.pi/agent`), `pi_bin` (SDK gerenciado, caminho absoluto; `PI_ACC_PI_BIN` substitui) e o executável `tmux` (`type -P`, antes de existir a função `tmux`).
2. `acc_isolate` (chamado por `acc_init` e por `tui-acceptance.sh`): `work` privado (`mktemp`), `work/home` (HOME falso) com `.ssh` sintético EXISTENTE E VAZIO (modo 700), `work/claude-config` vazio, `work/tmp`; exporta `HOME` e `CLAUDE_CONFIG_DIR` falsos no processo de teste; remove `TMUX`/`TMUX_TMPDIR`; exige `pi_bin` executável.
3. Função `tmux` (sobrepõe o binário para todos os scripts): TODA chamada é `env -i PATH HOME=work/home CLAUDE_CONFIG_DIR=work/claude-config TERM=xterm-256color TMPDIR=work/tmp [LANG] [LC_ALL] tmux -S work/tmux.sock -f /dev/null …`. Logo: socket próprio, sem config do usuário, sem socket padrão, sem ambiente global herdado (sem chaves de provedor, XDG, TMUX). O servidor e o pane herdam só essa lista; `ACC_ENV`, `PI_*` e shims da fixture continuam passando pela linha de comando do pane (nenhum segredo em argv/log).
4. Limpeza: falha mantém o `work` privado (recibo); sucesso remove. Só `kill-session` da própria sessão e `kill-server` do socket PRIVADO; nunca comando no servidor padrão.
5. `tui-acceptance.sh` reutiliza `acc_isolate` (sem duplicar socket/privacidade) e mantém guarda `mark.ts`, fixture Fleet e todas as asserções.
6. `ACC_EXTRA_KEYS` é lido por `acc_init` ao gerar `keybindings.json`: tem de ser definido ANTES dele.

## Segundo defeito de setup (provado)
`commands.sh` definia `ACC_EXTRA_KEYS` DEPOIS de `acc_init`; o remap F9/F10 nunca valeu. Agora o export vem antes, o JSON gerado é asserido (`cursorLeft=["f9"]`, `deleteCharForward=["f10"]`) e, antes do `/vim`, `abcd` + F9 + `X` → `abcXd`, F10 → `abcX`, `Ctrl+U` limpa; os testes Vim existentes ficam intactos.

## Garantias e limites
- Garantido: nenhum comando tmux de script toca o servidor/config padrão; filhos não recebem credenciais/config reais nem HOME real; SDK e helpers reais são lidos só por caminho absoluto (somente leitura).
- Limites: o PROCESSO de teste (bash) ainda herda o ambiente do chamador (só HOME/CLAUDE_CONFIG_DIR trocados); `-f /dev/null` ignora `~/.tmux.conf` (ex.: `escape-time` do usuário não vale). `ACC_ENV="PATH=…$PATH"` reintroduz o PATH do chamador no pane (PATH é da lista permitida). Rede/modelo seguem bloqueados pela fixture, `--offline` e a guarda de entrada, não por este isolamento.

## Verificação
`bash extensions/claude-compat/test/acceptance/isolation-tests/isolation.test.sh`: tmux FALSO em PATH, ambiente vazio com sentinelas FALSAS; afirma `-S/-f` explícitos em todas as chamadas, lista de ambiente permitida, sentinelas ausentes de env/argv, HOME/CLAUDE_CONFIG_DIR falsos e vazios, `.ssh` vazio, SDK absoluto original mantido, keybindings F9/F10, ordem e interação em `commands.sh`, reutilização do lib em `tui-acceptance.sh`. RED contra o lib antigo (sem `-S/-f`, ambiente vazado, 21 chamadas fora do socket privado); GREEN após a correção.
