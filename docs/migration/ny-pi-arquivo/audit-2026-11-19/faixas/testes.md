# Faixa testes (relatório bruto do subagente, 2026-11-19)

**Veredito: insufficient.** É um mapa estático, sem suíte nem cobertura executadas. Não existe relatório de cobertura em disco: não há `coverage/`, `.coverage` nem `lcov`. O único `coverage.json` (`docs/ui-ux-gallery/`, 14/nov) é um mapa de telas de UI, não de código. `.project-phase` não existe, então a fase é `launched`.

## 1. Como os testes rodam hoje

**CI** (`.github/workflows/`): `ci-static`, `ci-security` e `instruction-budget`, mais um job `ci-mutation` (informativo) dentro de `ci-static.yml`. Tudo passa por `scripts/ci/run-static.sh`.

| Linguagem | Comando no CI | Medição e limiar |
|---|---|---|
| Python | `coverage run -m pytest scripts/ claude-home/hooks claude-home/bin bench` | `source=.`, então arquivos não importados contam 0%. Limiar de 80% só via `diff-cover --fail-under 80`, sobre as linhas alteradas pelo PR. Não há piso por arquivo nem agregado. |
| TypeScript/MJS | `node --test` em `extensions/**/*.test.ts` e `claude-home/bin/**/*.test.{ts,mjs}` | **Nenhuma medição de cobertura.** |
| Shell | só `scripts/test_install.sh` (casos offline) | Sem cobertura. |
| Estático | ruff, mypy `--strict`, biome, shellcheck, shfmt, markdownlint e limites de estrutura, só nos arquivos alterados | O código legado nunca bloqueia. |
| Segurança | actionlint, zizmor, gitleaks, trufflehog, semgrep, osv-scanner, pins de SHA | n/a |
| Mutação | mutmut só em `.py` alterados | Não há `scripts/ci/mutmut-baseline.json`, então é só informativo. |

Excluídos de propósito do job de testes Node: `cache-warm-identity`, os testes do HUD de statusline, o de pi-transcript e o e2e do antigravity.

**O que o CI NÃO executa nem mede:**
- **48 testes Node em `claude-home/patches/pi-code/**` e 7 em `claude-home/patches/pi-core/**`.** Neles estão `wrapper.test.mjs`, que testa `pi_permission_env` do `bin/pi`, e os de `permission-control`, `plan-state` e `subagent-routing`.
- **13 arquivos pytest em `claude-home/skills/*/scripts/tests`:**
  - Os 6 testes do `atualizador`/git-deliver (`test_core`, `test_merge`, `test_ship`, `test_publish_ci`, `test_sync_cleanup`, `test_integrate_gate`).
  - `test_compaction_restart`.
  - Os de `deep-search`.
  - `test_doces`.
  - `test_unit_graph`.
  - `test_pipeline`.
- **Os scripts de shell de teste:** `bin/test_pi_env.sh`, `supervisor.test.sh`, `test_supervisor.sh`, `bench/tools/test_tools.sh`, `acceptance/*.sh` do claude-compat, `terminal-sota/*.sh` e `bin/ny-pi-mock-src/e2e.test.mjs`.
- **TypeScript sem cobertura:** os ~270 arquivos de TypeScript não têm limiar. O contrato de 80% por arquivo é **not_verified** para eles.
- **O trecho de rede de `scripts/test_install.sh`** só roda com `PI_HARNESS_E2E_NET=1`.
- **Red-then-green de bug fix:** nenhum gate verifica.

## 2. Arquivos sem teste correspondente ou com teste raso (por risco)

A coluna "teste existente?" vem de busca por nome de arquivo nos testes e de leitura dos casos. Não é cobertura medida.

| arquivo | linhas | teste existente? | o que falta testar |
|---|---|---|---|
| `bin/pi` (partes além de `pi_permission_env` e `pi_load_local_env`) | 388 | Parcial. `test_pi_env.sh` cobre só o loader do `local.env` e **não roda no CI**. `pi_permission_env` está em `patches/pi-core/editor-actions/wrapper.test.mjs`, **fora do CI**. | Os `*_ready` de ui-controls, session-cwd, avisos, retomada e scrollbar: marcador presente com runtime divergente deve chamar `apply.mjs`; patch que falha avisa e segue. Versão do pi diferente de 1.5.2 não aplica patch. `--safe` e `--bypass` na linha de comando. `PI_PERMISSION_MODE` inválido deve retornar erro. `--exclude-tools web_search` sempre presente. Fallback sem supervisor. |
| `claude-home/hooks/claims/claims.py` | 254 | **Nenhum.** O docstring cita `tests/test_claims.py`, que não existe, e `cade_o_print.py` e `replay.py` também faltam. | Detecção de "testes passam" com e sem evidência no ledger. Ledger vazio ou corrompido. Teste que falhou (`ok=false`) não vale. Edição depois do teste invalida. Truncamento por `TAIL`. Paridade `record()` × ledger em bash. |
| `extensions/compact-at-400k.ts` | 138 | **Nenhum.** Exporta `parseTokens` e `condensePrevious`, ambos puros e fáceis de testar. | `parseTokens`: `"400k"`, `"1,5m"`, `"0"`, `"-1"`, `"1e3"`, vazio, `"9999999999999999999"`. `condensePrevious`: resumo de exatamente `max` caracteres (borda). `/contexto` abaixo do mínimo ou ≥ janela deve avisar e não gravar. `agent_settled` com `aborted` ou com `running` não pode recompactar. `onError` deve zerar `running` (sem deadlock). `session_start` restaura o limite do ramo. |
| `scripts/install-lib.sh` + `install.sh` | 210 + ~150 | Parcial. `test_install.sh` (75 linhas) cobre commit adulterado, pin errado, `--link`, `--apply` e `--restore`. | `fetch_git`/`fetch_npm`: integridade npm divergente, sha256 da licença divergente. `safe_rel` com `..` ou caminho absoluto no manifesto. Patch que não aplica deve falhar fechado e não escrever nada. `--restore` com backup ausente ou parcial. Segunda execução de `--apply` idempotente. `install_pi_core` e `write_launcher`. |
| `claude-home/skills/atualizador/scripts/*.py` (git-deliver) | 158+214+143+399+155+276+424 | Existe (≈2.800 linhas de teste), mas **fora do CI**. `gd_gate.py` (143) não é referenciado pelo nome em nenhum teste. | Rodar essas suítes no CI. Em `gd_gate`: gate que falha ou dá timeout, head diferente do SHA do proof. Merge com CI vermelho e com SHA desatualizado deve recusar. `--admin` nunca. Falha de rede do `gh`. |
| `extensions/plan-gate.ts` | 241 | Sim (`claude-home/bin/tests/plan-gate.test.ts`, 30+ casos), mas só com `decidePlanGate` e o handler mockado. O teste de paridade com `done-view.ts` **pula se o pi-code não estiver instalado**. | Sessão retomada com estado do gate em um ramo diferente. Duas revisões `complete`, uma depois de uma edição. Garantir no CI que a paridade não pula em silêncio. |
| `extensions/completion-gate.ts` | 130 | Sim (13 casos, `bin/tests/gates/completion-gate.test.ts`). | Falta: edição só de arquivo de teste. `isCheckCommand` com substituição de comando e com `time`/`env` à frente. Edições em ramos paralelos. Bloqueio com mais de 1 turno sem resposta. |
| `claude-home/hooks/guard.py` + `permissions/*` | 520 + 475 | Boa (`test_guard.py` 370, `test_guard_modes` 202, `test_hardening` 160, `test_units` 157). Lacunas por busca de padrões: **`eval`, `base64`, `NotebookEdit`, fork bomb estruturado**. | `eval "$(echo ... \| base64 -d)"` não pode virar allow. `NotebookEdit` em arquivo sensível. `rm -rf` obtido por `$(...)` ou variável. `curl \| sh` com wrapper. Comando muito longo ou com NUL. |
| `extensions/auto-resume/index.ts` | 344 | Sim (19 casos, clock e sleep injetados). | `limitReset` com header em segundos × milissegundos × data HTTP. Aborto durante a espera de 600 s. Reentrada: dois erros simultâneos. |
| `extensions/travar-modelos/*` | 336 | Sim (5 + 17 casos), com falha fechada. | Aceitável. Falta só concorrência entre `model_select` e `/travar`. |
| `claude-home/hooks/dispatch/hook-dispatch.sh` | 226 | Sim (`test_dispatch.py`). | `PI_DIAG_INBOX` não gravável. Payload JSON gigante. |
| `scripts/compaction-400k.py` | 37 | **Nenhum.** Reescreve `~/.pi/agent/settings.json` e roda no import. | Em HOME temporário: janela = limite + 16384 (borda), `models-store.json` ausente ou malformado, `settings.json` sem a chave `compaction`, execução duas vezes igual. |
| `extensions/puxar.ts` | 88 | Nenhum para o `.ts`. `test_puxar.py` cobre só o `puxar.py`. | Argumentos inválidos. Falha do subprocesso. |
| `extensions/cache-prefix-probe/index.ts` | 58 | Nenhum. | Prefixo estável × variável; probe desligado. |
| `extensions/no-web-search.ts` | 18 | Nenhum. | `web_search` deve continuar fora das ferramentas ativas. |
| `extensions/footer-no-stats.ts` | 44 | Só indireto, em `patches/pi-code/statusline-multiline.test.ts` (fora do CI). | Render do rodapé sem estatísticas. |
| `scripts/check-leaks.sh` | 220 | Só `--selftest` dentro do `ci-security`. | Padrão de identificador pessoal e falso positivo. |
| `claude-home/bin/lifecycle/supervisor.sh` | 114 | Existe, mas é shell e **fora do CI** (`supervisor.test.sh`, `test_supervisor.sh`). | Rodar no CI. `/restart` com filho morto por sinal. Sem TTY, caminho `exec`. |
| `extensions/claude-compat/vim/motions.ts` | 267 | Indireto (`engine.test.ts`). | Aceitável. |
| `claude-home/bin/port-agents.py`, `fonte-icones.py`, `cache-misses.sh`, `mcp-header.sh`, `bench/tools/bench-nightly.sh`, `bench/arms/oauth-token.sh`, `scripts/ci/{changed-files,install-tools}.sh`, `extensions/code-blocks/gen-languages.py` | 117, 45, 35, 10, 43, 13, 12, 52, 64 | Nenhum por busca de nome. | Baixo risco. `oauth-token.sh` e `mcp-header.sh` lidam com credenciais: testar que nunca imprimem o token. |

## 3. Testes frágeis

**Pulados (nenhum `.only` nem `.todo`; só condicionais):**
- `claude-home/bin/tests/plan-gate.test.ts:228` e `extensions/claude-compat/lifecycle/test/terminal-setup.test.ts:226` pulam sem o pi instalado. É o caso mais arriscado: um skip silencioso esconde a paridade do plan-gate.
- `claude-home/patches/pi-code/permission-control/apply.test.ts:131` pula sem o pi-code.
- `claude-home/patches/pi-core/scrollbar-imagem/apply.test.mjs:41` pula quando falta `layout.js`.
- `claude-home/patches/pi-code/subagent-panel/fleet-faults.test.ts:20` pula se rodar como root.
- `claude-home/bin/structure/test_structure.py:197` pula se rodar como root.
- `extensions/ui-visual/test/theme-contrast.test.ts:52` pula o tema `mono` fixo, sem teste alternativo.
- `claude-home/skills/atualizador/scripts/tests/test_core.py:640` pula sem gitleaks.
- `claude-home/skills/doces-ou-travessuras/scripts/tests/test_doces.py:350` pula quando falta o `hook-dispatch.sh` instalado.
- As linhas `test_doces.py:169`, `:170`, `:212` e `:256` são dados de fixture (strings), não skips reais.

**Sleeps e tempo real:**
- `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync/fleet-sync.test.ts:53` espera 1100 ms. `reload.test.ts:107` espera 50 ms e `:122` espera 400 ms.
- `extensions/ui-visual/test/tools/estado.test.ts:90` espera 300 ms para uma animação.
- `claude-home/patches/pi-code/zzzzzzzzzzz-subagent-routing/integration.test.ts:206` espera 300 ms.
- `claude-home/patches/pi-code/zzzzzzzzzzzzzzz-run-section/run-section.test.ts:153,166,234` esperam 150, 200 e 300 ms.
- `claude-home/patches/pi-code/subagent-panel/fleet-entry.test.ts:217` espera 500 ms.
- `extensions/ui/test/terminal.test.ts:127` espera 150 ms.
- `claude-home/bin/tests/lifecycle/supervisor.test.sh` e `bench/tools/test_tools.sh:110-111` usam `sleep 2` e `sleep 0.5` para orquestrar `flock`.
- Outros usos de `setTimeout(…, 5–50 ms)` aparecem em `extensions/auto-resume/index.test.ts:302`, `extensions/comandos/test/index.test.ts:76,80`, `fleet-spawn.test.ts:38` e `send.test.ts:424`.
- `extensions/auto-resume/index.test.ts:308` tem um `Promise.race` com timer de 1500 ms. Funciona, mas é frágil em máquina carregada.
- O contador `now` de auto-resume é injetado, o que é bom.

**Dependência de HOME e do ambiente real:**
- `claude-home/hooks/test_guard.py:11`, `permissions/tests/test_guard_modes.py:15` e `claude-home/bin/tests/plan-gate.test.ts:226` usam `expanduser("~")` ou `homedir()`.
  - O guard compara caminhos com o HOME real da máquina.
  - O plan-gate lê o pi-code instalado.
  - Resultado diferente entre máquina e CI.
- Em `patches/pi-code/**` e `patches/pi-core/**`, vários testes usam `homedir()` (`permission-control`, `session-cwd`, `ui-controls`, `rules-notice`, `onda5`).
- Em `extensions/**/test/`, o mesmo vale para `ui`, `ui-visual`, `folha`, `diagnostico` (`carregar.ts`), `avisos` e `dev-commands`. Falta verificar se cada um troca HOME.
- `bin/test_pi_env.sh` usa o caminho fixo `/tmp/pwned` e faz `rm -f /tmp/pwned` antes. Colide com outros processos e apaga um arquivo que pode ser de outro. O `mktemp -d` já existente resolveria.
- `claude-home/bin/tests/pi-ui-final-gate.sh` e `terminal-sota/*.sh` dependem do ambiente.

**Asserções fracas (só "não lança"):**
- `extensions/diagnostico/test/index.test.ts:188`, `registro.test.ts:69`, `obs/trilha.test.ts:87-88` e `obs/detector.test.ts:148`.
- `patches/pi-code/subagent-panel/fleet-faults.test.ts:169,187,202,213,223,232`.
- `patches/pi-code/todo-collapse.test.ts:71,225`, `rewind-tree.test.ts:292,525` e `run-section.test.ts:98`.
- `claude-home/bin/tests/interactive-display/plan-section.test.ts:630-635`.
- Em geral são testes de "tolera falha". Convém conferir se há asserção de estado depois do `doesNotThrow`.

**Rede:** nenhum teste faz rede por padrão. `PI_HARNESS_E2E_NET=1` está isolado em `test_install.sh`.

**Fuso horário:** não encontrei testes dependentes de fuso. O de `plan-gate` usa o construtor local `new Date(2026, 10, 14, …)`.

## 4. Estrutura

`structure.py --project-root . --json` terminou em 0,1 s: **802 arquivos de código, 0 findings.** Conferi à mão sobre os 767 arquivos de código rastreados, com extensão ts/mjs/js/py/sh: **nenhum arquivo >800 linhas e nenhum diretório >7 arquivos de código diretos**.

O maior arquivo é `extensions/ui-visual/tools.ts` (727 linhas), seguido de `extensions/diagnostico/index.ts` (711) e `bench/run.py` (679). `bin/pi` e outros scripts sem extensão não entram na contagem do verificador (`bin/pi` tem 388 linhas, longe do limite).

## 5. Plano priorizado (15 itens)

1. **Mudar o CI para rodar os testes hoje ignorados.** Incluir `claude-home/skills/*/scripts/tests`, `claude-home/patches/**/*.test.*`, `bin/test_pi_env.sh` e os `.sh` de lifecycle. É o maior ganho: ~70 arquivos de teste passam a valer. Caso exato: `pytest claude-home/skills` e `node --test` com o glob de `patches/`.
2. **Teste de que o plan-gate não pula no CI.** Falhar se `done-view.ts` não existir quando `CI=true` (`plan-gate.test.ts:228`).
3. **Cobertura de TypeScript.** Rodar `node --test --experimental-test-coverage` ou c8 com limiar de 80% por arquivo. Hoje o contrato não é verificável para TS.
4. **Piso por arquivo no pytest.** Trocar o `diff-cover` isolado por um `coverage report` por arquivo com `--fail-under=80`, ou um script que leia o XML.
5. **`claims.py`.** Criar `hooks/claims/test_claims.py`. Caso: sequência edit→test(ok=false)→claim "testes passam" deve dar veredito sem evidência; edit→test(ok=true)→claim passa; edit depois do test invalida.
6. **`compact-at-400k`.** Testar `parseTokens` (`"400k"` = 400000, `"0"`, `"-5"`, `"abc"`, `"1,5m"` = 1500000) e `condensePrevious` com `previousSummary.length` = `max` e = `max+1`. Handler `agent_settled` com `onError` deve zerar `running`.
7. **`pi_permission_env` no CI.** O teste já existe em `wrapper.test.mjs`; basta o item 1. Caso mínimo: `PI_BYPASS_PERMISSIONS=1` sem `PI_BYPASS_ELIGIBLE` nem `PI_BYPASS_OPTIN` fora do estado "querido" resulta em 0 (fail closed).
8. **`guard.py` com ofuscação.** Um caso para cada: `eval "$(echo cm0gLXJmIC8= | base64 -d)"`, `bash <(curl x)`, `x=rm; $x -r /`. Esperado: nunca `allow`.
9. **`scripts/install-lib.sh`.** Caso: `third-party.json` com `dest` `../x` deve abortar sem escrever; npm com integrity errada deve abortar; sha256 da licença divergente deve abortar.
10. **`compaction-400k.py`.** Em HOME temporário: modelo com janela = `LIMIT + 16384` não entra nos overrides; `LIMIT + 16385` entra com `reserveTokens = 16385 + ...`. `models-store.json` ausente deve falhar com mensagem, sem tocar `settings.json`.
11. **`gd_gate.py`.** Gate com exit ≠ 0 deve impedir o merge; proof de SHA diferente do head atual deve recusar.
12. **Tirar a fragilidade de `test_pi_env.sh`.** Trocar `/tmp/pwned` por um caminho dentro do `mktemp -d`, sem `rm -f` prévio.
13. **Fixar HOME em `test_guard.py` e `test_guard_modes.py`.** Definir `HOME` temporário via `env` na chamada do hook, para o resultado não depender da máquina.
14. **Trocar sleeps por sinal controlado** em `fleet-sync.test.ts:53` (1100 ms) e em `estado.test.ts:90` (300 ms): relógio injetado ou espera por evento.
15. **`no-web-search.ts`, `cache-prefix-probe`, `puxar.ts`, `footer-no-stats.ts`.** Um teste de contrato cada (o handler registra o que deve; entrada inválida não lança). Baixo risco.

## Limitações

- Nada foi executado: não há contagens de passed/failed/skipped/xfail/flaky, e flakiness só foi inferida pelos padrões de sleep.
- "Sem teste" vem de busca por nome de arquivo e de casos nos testes (rg). Importações indiretas podem esconder cobertura real, e algumas suítes listadas como "existem" não tiveram os casos lidos linha a linha.
- Não há índice codegraph neste repositório, então a cobertura estática é degradada (rg e `fdfind` apenas).
- A árvore tem trabalho alheio não commitado; a leitura é do estado atual do disco. Não alterei nenhum arquivo.
