# Mapa de migração

O destino de cada coisa. Este documento é a prova de "sem faltar nada": o que não aparece aqui não migra, e o que
migra tem linha.

## 1. Cinco fontes de coisas a migrar

O ny-pi não está todo no seu repositório. Parte do que roda hoje vem de fora e só existe na máquina depois da
instalação. O mapa cobre as cinco fontes:

| # | Fonte | Quantidade | Onde está o mapa |
|---|---|---|---|
| 1 | Arquivos rastreados em `marcioazam/ny-pi@e4f8729` | 1485 arquivos | Seção 2 e [anexo E](anexos/E-resumo-por-regra.md) (regras) e [TSV](anexos/E-mapa-arquivo-a-arquivo.tsv) (um por linha) |
| 2 | pi-code 1.7.0 instalado e remendado | 159 arquivos em `extensions/` (112 do tarball, o resto criado pelos patches) | Seção 3 |
| 3 | Terceiros de `third-party.json` | 5 componentes | Seção 4 |
| 4 | Configuração do GitHub (não é arquivo) | 60 regras (R01 a R60) | [04-regras-do-repositorio.md](04-regras-do-repositorio.md) |
| 5 | Dados na máquina do usuário (`~/.pi/agent`) | configuração, sessões, credenciais | Seção 5 |

## 2. Arquivos do repositório ny-pi

Cada um dos 1485 arquivos casa com exatamente uma regra de [anexos/gerar-mapa.py](anexos/gerar-mapa.py). O script
falha se um arquivo ficar sem regra; a execução de 2026-11-20 terminou com 0 sem regra e todas as 104 regras usadas.
Para regerar depois de um novo commit no ny-pi:

```bash
git -C ~/source/ny-pi ls-tree -r --name-only origin/main \
  | python3 docs/migration/ny-pi-core/anexos/gerar-mapa.py \
  > docs/migration/ny-pi-core/anexos/E-mapa-arquivo-a-arquivo.tsv
```

### 2.1 Ações

| Ação | Significado | Arquivos |
|---|---|---:|
| mover | `git mv` sem mudar o conteúdo | 89 |
| converter | `git mv` e ajuste mecânico: caminhos, imports `@earendil-works/pi-*` para `@nycode/*`, nomes `PI_*`, formatação | 1318 |
| fundir | O destino já existe no fork; o conteúdo é combinado | 11 |
| absorver | O arquivo some e seu comportamento passa a morar em código do core ou de uma extensão | 33 |
| remover | Não migra; o motivo está na regra | 34 |
| **Total** | | **1485** |

Dos 1318 "converter", 869 são `bench/` (784 deles são tarefas de teste em `bench/suites/`, que só mudam de lugar) e
261 são agentes, comandos e skills.

### 2.2 Totais por fase

| Fase | Arquivos | O que são |
|---|---:|---|
| F2 | 31 | Governança, comunidade, especificações |
| F3 | 949 | `bench/` (869), `docs/bench` (31), `scripts/ci`, workflows, lints |
| F4 | 12 | Wrapper, exemplos de configuração, patches de core e seus testes |
| F5 | 24 | Patches e testes das extensões base do pi-code; `orig/` (13, removidos) |
| F6 | 34 | Patches e testes de `subagent`, `plan-mode`, `goal` |
| F7 | 76 | Extensões próprias, temas, testes |
| F8 | 349 | Agentes (17), comandos (17), skills (227), regras, hooks, linha de status, ferramentas, `claude-home/docs` |
| F9 | 4 | Patches de terceiros, `third-party.json` |
| F11 | 6 | Instalador, `publish.list`, `npm/` |

### 2.3 O que é removido e por quê (34 arquivos)

| Arquivos | Motivo | Decisão |
|---|---|---|
| `LICENSE` | Mesma licença MIT do destino; o `NOTICE` ganha a atribuição | — |
| `scripts/ci/biome.json` | A formatação TypeScript é a do fork | D-06 |
| `bench/arms/omp`, `claude-home/bin/evals/harbor/omp-release.sh`, `omp_agent.py`, `tests/test_omp_agent.py` | Braço `omp` fora das medições | D-26 |
| `claude-home/patches/pi-code/orig/*` (13) | Cópias do original; a referência passa a ser o tarball com sha1 conferido | D-02 |
| `scripts/check-patch-stack.sh` | Não há mais pilha de patches | — |
| `extensions/cache-prefix-probe/index.ts`, `claude-home/bin/telemetry/cache_probe_join.py`, seu teste, `cache-remeasure.sh` | Diagnóstico marcado como temporário | D-10 |
| `extensions/no-web-search.ts`, `extensions/no-context-files-covers-claude-md.ts`, `scripts/compaction-400k.py` | Contornos de um acoplamento que acaba | D-10 |
| `third-party.json` | Terceiros embutidos ou pacotes opcionais | D-11 |
| `install.sh`, `publish.list`, `scripts/install-lib.sh`, `scripts/test_install.sh`, `npm/package.json`, `npm/package-lock.json` | Instalação e publicação do fork | — |

Todo arquivo removido cujo comportamento precisa continuar tem um teste no destino que o cobre. Exemplo: o teste de
`no-context-files` vira `test/harness/extensions/claude-rules/context-files.test.ts` (regra E03), que prova que
`CLAUDE.md` do projeto não entra no contexto, agora sem a extensão de contorno.

### 2.4 O que é absorvido (33 arquivos) e onde o comportamento passa a morar

| Origem | Destino do comportamento | Costura | Teste que prova |
|---|---|---|---|
| `bin/pi` | `cli/args.ts`, `settings-defaults.ts` | K3, K4 | `test/harness/core/settings-env.test.ts` (ex-`bin/test_pi_env.sh`) |
| `settings.json.example`, `local.env.example`, `claude-home/settings.json.example` | `settings-defaults.ts`, `docs/settings.md` | K4 | Teste de esquema do pacote |
| `patches/pi-core/cache-warm-identity.mjs` | `core/sdk.ts:370` | K1 | `test/harness/core/cache-warm-identity.test.ts` |
| `patches/pi-core/mcp-close-grace.mjs` | `packages/mcp/src/transports/stdio.ts:10` | K2 | `packages/mcp/test/stdio-close-grace.test.ts` |
| 19 `*.patch` de pi-code | `src/extensions/<nome>/` (seção 3) | K5 | Os testes de cada patch (regras P07, P08, P10, P12, P14, P15) |
| `extensions/bash-timeout/index.ts` | `core/tools/bash.ts` | K8 | `test/harness/core/bash-timeout.test.ts` |
| `extensions/compact-at-400k.ts` | `core/compaction/` | K9 | `test/harness/core/compact-threshold.test.ts` |
| `extensions/pi-docs/index.ts` | `core/system-prompt.ts` | K7 | `test/harness/core/docs-pointer.test.ts` |
| `extensions/bypass-permissions/index.ts` | `core/permissions/` | K11 | Teste do comando `/bypass` e do estado (novo, F8) |
| `extensions/syntax-check/package.json` e lock | `packages/coding-agent/package.json` | — | `check:pinned-deps` do fork |
| `.githooks/pre-commit` | `.husky/pre-commit` | — | Commit de teste com segredo falso é barrado |
| `patches/third-party/pi-lsp.patch` | `src/extensions/lsp/` | K5 | Testes do pi-lsp que o patch altera |

## 3. pi-code 1.7.0 remendado

O que roda hoje é o tarball `pi-code@1.7.0` mais 19 patches e um `sed`. Essa árvore tem 159 arquivos em
`extensions/` e é a fonte de F5 e F6. Nenhum desses arquivos está no repositório ny-pi; o repositório só tem os
patches.

### 3.1 Como obter a árvore de referência

```bash
npm pack pi-code@1.7.0 --pack-destination /tmp/pi-code-ref
echo "8ba1f814773da6897f6708c62c7c517cee2baf4e  /tmp/pi-code-ref/pi-code-1.7.0.tgz" | sha1sum -c
tar -xzf /tmp/pi-code-ref/pi-code-1.7.0.tgz -C /tmp/pi-code-ref        # cria package/
cd /tmp/pi-code-ref/package/extensions
for p in "$NYCODE"/import/ny-pi/claude-home/patches/pi-code/*.patch; do patch -p1 -N < "$p"; done
sed -i 's|^\(\s*\)if (!trusted) return TRUST_GATE|\1// if (!trusted) return TRUST_GATE|' goal.ts
diff -r /tmp/pi-code-ref/package/extensions ~/.pi/agent/npm/node_modules/pi-code/extensions && echo IGUAL
```

O `sed` reproduz o passo 9 do boot do wrapper ([anexo A](anexos/A-inventario-ny-pi.md), seção 1); a expressão exata
deve ser copiada de `bin/pi` na hora, não deste documento. O `diff -r` vazio prova que a referência é o que foi
medido. Só então a cópia entra no repositório.

### 3.2 Destino por módulo

| Módulo em `extensions/` | Arquivos | Destino em `packages/coding-agent/src/extensions/` | Fase | Ordem |
|---|---:|---|---|---:|
| `internal/` | 56 | `_shared/` (biblioteca comum; não é extensão registrada) | F5 | 1 |
| `hooks/` | 6 | `hooks/` | F5 | 2 |
| `env-settings.ts`, `settings-flags.ts` | 2 | `env-settings/`, `settings-flags/` | F5 | 3 |
| `claude-rules.ts`, `context-imports.ts`, `memory.ts`, `output-styles.ts` | 4 | um diretório por extensão | F5 | 4 |
| `skills.ts`, `commands.ts`, `init.ts` | 3 | `skills-compat/`, `commands/`, `init/` | F5 | 5 |
| `todo.ts`, `question.ts` | 2 | `todo/`, `question/` | F5 | 6 |
| `status-line.ts`, `notify.ts`, `session-title.ts`, `thinking.ts`, `context-usage.ts` | 5 | um diretório por extensão | F5 | 7 |
| `git-checkpoint.ts` | 1 | `git-checkpoint/` | F5 | 8 |
| `run/` | 7 | `run/` | F5 | 9 |
| `web.ts` | 1 | `web/` (desligada) | F5 | 10 |
| `goal.ts` | 1 | `goal/` | F6 | 3 |
| `plan-mode/` | 8 | `plan-mode/` | F6 | 2 |
| `subagent/` | 53 | `subagent/` | F6 | 1 |
| `mcp/` | 9 | **não migra** (D-10) | — | — |
| `version-floor.ts` | 1 | **não migra** (D-10) | — | — |
| **Total** | **159** | 149 migram, 10 não | | |

Dentro de `internal/` há arquivos que servem só a módulos que não migram (`mcp-alias.ts`, `mcp-call.ts`,
`mcp-oauth.ts`, `pi-floor.ts`, `package-version.ts`). Eles entram na cópia byte a byte e são removidos no segundo
commit, se `tsc` confirmar que nada os importa.

<a id="f6-orquestracao"></a>

### 3.3 Divisão de `subagent/` (F6)

`subagent/` é a maior unidade (53 arquivos, 8526 linhas depois dos patches) e a de maior risco. Um PR por linha,
nesta ordem; cada PR só passa com os testes da coluna da direita.

| # | Unidade | Arquivos | Patches que a formaram | Testes |
|---:|---|---|---|---|
| 1 | Núcleo | `index.ts`, `run.ts`, `modes.ts`, `child.ts`, `params.ts`, `types.ts`, `agents.ts`, `agents/` (3), `concurrency.ts`, `worktree.ts`, `registry-text.ts`, `render.ts`, `render-result.ts`, `README.md` | — | Testes do próprio pi-code, se houver no repositório de origem (não verificado) |
| 2 | Segundo plano | `background.ts` | `subagent-panel` (parte) | `subagent-panel/fleet-spawn.test.ts` |
| 3 | Frota | `fleet/` (6) | `subagent-panel`, `zzzzzz-subagent-send`, `zzzzzzz-subagent-model-effort` | `fleet.test.ts`, `fleet-entry.test.ts`, `fleet-faults.test.ts`, `tracker.test.ts` |
| 4 | Painel | `fleet-ui/` (8), `section-nav/` | `subagent-panel`, `zz-panel-main-root`, `zzz-panel-column0`, `team` (parte) | `fleet-ui.test.ts`, `fleet-ui-layout.test.ts` |
| 5 | Transcrição | `transcript/` (5) | `subagent-render` | `subagent-render/render.test.ts`, `zzzzzzz-subagent-model-effort/render.test.ts` |
| 6 | Roteamento | `routing/` (7) | `zzzzzzz-subagent-model-effort` | `replay.test.ts` |
| 7 | Aninhamento | `nesting/` | `subagent-nesting` | `subagent-nesting.test.ts` |
| 8 | Renascimento | `respawn/` | `zz-subagent-respawn` | `zz-subagent-respawn/respawn.test.ts` |
| 9 | Envio | parte de `fleet/inbox`, `params.ts` | `zzzzzz-subagent-send` | `zzzzzz-subagent-send/send.test.ts` |
| 10 | Times | `team/` (7) | `team` | `team/team.test.ts`, `team/team-faults.test.ts` |

A cópia byte a byte de `subagent/` inteiro entra num único commit (unidade 0), fora do registro de extensões e fora
do `tsconfig`. As unidades 1 a 10 ligam um pedaço por vez: trocam imports, incluem os arquivos no `tsconfig`, portam
os testes. A extensão só é registrada em `src/extensions/index.ts` na unidade 10. Depois, `plan-mode` (testes
`plan-done-rule.test.ts`, `plan-sota.test.ts` e a suíte `bench/suites/plan`) e `goal` (`goal.test.ts`,
`goal-lifecycle.test.ts`).

## 4. Terceiros

| Componente | Fixado em | Licença | Patch local | Destino | Fase |
|---|---|---|---|---|---|
| `pi-lsp` | npm 0.1.7 (integridade sha512 em `third-party.json`) | MIT | 4080 linhas | Extensão embutida `lsp` (cópia do pacote com o patch aplicado, mesmo método da seção 3.1) | F9 |
| `ponytail` | git `ef8ca48` (v4.10.3) | MIT | 351 linhas | Pacote opcional; patch como commit num fork próprio; proposta ao autor | F9 |
| `ralph-loop` | claude-plugins-official `893173f` | Apache-2.0 | 26 linhas | Pacote opcional; idem | F9 |
| `pr-review-toolkit` | claude-plugins-official `893173f` | Apache-2.0 | nenhum | Pacote opcional instalado da origem com SHA fixo | F9 |
| `claude-red` | git `a8de813` | MIT | nenhum | Pacote opcional (já era opcional) | F9 |

Arquivos do ny-pi que referenciam estes componentes e mudam junto: `claude-home/commands/ralph-loop.md`,
`ralph-help.md`, `cancel-ralph.md`, `review-pr.md` (comandos que só funcionam com o pacote instalado: ficam marcados
`(optional)` e `check-refs.py` aceita), `claude-home/hooks` no bloco `Stop` (`vendor/ralph-loop/hooks/stop-hook.sh`
deixa de ser padrão e passa a ser registrado pelo pacote opcional).

## 5. Dados na máquina do usuário

Convertidos por `nycode migrate from-pi` (K12). O comando copia, nunca move nem apaga, e por padrão só mostra o que
faria.

| Em `~/.pi/agent/` | Para `~/.nycode/agent/` | Regra |
|---|---|---|
| `settings.json` | `settings.json` | Chaves convertidas pela tabela de [02, seção 5](02-arquitetura-alvo.md#5-configuracao-e-variaveis-de-ambiente); `packages` perde `pi-code`, `./vendor/pi-lsp`; `./vendor/ponytail` vira a fonte do pacote opcional |
| `local.env` | chaves em `settings.json` | As 9 chaves permitidas; o arquivo de origem fica intacto |
| `claude-home/settings.json` (hooks, statusLine, env) | `settings.json` | Só as entradas que o usuário mudou em relação ao exemplo; o padrão já vem embarcado |
| `mcp.json`, `models.json`, `lsp.json`, `keybindings.json` | iguais | Cópia; `mcp.json` e `models.json` nunca são sobrescritos se já existirem |
| `sessions/` | `sessions/` | Cópia; o formato de sessão é o do pi e não muda entre 1.5.2 e 1.6.0 (não verificado: conferir `docs/session-format.md` e `migrations.ts` em F4) |
| `auth*.json` | `auth.json` | Só com confirmação explícita; nunca em modo automático |
| `trust.json` | `trust.json` | Cópia |
| `extensions/`, `themes/`, `prompts/`, `skills/` do usuário | iguais | Cópia do que não for ligação simbólica criada pelo `install.sh --link` |
| `claude-home/agents`, `skills`, `commands` criados pelo usuário | `agents/`, `skills/`, `commands/` | Só os que não existem no pacote embarcado |
| `install/`, `npm/`, `vendor/`, `bin/` | não migram | São a instalação antiga |
| `~/.local/bin/pi` (wrapper) | não é tocado | O usuário remove em F12, depois da convivência |
| `~/.config/ny-pi/bench.env`, unidades systemd `bench-*` | `~/.config/nycode/bench.env`, mesmas unidades com `BENCH_REPO` novo | Manual, em F3 ([09](09-paridade-e-benchmark.md)) |

## 6. Conferência cruzada com o inventário

Cada contagem do [anexo A](anexos/A-inventario-ny-pi.md) tem de fechar com o mapa:

| Item do inventário | Contagem | Regras do mapa | Fecha |
|---|---:|---|---|
| Unidades em `extensions/` | 23 (60 arquivos) | E01, E02, E05 a E07, E10 a E15, E17, E19, E20, E23 a E26 | 60 arquivos |
| Arquivos em `claude-home/patches/` | 60 | K05 a K07, P01 a P15 | 60 |
| Agentes, comandos, skills | 17 + 17 + 227 | R08 | 261 |
| Hooks | 21 | R09 (9), R10 (6), R11 (6) | 21 |
| `claude-home/bin` | 57 | B04, B05, C09, E03, E04, E08, E16, E18, E21, E22, E28, K08, K09, R13, R14, R15 | 57 |
| `claude-home/docs` | 29 | D02 | 29 |
| `bench/` | 870 | B01, B02 | 870 |
| `docs/` | 39 | B03 (31), C10 (1), D01 (7) | 39 |
| `scripts/` | 29 | C04 a C08, E09, I01, P16 | 29 |
| `.github/` | 16 | C01 a C03, G10 a G13 | 16 |

A conferência é reexecutável:

```bash
cut -f1,5 docs/migration/ny-pi-core/anexos/E-mapa-arquivo-a-arquivo.tsv \
  | awk -F'\t' 'NR>1 { split($1, p, "/"); k = (p[1]=="claude-home" ? p[1]"/"p[2] : p[1]); c[k]++ } END { for (k in c) print c[k], k }' \
  | sort -k2
```
