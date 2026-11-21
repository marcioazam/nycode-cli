# Aceite de teclado nativo (Ctrl+Enter, cancelamento, fila) — isolamento do E2E

Status: **isolado e executado uma vez: 9/9 verdes** (`claude-home/bin/tests/interactive-input/native-cli-e2e.test.ts`). Só teste; nenhuma mudança de produção, launcher ou SDK.

## Contrato de isolamento (sem opt-in)
1. CLI nativo = JS do SDK gerenciado (`~/.pi/agent/install/releases/<current-version>/node_modules/.bin/pi` → `realpath` `dist/bundle/cli.js`), resolvido ANTES do HOME falso, somente leitura, executado com `process.execPath`. Nunca `~/.local/bin/pi` (wrapper: local.env, patches, supervisor).
2. `PI_E2E_BIN` aceita só uma CÓPIA de `cli.js` nativo (vermelho comportamental); também roda via Node.
3. tmux resolvido do PATH (`realpath`) antes de sanitizar; TODA chamada: `-S <raiz privada>/tmux.sock -f /dev/null`, ambiente reduzido. `kill-session` só da própria sessão; `kill-server` só do socket privado.
4. Cada app: `env -i PATH HOME CLAUDE_CONFIG_DIR TMPDIR TERM LANG PI_CODING_AGENT_DIR PI_OFFLINE`, todos sob a raiz `mkdtemp` (0700), mais `--offline`. Nenhuma credencial/XDG/MCP/TMUX/SSH real. A chave é a literal falsa do `models.json` local; provider falso em `127.0.0.1` porta efêmera. A extensão de fila (`agent/extensions/custom-completion.ts`) continua carregada pelo `PI_CODING_AGENT_DIR` privado.
5. tmux ou SDK ausente FALHA explicitamente (sem skip). Falha mantém a raiz (recibo); sucesso a remove.
6. Teste "isolamento": sentinelas FALSAS no ambiente do chamador não atravessam; chaves do ambiente do filho = lista branca exata; `-S/-f` em todas as chamadas.

## Execução (uma vez)
`node --experimental-strip-types --test claude-home/bin/tests/interactive-input/native-cli-e2e.test.ts` → exit 0; log `/tmp/native-e2e-run.log`.
Ctrl+Enter / Ctrl+X Ctrl+S cancelam a tool e enviam o rascunho; Ctrl+Enter durante `!bash`; Enter só enfileira; editor vazio é no-op; F1 (rascunho + mensagem custom; vazio preserva custom); Ctrl+Shift+↑/Ctrl+U: todos ✔.
Servidor tmux padrão intocado: `/tmp/tmux-1000/default` com mesmo inode (7773946) e mtime antes/depois, 104 sockets antes/depois, `tmux ls` → "no server running".

## Limites
- `pgrep/pkill -f <marcador>` permanece (marcador `sleep 3<PID><n>` único do runner): é a única forma de observar/encerrar a tool do modelo falso sem mudar produção; não toca o tmux.
- O processo de teste herda o ambiente do chamador (só os filhos são reduzidos). `-f /dev/null` ignora `~/.tmux.conf`.
- O E2E assume o patch send-now já aplicado ao SDK gerenciado (o wrapper não roda mais aqui); se ausente, falha por comportamento.
