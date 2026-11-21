# Fix round: setup de teste reproduzível e cobertura Python (2026-11-14)

Origem: gate A (`~/.cache/git-deliver/pi-harness/20261114T200700Z-gate/`). Sem instalar pacote, sem `package.json` na raiz.

## 1. SDK pi nos testes (ERR_MODULE_NOT_FOUND `@earendil-works/pi-tui`)
Causa: `.ts` sob `extensions/` e cópias em `/tmp` importam `@earendil-works/*` e `typebox` por nome nu; não há `node_modules` na raiz do repo (e o `npm/node_modules` do pi-code não os traz).
Solução: hook de resolução do Node, só para o SDK conhecido, apontando para o `node_modules` gerenciado fixado (`~/.pi/agent/install/releases/<current-version>/node_modules`, hoje 1.5.2). Resolve do jeito normal primeiro; só no `ERR_MODULE_NOT_FOUND` de `@earendil-works/*`/`typebox` usa a raiz gerenciada. Pacote do SDK inexistente continua falhando. Filhos herdam por `NODE_OPTIONS`; `PI_TEST_SDK_ROOT` (fixado pelo wrapper com o HOME real) sobrevive a testes que trocam `HOME`.

Arquivos: `claude-home/bin/tests/claude-compat/{with-sdk.sh,sdk-register.mjs,sdk-hooks.mjs,sdk-hooks.test.mjs}`.

Prefixo de execução para o runner final (da raiz do repo):
```sh
W=claude-home/bin/tests/claude-compat/with-sdk.sh
CLEAN="env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH -u PI_CODE_SUBAGENT_ALLOWED_AGENTS -u PI_CODING_AGENT -u PI_SESSION_FILE -u PI_PERMISSION_MODE"
PI_TEST_SDK_VERSION=1.5.2 $CLEAN bash $W node --experimental-strip-types --experimental-test-coverage --test … # unit-compat-ui, unit-interactive-offline, patch-mjs…
node --test claude-home/bin/tests/claude-compat/sdk-hooks.test.mjs     # autoteste do hook (5 testes)
```
`$CLEAN` é obrigatório quando o gate roda DENTRO de um subagente/pi: `PI_CODE_SUBAGENT_DEPTH>=1` (e demais) faz `root-routing-integration`/`detach-capacity` falharem por timeout (reproduzido: 36/36 verde limpo, 16/36 com as variáveis). Um runner fora do pi não precisa.

Resultado (esta máquina): `interface/*.test.ts`, `clear.test.ts` 22/22; `root-routing`+`async-default-routing`+`detach-capacity` 36/36; `unit-compat-ui` completo: 625 ok, 5 falhas que NÃO são de setup (3 do `editor-vim.test.ts`: remap/render/seleção, 2 de `interface/test/transcript.test.ts` linhas ~81: dependem de engine/editor/transcript de outros escritores).

## 2. Fixture do UiEditor vim
`extensions/ui/test/vim/editor-vim.test.ts` copia agora `claude-compat/permissions/slot.ts` (importado por `ui/editor.ts`; o `import type` de `controller.ts` é apagado pelo strip-types) e afirma sha256 igual ao da fonte (`fixture: permissions/slot.ts copiado é idêntico à fonte`). Sem reescrever mocks.

## 3. Cobertura Python sem instalar nada
`coverage` não está instalado e dependências são proibidas. `claude-home/bin/tests/claude-compat/pycov/` usa só a stdlib:
- `run.sh DATA ROOTS -- cmd…`: `PYTHONPATH` com o `sitecustomize.py` (sys.monitoring, Python ≥ 3.12; aqui 3.14), herdado por subprocessos Python (inclusive o `guard.py` chamado pelos testes). Cada processo grava `<pid>-<ns>.json` ao sair (sem corrida); caminhos por realpath.
- `report.py --data DATA --file F --dir D [--min 80]`: junta os JSON, inventário executável via `co_lines` de todos os code objects (módulos nunca importados = 0%), lista linhas faltantes, exit 1 abaixo do mínimo. Sem linha executável → `sem-linhas`, nunca 100% inventado. Sem exclusões/waivers (só `tests/`, `test_*.py`, `__pycache__` fora do inventário).
- Autoteste: `python3 -m unittest claude-home/bin/tests/claude-compat/pycov/test_pycov.py` (5 testes: fixture mínima com subprocesso herdado, módulo não importado, fora das raízes, exit code, uso).
Comando guard + permissions (da raiz):
```sh
H=claude-home/hooks; D=$(mktemp -d /tmp/pycov-guard.XXXXXX)
bash claude-home/bin/tests/claude-compat/pycov/run.sh $D $PWD/$H/guard.py:$PWD/$H/permissions -- bash -c "python3 -m unittest discover -s $H/permissions/tests -t $H; cd $H && python3 -m unittest test_guard.py"
python3 claude-home/bin/tests/claude-compat/pycov/report.py --data $D --file $H/guard.py --dir $H/permissions --min 80
```
Medido: guard.py 96,2% (355/369), `permissions/__init__` 1/1, decide 31/31, modes 15/15, paths 74/74, shell 97,5% (237/243): todos ≥ 80%.
Limites: presença de linha (não contagem; cada local é desligado após o 1º hit); processos mortos por sinal/`os._exit`, `python -I/-S` ou com outro `sitecustomize` antes no path não gravam; sem cobertura de ramos.

## 4. Contrato de modes.sh (antigo → novo)
- Antigo: `cat .env` via Bash deveria ser `ask` em default/acceptEdits/plan; o pipeline do provedor fake era chamado "real".
- Prova na fonte: `guard.py` `check_read` NEGA (`deny`) a ferramenta **Read** de `.env`; Bash só pergunta onde `check_bash` decide, e em `plan` o guard defere (`none`) ao hook nativo (observado por JSON, sem ler `.env`). `rules/safety.md`: o Bash ainda pode ler (não há sandbox de SO); o plano legado adia essa guarda.
- Novo: `/guard-probe` aceita `Read:<caminho>`/`Write:<caminho>` (só o texto do caminho vai no JSON; nada é lido). Afirmado `deny` para Read `.env` em default, acceptEdits e plan; mantido `ask` para Bash `cat .env` em default/acceptEdits; Write: default `ask`, acceptEdits `none` (permitido), plan `none` (o bloqueio é do hook nativo, provado no modo `real` por `write` fora das ferramentas ativas). Nenhuma asserção afrouxada.
- Rótulo: a TUI de aceite não carrega os hooks do pi-code; o pipeline do provedor fake é **genérico** e não prova prompt/deny do guard (a gravação do arquivo em default não é prova). Prova do guard = `/guard-probe`; prova do plano = modo `real`. Não foi implementado carregar hooks reais com `CLAUDE_CONFIG_DIR` isolado: não verificado nesta rodada.
- Não executado aqui: `modes.sh real|fixture` (TUI), reservado ao runner final.

## 5. `check-instructions.py`: "detector de $N falhou: Expecting value"
Não é o loader do SDK: reproduzido idêntico com e sem `with-sdk.sh`. Causa: `arg-expansion-check.mjs` só imprime quando `import.meta.url === file://${process.argv[1]}`; o Python chama o caminho `~/.pi/agent/claude-home/bin/checks/arg-expansion-check.mjs` (symlink), o Node resolve `import.meta.url` pelo realpath e a saída fica vazia (`json.loads('')`). Chamado pelo caminho real imprime `[]`. Correção proposta (fora do meu escopo, não aplicada): comparar com `fs.realpathSync(process.argv[1])` (ou `pathToFileURL(realpath)`) no `.mjs`.

## 6. Fix round 2/2: cobertura Node por fonte real (2026-11-14)
O LCOV nativo não enxerga fontes importadas por cópia `/tmp` apagada (gate A: 11 sem medição). Solução, contrato e comandos exatos: `nodecoverage.md`. Arquivos novos: `claude-compat/coverage-map.mjs` e `coverage-map.test.mjs`; `sdk-hooks.mjs`/`sdk-register.mjs` ganharam o hook `load` e `PI_TEST_COVERAGE_MAP` (inativos sem a variável). Os 5 testes do hook seguem verdes; loader de resolução e cobertura Python stdlib preservados.
