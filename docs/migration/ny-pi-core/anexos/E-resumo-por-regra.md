<!-- Gerado por gerar-mapa.py a partir de ny-pi origin/main e4f8729 (1485 arquivos). Não editar à mão. -->
# Anexo E: resumo do mapa por regra

Total de arquivos rastreados no ny-pi: **1485**. Arquivos sem regra: **0**.
Lista completa, uma linha por arquivo: [E-mapa-arquivo-a-arquivo.tsv](E-mapa-arquivo-a-arquivo.tsv).

| Regra | Arquivos | Padrão de origem | Destino | Ação | Fase |
|---|---:|---|---|---|---|
| X01 | 4 | `^claude-home/bin/(evals/harbor/tests/test_pi_(?:harness\|vanilla_api)_agent\|evals/test_plan_ab\|structure/test_structure)\.py$` | `(o código testado fica em import/ny-pi até F12)` | remover | F3 |
| G01 | 1 | `^README\.md$` | `README.md` | fundir | F2 |
| G02 | 1 | `^CHANGELOG\.md$` | `docs/harness/CHANGELOG-ny-pi.md` | mover | F2 |
| G03 | 2 | `^(CODE_OF_CONDUCT\|SUPPORT)\.md$` | `$1.md` | mover | F2 |
| G04 | 2 | `^(CONTRIBUTING\|SECURITY)\.md$` | `$1.md` | fundir | F2 |
| G05 | 1 | `^NOTICE$` | `NOTICE` | fundir | F2 |
| G06 | 1 | `^LICENSE$` | `LICENSE (a do destino, mesma MIT)` | remover | F2 |
| G07 | 3 | `^\.(editorconfig\|gitattributes\|gitignore)$` | `.$1` | fundir | F2 |
| G08 | 3 | `^\.(gitleaks\.toml\|leak-allow\|pre-commit-config\.yaml)$` | `.$1` | mover | F2 |
| G09 | 1 | `^\.githooks/pre-commit$` | `.husky/pre-commit` | absorver | F2 |
| G10 | 3 | `^\.github/(CODEOWNERS\|PULL_REQUEST_TEMPLATE\.md\|release\.yml)$` | `.github/$1` | mover | F2 |
| G11 | 2 | `^\.github/DISCUSSION_TEMPLATE/(.+)$` | `.github/DISCUSSION_TEMPLATE/$1` | mover | F2 |
| G12 | 3 | `^\.github/ISSUE_TEMPLATE/(.+)$` | `.github/ISSUE_TEMPLATE/$1` | fundir | F2 |
| G13 | 1 | `^\.github/dependabot\.yml$` | `.github/dependabot.yml` | converter | F2 |
| C01 | 1 | `^\.github/zizmor\.yml$` | `.github/zizmor.yml` | mover | F3 |
| C02 | 1 | `^\.github/rulesets/main\.json$` | `.github/rulesets/main.json` | converter | F3 |
| C03 | 5 | `^\.github/workflows/(.+)$` | `.github/workflows/$1` | converter | F3 |
| C04 | 1 | `^scripts/ci/biome\.json$` | `biome.json do destino (D-06)` | remover | F3 |
| C05 | 19 | `^scripts/ci/(.+)$` | `scripts/ci/$1` | converter | F3 |
| C06 | 1 | `^scripts/check-leaks\.sh$` | `scripts/ci/check-leaks.sh` | mover | F3 |
| C07 | 3 | `^scripts/(check-refs\.py\|refs-allow\.txt\|test_check_refs\.py)$` | `scripts/ci/lint/$1` | converter | F3 |
| C08 | 1 | `^scripts/fixtures/leak/(.+)$` | `scripts/ci/fixtures/leak/$1` | mover | F3 |
| C09 | 1 | `^claude-home/bin/structure/(.+)$` | `scripts/ci/lint/structure/$1` | converter | F3 |
| C10 | 1 | `^docs/ci-local\.md$` | `docs/ci-local.md` | converter | F3 |
| B01 | 1 | `^bench/arms/omp$` | `(braço omp fora das medições, D-26)` | remover | F3 |
| B02 | 869 | `^bench/(.+)$` | `bench/$1` | converter | F3 |
| B03 | 31 | `^docs/bench/(.+)$` | `docs/bench/$1` | mover | F3 |
| B04 | 3 | `^claude-home/bin/evals/harbor/(omp-release\.sh\|omp_agent\.py\|tests/test_omp_agent\.py)$` | `(braço omp fora das medições, D-26)` | remover | F3 |
| B05 | 7 | `^claude-home/bin/evals/(.+)$` | `bench/evals/$1` | converter | F3 |
| K01 | 1 | `^bin/pi$` | `packages/coding-agent/src/cli/args.ts + src/core/settings-defaults.ts (K3, K4)` | absorver | F4 |
| K02 | 1 | `^bin/test_pi_env\.sh$` | `packages/coding-agent/test/harness/core/settings-env.test.ts` | converter | F4 |
| K03 | 2 | `^(settings\.json\|local\.env)\.example$` | `packages/coding-agent/src/core/settings-defaults.ts + docs/settings.md (K4)` | absorver | F4 |
| K04 | 3 | `^(mcp\|models\|lsp)\.json\.example$` | `packages/coding-agent/examples/config/$1.json` | mover | F4 |
| K05 | 1 | `^claude-home/patches/pi-core/cache-warm-identity\.mjs$` | `packages/coding-agent/src/core/sdk.ts (K1)` | absorver | F4 |
| K06 | 1 | `^claude-home/patches/pi-core/mcp-close-grace\.mjs$` | `packages/mcp/src/transports/stdio.ts (K2)` | absorver | F4 |
| K07 | 1 | `^claude-home/patches/pi-core/mcp-close-grace\.test\.ts$` | `packages/mcp/test/stdio-close-grace.test.ts` | converter | F4 |
| K08 | 1 | `^claude-home/bin/tests/cache-warm-identity\.test\.ts$` | `packages/coding-agent/test/harness/core/cache-warm-identity.test.ts` | converter | F4 |
| K09 | 1 | `^claude-home/bin/tests/config/models-example\.test\.ts$` | `packages/coding-agent/test/harness/core/models-example.test.ts` | converter | F4 |
| P01 | 13 | `^claude-home/patches/pi-code/orig/.+$` | `(original do pi-code; a referência é o tarball 1.7.0)` | remover | F5 |
| P02 | 1 | `^claude-home/patches/pi-code/(commands-print)\.patch$` | `packages/coding-agent/src/extensions/commands/` | absorver | F5 |
| P03 | 1 | `^claude-home/patches/pi-code/(notify-focus)\.patch$` | `packages/coding-agent/src/extensions/notify/` | absorver | F5 |
| P04 | 1 | `^claude-home/patches/pi-code/(rewind-tree)\.patch$` | `packages/coding-agent/src/extensions/git-checkpoint/` | absorver | F5 |
| P05 | 2 | `^claude-home/patches/pi-code/(statusline-multiline\|zzzzzzzz-statusline-provider)\.patch$` | `packages/coding-agent/src/extensions/status-line/` | absorver | F5 |
| P06 | 1 | `^claude-home/patches/pi-code/(todo-collapse)\.patch$` | `packages/coding-agent/src/extensions/todo/` | absorver | F5 |
| P07 | 4 | `^claude-home/patches/pi-code/(notify-focus\|rewind-tree\|statusline-multiline\|todo-collapse)\.test\.ts$` | `packages/coding-agent/test/harness/extensions/$1.test.ts` | converter | F5 |
| P08 | 1 | `^claude-home/patches/pi-code/zzzzzzzz-statusline-provider/(.+)$` | `packages/coding-agent/test/harness/extensions/status-line/$1` | converter | F5 |
| P09 | 1 | `^claude-home/patches/pi-code/goal\.patch$` | `packages/coding-agent/src/extensions/goal/` | absorver | F6 |
| P10 | 2 | `^claude-home/patches/pi-code/(goal\|goal-lifecycle)\.test\.ts$` | `packages/coding-agent/test/harness/extensions/goal/$1.test.ts` | converter | F6 |
| P11 | 3 | `^claude-home/patches/pi-code/(zz-hotkeys-no-alt\|zzzz-plan-done-rule\|zzzzz-plan-sota)\.patch$` | `packages/coding-agent/src/extensions/plan-mode/` | absorver | F6 |
| P12 | 2 | `^claude-home/patches/pi-code/(zzzz-plan-done-rule\|zzzzz-plan-sota)/(.+)$` | `packages/coding-agent/test/harness/extensions/plan-mode/$2` | converter | F6 |
| P13 | 9 | `^claude-home/patches/pi-code/[a-z-]*(subagent\|panel\|team)[a-z0-9-]*\.patch$` | `packages/coding-agent/src/extensions/subagent/` | absorver | F6 |
| P14 | 1 | `^claude-home/patches/pi-code/subagent-nesting\.test\.ts$` | `packages/coding-agent/test/harness/extensions/subagent/nesting.test.ts` | converter | F6 |
| P15 | 14 | `^claude-home/patches/pi-code/(subagent-panel\|subagent-render\|team\|zz-subagent-respawn\|zzzzzz-subagent-send\|zzzzzzz-subagent-model-effort)/(.+)$` | `packages/coding-agent/test/harness/extensions/subagent/$1/$2` | converter | F6 |
| P16 | 2 | `^scripts/check-patch-stack\.sh$` | `(sem pilha de patches)` | remover | F6 |
| E01 | 1 | `^extensions/(cache-prefix-probe)/.+$` | `(D-10)` | remover | F7 |
| E02 | 2 | `^extensions/(no-web-search\|no-context-files-covers-claude-md)\.ts$` | `(D-10)` | remover | F7 |
| E03 | 1 | `^claude-home/bin/tests/no-context-files\.test\.ts$` | `packages/coding-agent/test/harness/extensions/claude-rules/context-files.test.ts` | converter | F7 |
| E04 | 3 | `^claude-home/bin/telemetry/(cache_probe_join\.py\|test_cache_probe_join\.py\|cache-remeasure\.sh)$` | `(acompanha cache-prefix-probe, D-10)` | remover | F7 |
| E05 | 1 | `^extensions/bash-timeout/index\.ts$` | `packages/coding-agent/src/core/tools/bash.ts (K8)` | absorver | F7 |
| E06 | 1 | `^extensions/bash-timeout/index\.test\.ts$` | `packages/coding-agent/test/harness/core/bash-timeout.test.ts` | converter | F7 |
| E07 | 1 | `^extensions/compact-at-400k\.ts$` | `packages/coding-agent/src/core/compaction/ (K9)` | absorver | F7 |
| E08 | 1 | `^claude-home/bin/tests/compact-at-400k\.test\.ts$` | `packages/coding-agent/test/harness/core/compact-threshold.test.ts` | converter | F7 |
| E09 | 1 | `^scripts/compaction-400k\.py$` | `(K9)` | remover | F7 |
| E10 | 1 | `^extensions/pi-docs/index\.ts$` | `packages/coding-agent/src/core/system-prompt.ts (K7)` | absorver | F7 |
| E11 | 1 | `^extensions/pi-docs/index\.test\.ts$` | `packages/coding-agent/test/harness/core/docs-pointer.test.ts` | converter | F7 |
| E12 | 1 | `^extensions/bypass-permissions/index\.ts$` | `packages/coding-agent/src/core/permissions/ (K11)` | absorver | F8 |
| E13 | 1 | `^extensions/todo-sync/index\.ts$` | `packages/coding-agent/src/extensions/todo/stale-reminder.ts` | fundir | F7 |
| E14 | 1 | `^extensions/todo-sync/index\.test\.ts$` | `packages/coding-agent/test/harness/extensions/todo/stale-reminder.test.ts` | converter | F7 |
| E15 | 1 | `^extensions/completion-gate\.ts$` | `packages/coding-agent/src/extensions/completion-gate/index.ts` | mover | F7 |
| E16 | 1 | `^claude-home/bin/tests/gates/completion-gate\.test\.ts$` | `packages/coding-agent/test/harness/extensions/completion-gate/index.test.ts` | converter | F7 |
| E17 | 1 | `^extensions/plan-gate\.ts$` | `packages/coding-agent/src/extensions/plan-gate/index.ts` | mover | F7 |
| E18 | 1 | `^claude-home/bin/tests/plan-gate\.test\.ts$` | `packages/coding-agent/test/harness/extensions/plan-gate/index.test.ts` | converter | F7 |
| E19 | 1 | `^extensions/footer-no-stats\.ts$` | `packages/coding-agent/src/extensions/footer/index.ts` | mover | F7 |
| E20 | 1 | `^extensions/puxar\.ts$` | `packages/coding-agent/src/extensions/import-claude-session/index.ts` | mover | F7 |
| E21 | 2 | `^claude-home/bin/puxar/(.+)$` | `scripts/harness/puxar/$1` | mover | F7 |
| E22 | 2 | `^claude-home/bin/tests/(prefix-cache-1h\|sound-notify)\.test\.ts$` | `packages/coding-agent/test/harness/extensions/$1/index.test.ts` | converter | F7 |
| E23 | 2 | `^extensions/syntax-check/package(-lock)?\.json$` | `packages/coding-agent/package.json (dependência exata)` | absorver | F7 |
| E24 | 13 | `^extensions/([a-z0-9-]+)/test/(.+\.test\.ts)$` | `packages/coding-agent/test/harness/extensions/$1/$2` | converter | F7 |
| E25 | 6 | `^extensions/([a-z0-9-]+)/(.+\.test\.ts)$` | `packages/coding-agent/test/harness/extensions/$1/$2` | converter | F7 |
| E26 | 24 | `^extensions/([a-z0-9-]+)/(.+\.ts)$` | `packages/coding-agent/src/extensions/$1/$2` | mover | F7 |
| E27 | 2 | `^themes/(.+)$` | `packages/coding-agent/resources/themes/$1` | mover | F7 |
| E28 | 3 | `^claude-home/bin/tests/(pi-ui-final-gate\.sh\|terminal-sota/.+)$` | `scripts/harness/ui-gates/$1` | converter | F7 |
| R01 | 1 | `^claude-home/CLAUDE\.md$` | `packages/coding-agent/resources/instructions/contract.md` | converter | F8 |
| R02 | 1 | `^claude-home/CLAUDE\.headless\.md$` | `packages/coding-agent/resources/instructions/headless.md` | converter | F8 |
| R03 | 1 | `^claude-home/lite/APPEND\.md$` | `packages/coding-agent/resources/instructions/lite.md` | converter | F8 |
| R04 | 1 | `^claude-home/lite/settings\.json$` | `packages/coding-agent/resources/instructions/lite.settings.json` | converter | F8 |
| R05 | 1 | `^claude-home/settings\.json\.example$` | `packages/coding-agent/src/core/settings-defaults.ts (hooks, statusLine, env)` | absorver | F8 |
| R06 | 1 | `^claude-home/rules/(.+)$` | `packages/coding-agent/resources/rules/$1` | converter | F8 |
| R07 | 4 | `^claude-home/rules-ref/(.+)$` | `packages/coding-agent/resources/rules/ref/$1` | converter | F8 |
| R08 | 261 | `^claude-home/(agents\|commands\|skills)/(.+)$` | `packages/coding-agent/resources/$1/$2` | converter | F8 |
| R09 | 9 | `^claude-home/hooks/fixtures/pi-code-1\.7\.0/(.+)$` | `packages/coding-agent/test/harness/hooks/fixtures/$1` | mover | F8 |
| R10 | 6 | `^claude-home/hooks/((?:.+/)?test_[^/]+\.py)$` | `packages/coding-agent/test/harness/hooks/$1` | converter | F8 |
| R11 | 6 | `^claude-home/hooks/(.+)$` | `packages/coding-agent/resources/hooks/$1` | converter | F8 |
| R12 | 1 | `^claude-home/plugins/claude-hud/statusline\.mjs$` | `packages/coding-agent/resources/statusline/statusline.mjs` | converter | F8 |
| R13 | 4 | `^claude-home/bin/hud/tests/(.+)$` | `packages/coding-agent/test/harness/statusline/$1` | converter | F8 |
| R14 | 4 | `^claude-home/bin/hud/(.+)$` | `packages/coding-agent/resources/statusline/$1` | converter | F8 |
| R15 | 18 | `^claude-home/bin/(.+)$` | `scripts/harness/$1` | converter | F8 |
| T01 | 1 | `^patches/third-party/pi-lsp\.patch$` | `packages/coding-agent/src/extensions/lsp/` | absorver | F9 |
| T02 | 2 | `^patches/third-party/(ponytail\|ralph-loop)\.patch$` | `fork próprio de $1 (D-11)` | converter | F9 |
| T03 | 1 | `^third-party\.json$` | `NOTICE + pacotes opcionais (D-11)` | remover | F9 |
| D01 | 7 | `^docs/specs/(.+)$` | `docs/specs/$1` | converter | F2 |
| D02 | 29 | `^claude-home/docs/(.+)$` | `docs/harness/$1` | converter | F8 |
| I01 | 4 | `^(install\.sh\|publish\.list\|scripts/install-lib\.sh\|scripts/test_install\.sh)$` | `instalador e campo files do pacote` | remover | F11 |
| I02 | 2 | `^npm/.+$` | `(pi-code é fonte do repositório)` | remover | F11 |

## Totais por fase e ação

| Fase | mover | converter | fundir | absorver | remover | Total |
|---|---:|---:|---:|---:|---:|---:|
| F2 | 11 | 8 | 10 | 1 | 1 | 31 |
| F3 | 34 | 906 | 0 | 0 | 9 | 949 |
| F4 | 3 | 4 | 0 | 5 | 0 | 12 |
| F5 | 0 | 5 | 0 | 6 | 13 | 24 |
| F6 | 0 | 19 | 0 | 13 | 2 | 34 |
| F7 | 33 | 31 | 1 | 4 | 7 | 76 |
| F8 | 9 | 338 | 0 | 2 | 0 | 349 |
| F9 | 0 | 2 | 0 | 1 | 1 | 4 |
| F11 | 0 | 0 | 0 | 0 | 6 | 6 |
| **Total** | 90 | 1313 | 11 | 32 | 39 | **1485** |
