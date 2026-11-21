# scripts/harness/doctor — manutenção e diagnóstico do harness nycode

- `pi-doctor` — valida JSON de settings/mcp/keybindings, caminhos locais do settings e extensões sem `index.ts/js`
  em `~/.nycode/agent`. Exit 1 se algo falhar.
- `pi-typecheck [dir]` — `tsc --noEmit` nas extensões contra os tipos do checkout (`npm run build` antes; testes excluídos).
- `prune-sessions [--days=N] [--apply] [--no-backup]` — retenção dos transcritos JSONL; dry-run por padrão,
  nunca remove `$NYCODE_SESSION_FILE`.

Os nomes `pi-*` dos arquivos mudam na F12 (R1).
