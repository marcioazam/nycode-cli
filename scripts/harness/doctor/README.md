# bin/doctor — manutenção e diagnóstico do harness pi

- `pi-doctor` — valida JSON de settings/mcp/keybindings, caminhos locais do settings, extensões sem `index.ts/js`
  e a pilha de patches de `patches/pi-code` revertendo na árvore instalada. Exit 1 se algo falhar.
- `pi-typecheck [dir]` — `tsc --noEmit` nas extensões contra os tipos da release do pi em uso (testes excluídos).
- `prune-sessions [--days=N] [--apply] [--no-backup]` — retenção dos transcritos JSONL; dry-run por padrão,
  nunca remove `$PI_SESSION_FILE`.

Origem: adoções da auditoria de configs públicas, `claude-home/docs/third-party-adoptions-2026-11-13.md`.
