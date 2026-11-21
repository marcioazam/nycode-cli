---
description: "Cancela o Ralph Loop ativo neste diretório"
allowed-tools: ["Bash(test -f .claude/ralph-loop.local.md:*)", "Bash(rm .claude/ralph-loop.local.md)", "Read(.claude/ralph-loop.local.md)"]
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /ralph-loop:cancel-ralph (ralph-loop 1.0.1). Mesmo arquivo de estado do porte do
/ralph-loop. -->

# Cancelar o Ralph

1. Confira se `.claude/ralph-loop.local.md` existe com `bash`: `test -f .claude/ralph-loop.local.md && echo "EXISTS" || echo "NOT_FOUND"`
2. **NOT_FOUND**: diga "Nenhum Ralph Loop ativo."
3. **EXISTS**:
   - leia `.claude/ralph-loop.local.md` com `read` e pegue o número em `iteration:`;
   - remova o arquivo com `bash`: `rm .claude/ralph-loop.local.md`;
   - diga: "Ralph Loop cancelado (estava na iteração N)".
