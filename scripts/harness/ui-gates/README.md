# Portões de ui (paridade visual com o ny-pi)

Prova de C-F7-27: o nycode não tem diferença visual em relação ao ny-pi. Os scripts só leem o repositório; tudo que
escrevem fica num `mktemp -d`, apagado ao sair. Saem 0 só se todos os checks passam.

Pré-requisitos: `npm ci --ignore-scripts`, `npm run build` (o binário é `packages/coding-agent/dist/bundle/cli.js`),
`@vitest/coverage-v8` (devDependency, ainda não declarada no repo), `jq`, `rg`; o e2e também pede `tmux`.

```bash
bash scripts/harness/ui-gates/pi-ui-final-gate.sh          # portão final (nome histórico de prova)
bash scripts/harness/ui-gates/terminal-sota/gate.sh        # terminal-sota: U1..U4 e tema
bash scripts/harness/ui-gates/terminal-sota/e2e.sh         # nycode real no tmux; 1 chamada de modelo
```

O e2e usa `auth.json` e `settings.json` de `$NYCODE_E2E_AUTH_DIR` (padrão `~/.nycode/agent`), copiados para o diretório
temporário.

## Mapa: check antigo → novo

`pi-ui-final-gate.sh`

| Antigo | Novo / motivo |
| --- | --- |
| 1 ui + cobertura | `vitest --coverage` nos testes de `test/harness/extensions/ui`, cobertura de linhas ≥ 80 em cada arquivo de `src/extensions/ui/` (1b: o mesmo para `ui-visual`) |
| 2 patches da tarefa | rewind-tree, todo-collapse e notify-focus são extensões do core: testes de `git-checkpoint`, `todo`, `notify` com cobertura ≥ 80 nos arquivos de cada extensão |
| 3 pi-code, todos os testes | `vitest --run test/harness` (pacote coding-agent inteiro de harness) |
| 4 hud | removido: claude-hud é dependência externa do dono; os testes dele migram na F8 (R13/R14) |
| 5 som, syntax-check, pi-docs | os três testes vitest (`sound-notify`, `syntax-check`, `docs-pointer`) com cobertura ≥ 80 |
| 6 hooks, dispatch | removido: testes python migram na F8 (R10) e rodam no pytest do `run-static.sh` |
| 7 `bash -n` do wrapper | removido: `bin/pi` foi absorvido pelo core (K01); o 13 roda o binário |
| 8 structure.py | `scripts/ci/lint/structure_changed.py` sobre `src/extensions`, `test/harness`, `resources`, `scripts/harness` |
| 9 check-instructions | removido: migra na F8 (R15) |
| 10–12 pilha de patches | removidos: o código agora é fonte (F5/F6); a prova é o próprio git |
| 13 `pi -p` sem aviso | binário do repo com HOME e agent dir isolados, offline: `--mode rpc` + `get_commands` responde com sucesso e stderr vazio (sem modelo) |
| 14 manifesto inalterado | `git status --porcelain` igual antes e depois do gate |

`terminal-sota/gate.sh`

| Antigo | Novo / motivo |
| --- | --- |
| 1 ui, 2 dev-commands, 3 sticky | testes vitest de `ui`, `dev-commands`, `sticky-prompt` com cobertura ≥ 80 por arquivo da extensão |
| 4 tema tokyo-night | `loadThemeFromPath` e `validateThemeJson` do core (`modes/interactive/theme`) sobre `resources/themes/tokyo-night.json`, mesmo mapeamento de cores |
| 5 HUD colors | removido: dependência externa do dono, fora do produto |
| 6 structure.py | `structure_changed.py` (igual ao 8 acima) |
| 7 check-agents, 10 check-instructions | removidos: migram na F8 (R15) |
| 8 pi_harness_check, 9 harness-audit pytest | removidos: auditoria da instalação do dono |
| 11 RPC get_commands | binário do repo: `copy-code`, `keybindings`, `diff` presentes (a skill `cua-driver` é do dono e saiu) |
| 12 `~/.agents/skills` vazio | removido: propriedade da máquina do dono |

`terminal-sota/e2e.sh`: mesmos 8 passos, apontando para o binário do repo, com HOME, agent dir, sessões e repositório
git em `mktemp`.

Enquanto a extensão `ui`, `ui-visual` e o tema não estiverem no core (ramo `mig/f7-ui`), os checks que dependem deles
falham com "esperado: falta F7 ui".
