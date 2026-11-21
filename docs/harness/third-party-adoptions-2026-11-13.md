# Adoções da auditoria de 27 configs `~/.pi` de terceiros (2026-11-13)

Auditoria: `/tmp/pirev/report-1..4.md` → síntese `/tmp/pirev/synthesis.md` (88 candidatos → 24 ideias).
Aprovado pelo usuário: o bloco "A ADOTAR" (6 itens). Os 12 "A MEDIR" e os conflitos seguem não aplicados.

## O que entrou

| # | Item | Implementação | Custo por execução | Benefício |
|---|---|---|---|---|
| A1+A2 | git não interativo e pagers desligados | `settings.json` → `shellCommandPrefix` = `export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no GIT_PAGER=cat PAGER=cat AWS_PAGER= LESS=FRX` (recurso nativo, `docs/settings.md:143`) | ~110 bytes por comando bash, zero processo extra | acaba com a classe "agente pendurado no editor/pager do git" (fonte: kitevi `git-editor-guard.ts`, Mic92 `git-rebase-env.ts`, joelazar `modify_settings.json:9`) |
| A3 | timeout padrão e teto no bash | nova extensão `extensions/bash-timeout/` (`index.ts` + 6 testes): sem `timeout` → **600 s**; acima de **1800 s** → `block` com instrução de `nohup` | 1 hook `tool_call`, O(1) | o pi **não tem timeout padrão** (`dist/core/tools/bash.js:17`, máximo 2147483647 ms): um comando travado só morre com Esc (fonte: Bekaboo `bash-timeout.ts`, woksin `wait-guard.ts`) |
| A4 | `pi-doctor` | `claude-home/bin/doctor/pi-doctor` (shell + python3): JSON de settings/mcp/keybindings, caminhos locais do settings resolvidos como o pi, extensões sem `index.ts/js`, e a pilha de patches revertendo na árvore instalada | só sob demanda | hoje path quebrado ou JSON inválido só aparece como aviso silencioso no startup (fonte: nicknisi `bin/pi-doctor`) |
| A5 | typecheck das extensões | `claude-home/bin/doctor/pi-typecheck`: gera tsconfig em /tmp apontando para `install/releases/$(cat current-version)` e roda `tsc --noEmit` (tsc 7.0.2 global); testes excluídos (stubs parciais de propósito) | ~30 s sob demanda | o LSP não sobe neste diretório; erro de tipo só aparecia em runtime (fonte: MariaSolOs `.pi/AGENTS.md:5-8`, nicknisi `home/.pi/package.json`) |
| A6 | `prune-sessions` | `claude-home/bin/doctor/prune-sessions`: retenção por mtime, dry-run por padrão, `--apply`, backup `.tar.gz`, `umask 077`, nunca remove `$PI_SESSION_FILE` | só sob demanda | 152 MB / 142 transcritos com os prompts em texto, sem nenhuma política (fonte: cskwork `scripts/prune-sessions.sh`) |

## Decisão: 600 s de padrão, não 120 s

O `plan-reviewer` apontou que 120 s (valor do Bekaboo) mataria o `git-deliver gate`, que roda numa única chamada
`bash` sem `timeout` e leva minutos — o gate pareceria vermelho. Padrão subido para 600 s e teto para 1800 s:
mantém o efeito de matar comando pendurado sem atrapalhar o gate obrigatório.

## Defeitos encontrados pelo A5 (corrigidos no mesmo passe)

- `extensions/ui/btw.ts:66` — `ctx.sessionManager` é tipado como `ReadonlySessionManager`, que não declara
  `buildSessionContext()`; em runtime é a `SessionManager` (`session-manager.d.ts:329`). Resolvido com cast
  documentado.
- `extensions/ui/editor.ts:160` — argumento de tipo em chamada sobre `any` (TS2347). Resolvido anotando a const.

## Evidência

- `bash-timeout`: 6/6 testes (teto ajustado para 1800 s) (`node --experimental-strip-types --test`).
- `pi-doctor`: verde no harness real (3 caminhos locais, 13 extensões, 14 patches revertem) e vermelho com
  fixture quebrada (JSON inválido, path ausente, extensão sem index) → exit 1.
- `pi-typecheck`: exit 0 após as 2 correções; suítes `ui/*` e `dev-commands/*` seguem verdes (8 arquivos).
- `prune-sessions`: dry-run no harness (0 a remover, 142 arquivos); fixture com 3 antigos + 1 novo removeu 2 e
  preservou `$PI_SESSION_FILE`; backup `.tar.gz` verificado com `tar -tzf`.
- Backup do settings antes da mudança: `settings.json.bak-shellprefix`.

## Estrutura e relatórios

Os três scripts vivem em `claude-home/bin/doctor/` e os quatro lints em `claude-home/bin/checks/` (com seus testes
ao lado): `bin/` passou de 11 arquivos de código na raiz para 4 e agora sai sem findings no
`bin/structure/structure.py`. Os relatórios da auditoria ficaram em `docs/research/2026-11-13-pirev-reports.md` e
`docs/research/2026-11-13-pirev-synthesis.md`; os 2,6 GB de clones em `/tmp/pirev` foram removidos.

## Não adotado (continua valendo)

Os 12 itens "A MEDIR" da síntese (versionar `~/.pi/agent` sem drift, guarda de pin de modelo, cache de 5 min para
filhos, background real, gitleaks no commit, custo por sessão, etc.) e todos os CONFLICTS (trust "ask"/"always",
sistemas de permissão, codemode, context-mode, model-router, fallback para Codex).

Reverter: `settings.json.bak-shellprefix`; apagar `extensions/bash-timeout/` e o diretório `claude-home/bin/doctor/`.
