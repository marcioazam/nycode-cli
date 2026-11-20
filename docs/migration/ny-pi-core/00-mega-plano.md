# Mega plano: migrar o ny-pi para o core do nycode (fork do pi)

Estado: **plano, nada implementado**. Este conjunto de documentos é o único entregável desta etapa.
Levantamento feito em 2026-11-20 sobre `marcioazam/ny-pi@e4f8729` (origem) e `marcioazam/nycode@fb05db936` (destino).

## 1. Objetivo

Levar tudo o que hoje é o harness **ny-pi** (montado por fora do pi, com wrapper, patches aplicados no boot,
extensões, hooks, agentes, skills, regras, benchmark e instalador) para **dentro do core do nycode**, o fork de
`earendil-works/pi@073b0ba` que já vive em `marcioazam/nycode`. Ao final:

1. O binário `nycode` entrega, sem wrapper e sem patch em tempo de boot, o mesmo comportamento medido do ny-pi.
2. Todas as regras de repositório do ny-pi valem no nycode (configuração do GitHub e arquivos versionados).
3. O README do nycode mostra o logo do nycode (recuperado do histórico git), sem o logo do pi.
4. O repositório `marcioazam/ny-pi` fica arquivado, apontando para o nycode.
5. O fork continua recebendo o upstream com custo de conflito controlado.

## 2. Fora do escopo

- Implementar qualquer item (este plano só descreve).
- Mudar o comportamento medido do harness durante a migração. Melhorias entram depois do corte (F12), cada uma pelo
  gate de custo × benefício.
- Redesenhar a interface. Peças de UI migram como estão.
- Migrar `apps/p2`, `apps/p3` e `apps/p2-mac` do upstream: ficam como vieram no fork.
- Renomear os serviços do upstream ainda usados (`pi.dev`, catálogo de modelos, OAuth): tratado em F11 como decisão
  própria ([D-12](11-decisoes-e-pendencias.md)).

## 3. Ponto de partida (fatos verificados)

| Item | ny-pi (origem) | nycode (destino) |
|---|---|---|
| Natureza | Harness por fora do pi: wrapper `bin/pi`, 19 patches de pi-code, 2 patches de dist do pi, 23 extensões próprias, `claude-home/` | Fork do pi com histórico, renomeado (`@nycode/*`, binário `nycode`, `~/.nycode/agent`, `NYCODE_*`) |
| Base do pi | pi **1.5.2** instalado de `pi.dev` | pi **1.6.0** (`073b0ba`) como código-fonte |
| Camada Claude-compat | **pi-code 1.7.0** (MIT, `ilovepixelart/pi-code`, ~32 mil linhas) + 19 patches | Não existe: sem subagentes, plan mode, goal, hooks, todo |
| Arquivos | 1485 (870 em `bench/`, 439 em `claude-home/`, 60 em `extensions/`) | monorepo npm: 12 pacotes `@nycode/*` 1.6.0, 3 apps |
| Linguagens | TypeScript, Python 3.12, shell POSIX; Node 24 | TypeScript; Node >= 22.19 |
| Checks obrigatórios | `ci-static`, `ci-security`, `instruction-budget`, `bench-pr` (ruleset, squash, linear) | `build-check`, `test (coding-agent\|durable\|chord\|other)`, `mcp-conformance` (proteção clássica) |
| Publicação | Não publica no npm; `install.sh` + `publish.list` (symlinks) | `scripts/release.mjs` + `publish.mjs`; escopo `@nycode` ainda **não existe** no npm (404) |
| Logo | — | `docs/assets/nycode-pixel.svg` removido em `c410d670e`; recuperável de `9ea437bf7` |

Detalhe completo: [01-inventario-origem.md](01-inventario-origem.md) e anexos [A](anexos/A-inventario-ny-pi.md),
[B](anexos/B-mapa-core-nycode.md), [C](anexos/C-logo-historico.md), [D](anexos/D-regras-github-brutas.md).

## 4. Princípios

1. **Paridade antes de melhoria.** Cada fase prova que o nycode faz o que o ny-pi fazia (testes portados, replay com a
   API falsa de `bench/contract`, gate do benchmark). Nada muda de comportamento na mesma mudança que move código.
2. **Estrangulamento por peça** (strangler fig): o ny-pi segue utilizável até o corte; cada peça migra, é provada e só
   então a antiga é desligada.
3. **Menor superfície de conflito com o upstream.** Código novo entra em arquivos e diretórios novos. Arquivos do
   upstream só recebem edição em pontos de costura pequenos e listados ([08](08-sincronizacao-upstream.md)).
4. **Sem patch em tempo de execução.** Todo patch vira código-fonte com teste. `patch -p1` e `sed -i` no boot acabam.
5. **Um PR por unidade, verde e reversível.** Squash, com o teste da unidade no mesmo PR.
6. **Custo × benefício acima de tudo.** Peça `core`, `ui` ou `optional` segue a especificação 0005 do ny-pi, que migra
   junto. Peça opcional não entra no contexto do modelo por padrão.
7. **Segurança da cadeia de suprimento não regride.** Actions por SHA, dependências exatas, `--ignore-scripts`,
   verificação de vazamento, publicação com proveniência.
8. **Evidência registrada.** Cada fase fecha com um registro em `docs/migration/ny-pi-core/evidencias/` (comandos,
   SHAs, saídas).

## 5. Arquitetura alvo em uma página

Detalhe em [02-arquitetura-alvo.md](02-arquitetura-alvo.md).

| Peça do ny-pi | Destino no nycode | Forma |
|---|---|---|
| `bin/pi` (wrapper) | `packages/coding-agent/src/cli/args.ts`, `settings-schema.ts`, `settings-defaults.ts` | Flags e padrões nativos; o wrapper deixa de existir |
| 2 patches de dist do pi | `packages/coding-agent/src/core/sdk.ts:370`, `packages/mcp/src/transports/stdio.ts:10` | Edição direta do fonte, com teste |
| pi-code 1.7.0 + 19 patches | `packages/coding-agent/src/extensions/<nome>/` | Extensões embutidas (`builtin:<nome>`), fonte já com os patches aplicados |
| 23 extensões próprias | `packages/coding-agent/src/extensions/<nome>/` ou core, conforme a peça | Embutidas; as que dependem de campo interno viram API nativa |
| `claude-home/agents`, `skills`, `commands`, `rules*`, `CLAUDE.md` | `packages/coding-agent/resources/` (novo) | Recursos embarcados, carregados pelo `resource-loader` com a menor precedência |
| `claude-home/hooks` (guard etc.) | Fase A: scripts embarcados em `resources/hooks/`; fase B: motor de permissão nativo em `core/permissions/` | Paridade primeiro, porta nativa depois, com o corpus do `test_guard.py` como oráculo |
| `claude-home/bin` (ferramentas) | `scripts/harness/` e subcomandos `nycode doctor`, `nycode deliver` | Ferramentas do repositório ou do CLI |
| Terceiros (`pi-lsp`, `ponytail`, `ralph-loop`, `pr-review-toolkit`, `claude-red`) | `pi-lsp` embutido; os demais como pacotes opcionais | Sem `third-party.json` com patch por fora |
| `bench/` | `bench/` na raiz | Braço `nycode` novo; referências guardadas preservadas |
| `scripts/ci`, workflows | `scripts/ci/` + `.github/workflows/` unificados | Um conjunto de checks obrigatórios |
| `docs/specs`, `claude-home/docs`, `docs/bench` | `docs/specs/`, `docs/harness/`, `docs/bench/` | Mesmos documentos, caminhos e nomes atualizados |
| `install.sh`, `publish.list`, `npm/` | `scripts/release.mjs`, instalador do fork, pacote `@nycode/coding-agent` | Instalação e publicação únicas |

## 6. Fases

Cada fase tem critérios de entrada e de saída verificáveis. O passo a passo com comandos está em
[06-guia-de-execucao.md](06-guia-de-execucao.md); a lista de conferência por item, em
[12-checklist-mestre.md](12-checklist-mestre.md); o destino de cada arquivo, em
[03-mapa-de-migracao.md](03-mapa-de-migracao.md).

| Fase | Nome | Entrega | Tamanho | Depende de |
|---|---|---|---|---|
| F0 | Preparação e congelamento | Decisões assinadas, linha de base medida, ny-pi congelado, limpeza do repositório destino | P | — |
| F1 | Importação do histórico | Histórico do ny-pi dentro do nycode em `import/ny-pi/` | P | F0 |
| F2 | Governança versionada e marca | Arquivos de regra, comunidade, logo e README | P | F1 |
| F3 | CI unificado, gates e benchmark | Workflows, scripts de CI, `bench/` operante, ruleset ativo | G | F2 |
| F4 | Core nativo | Flags do wrapper, configuração tipada, 2 patches de core, migração de dados do usuário | M | F3 |
| F5 | Camada base embutida | pi-code (sem subagent, plan-mode, goal) como extensões embutidas | G | F4 |
| F6 | Orquestração embutida | subagent (frota, times, aninhamento), plan-mode, goal | GG | F5 |
| F7 | Extensões próprias | As 23 unidades de `extensions/` | G | F5 (F6 para `plan-gate`) |
| F8 | Recursos embarcados e permissões | Agentes, skills, comandos, regras, instruções, hooks; motor de permissão nativo | G | F5, F6 |
| F9 | Terceiros | `pi-lsp` embutido, demais como opcionais | M | F5 |
| F10 | Paridade final e nova linha de base | Gate completo, nova linha de base `main`, relatório de paridade | M | F6 a F9 |
| F11 | Distribuição | Escopo npm, publicação com proveniência, instalador, binários, atualização | G | F10 |
| F12 | Corte e descomissionamento | Dados do usuário migrados, ny-pi arquivado | P | F11 |

Tamanho: P até 5 PRs, M até 15, G até 40, GG acima de 40. A ordem de grandeza vem das contagens do inventário
(por exemplo, F6 move cerca de 12 mil linhas de pi-code mais 5,2 mil linhas de patch).

### F0. Preparação e congelamento

- Entrada: este plano revisado pelo dono.
- Trabalho:
  1. Fechar as decisões marcadas "aguarda o dono" em [11](11-decisoes-e-pendencias.md).
  2. Congelar o ny-pi: só correção de segurança entra em `ny-pi/main` até F12; registrar o SHA de congelamento.
  3. Medir a linha de base do destino: `npm ci --ignore-scripts`, `npm run build`, `npm run check`, `./test.sh` no
     `nycode@main`; guardar a saída.
  4. Limpar o destino: 213 ramos remotos herdados do antigo nycode em Rust (`dependabot/cargo/*`, `backup/*`,
     `feat/sota-v140-*`), rótulo `rust`, CodeQL "default setup" preso em `actions, rust`, ambiente `copilot`.
     Apagar ramos exige autorização do dono ([D-15](11-decisoes-e-pendencias.md)).
  5. Triar os 8 alertas abertos de secret scanning do destino (credenciais OAuth de cliente instalado herdadas do
     upstream em `packages/ai/src/utils/oauth/` e um `plan.md` histórico).
  6. Reservar o escopo `@nycode` no npm (hoje `npm view @nycode/coding-agent` devolve 404).
  7. Criar a etiqueta `v1.6.0-base` no commit do fork, para o `build-check` ter uma tag de referência.
- Saída: decisões registradas; `evidencias/F0.md` com as saídas; nenhum ramo órfão; alertas triados.

### F1. Importação do histórico do ny-pi

- Trabalho: reescrever um clone do ny-pi para o subdiretório `import/ny-pi/` e fundir no nycode com histórias não
  relacionadas, em **um PR com merge commit** (o método squash perderia o histórico). Precisa ocorrer **antes** de o
  ruleset do ny-pi (só squash) ser ativado em F3. Comandos em [06](06-guia-de-execucao.md#f1).
- Saída: `git log --follow import/ny-pi/extensions/plan-gate.ts` mostra os commits originais; nenhum arquivo fora de
  `import/ny-pi/` muda; `import/` está fora do build, do lint e do pacote publicado.
- A partir daqui, toda migração é um `git mv` de `import/ny-pi/...` para o destino, o que preserva a autoria.

### F2. Governança versionada e marca

- Trabalho: trazer os arquivos de regra do ny-pi, reconciliar com os do fork e trocar a marca. Guia completo em
  [04-regras-do-repositorio.md](04-regras-do-repositorio.md) e [05-marca-e-readme.md](05-marca-e-readme.md).
- Saída: `CODEOWNERS`, `dependabot.yml`, modelos de issue e de PR, `CODE_OF_CONDUCT.md`, `SUPPORT.md`,
  `.editorconfig`, `.pre-commit-config.yaml`, `.gitleaks.toml`, `zizmor.yml`, `release.yml` presentes; `AGENTS.md` e
  `CONTRIBUTING.md` reconciliados; `README.md` com `docs/assets/nycode-pixel.svg` e sem `pi.dev/logo-auto.svg`;
  perfil de comunidade do GitHub em 100%.

### F3. CI unificado, gates e benchmark

- Trabalho: mover `scripts/ci/`, os 5 workflows e `bench/`; criar o braço `nycode` do benchmark; instalar o
  verificador local `bench-pr`; só então ativar o ruleset. Guia em
  [07-ci-qualidade-seguranca.md](07-ci-qualidade-seguranca.md) e
  [09-paridade-e-benchmark.md](09-paridade-e-benchmark.md).
- Saída: um PR de teste passa em todos os checks obrigatórios do conjunto unificado; o ruleset `main` está ativo no
  nycode e a proteção clássica foi removida; `bench run --arm nycode --tier smoke` roda.

### F4. Core nativo

- Trabalho: o que hoje é wrapper, variável de ambiente ou reescrita de `dist` vira código do core.
  - `--bypass`, `--dangerously-skip-permissions`, `--safe`, `--no-bypass` em `cli/args.ts`.
  - Confiança de projeto `never` e exclusão de `web_search` como padrões em `settings-defaults.ts`.
  - As 9 chaves do `local.env` e as demais variáveis `PI_*` viram chaves tipadas em `settings-schema.ts`, com a
    variável `NYCODE_*` equivalente ([tabela](02-arquitetura-alvo.md#5-configuracao-e-variaveis-de-ambiente)).
  - `piSameContextMessage` em `core/sdk.ts` e `STDIN_CLOSE_GRACE_MS = 100` em `packages/mcp`.
  - Comando `nycode migrate from-pi` (importa `~/.pi/agent` para `~/.nycode/agent`).
- Saída: os testes portados (`cache-warm-identity`, `mcp-close-grace`, `test_pi_env.sh` reescrito) passam; nenhuma
  leitura de `CLAUDE_CONFIG_DIR` ou `PI_*` resta no código migrado.

### F5. Camada base embutida

- Trabalho: importar o pi-code 1.7.0 **com os 19 patches já aplicados** (a árvore que roda hoje), trocar os imports
  `@earendil-works/pi-*` por `@nycode/*`, registrar cada módulo como extensão embutida e portar seus testes. Nesta
  fase entram: `hooks`, `todo`, `question`, `commands`, `status-line`, `notify`, `git-checkpoint`, `memory`,
  `claude-rules`, `context-imports`, `output-styles`, `skills`, `session-title`, `thinking`, `env-settings`,
  `settings-flags`, `init`, `run`, `context-usage`, `web` (desligada) e o diretório `internal`.
- Saída: `nycode` sem pacote externo oferece esses recursos; `settings.json` não precisa de `packages`; os testes de
  cada patch (`*.test.ts`) passam contra o fonte, sem etapa de aplicar patch.

### F6. Orquestração embutida

- Trabalho: `subagent` (8,5 mil linhas, mais os patches de painel, render, aninhamento, times, respawn, envio e
  modelo por spawn), `plan-mode` (2,6 mil) e `goal`. É a fase de maior risco: dividir por submódulo
  ([03](03-mapa-de-migracao.md#f6-orquestracao)).
- Saída: testes de frota, times e plano passam; suíte `bench/suites/plan` e `multi` verdes no braço `nycode`.

### F7. Extensões próprias

- Trabalho: as 23 unidades de `extensions/`. As que tocam campos internos (`sticky-prompt`, `ui/a11y`,
  `ui-visual/header`, `ui/terminal`) ganham API pública no core em vez de acesso a campo privado.
- Saída: 22 arquivos de teste portados e verdes; nenhuma extensão embutida importa caminho privado de `@nycode/tui`.

### F8. Recursos embarcados e permissões

- Trabalho: 17 agentes, 30 skills, 17 comandos, regras e instruções passam a ser recursos embarcados; `guard.py` e os
  demais hooks rodam como scripts embarcados (fase A) e o motor nativo de permissão entra atrás de chave (fase B).
- Saída: `core_scope.py`, `skill_lint.py`, `check-agents.py`, `check-refs.py` e `instruction_budget.py` passam sobre
  os novos caminhos; o motor nativo dá o mesmo veredito que `guard.py` em 100% do corpus de teste e do fuzz.

### F9. Terceiros

- Trabalho: `pi-lsp` 0.1.7 com seu patch de 4080 linhas entra como extensão embutida `lsp`; `ponytail`,
  `ralph-loop`, `pr-review-toolkit` e `claude-red` viram pacotes opcionais instaláveis, sem patch local.
- Saída: `third-party.json` e `patches/third-party/` deixam de existir; `NOTICE` lista as origens e licenças.

### F10. Paridade final e nova linha de base

- Trabalho: rodar o gate completo (`tier full`) do braço `nycode` contra a referência guardada do ny-pi; fechar as
  11 dimensões de avaliação; gravar a nova linha de base. Critério em
  [09](09-paridade-e-benchmark.md#criterio-de-paridade).
- Saída: relatório de paridade assinado; `docs/bench/baseline-main/` regravado por PR.

### F11. Distribuição

- Trabalho: publicação no npm por *trusted publishing* com proveniência, binários, Nix, instalador próprio,
  autoatualização e decisão sobre os serviços do upstream ainda consultados.
- Saída: `npm install -g @nycode/coding-agent` instala a versão com o harness; instalação limpa em contêiner passa o
  teste de fumaça.

### F12. Corte e descomissionamento

- Trabalho: migrar os dados do dono (`nycode migrate from-pi`), trocar o `pi` do dia a dia por `nycode`, manter os
  dois lado a lado por um período de observação, arquivar `marcioazam/ny-pi` com aviso no README.
- Saída: `ny-pi` arquivado; `import/ny-pi/` removido do nycode (o histórico continua no git); checklist mestre 100%.

## 7. Grafo de dependências e paralelismo

```text
F0 → F1 → F2 → F3 → F4 → F5 ─┬→ F6 ─┬→ F8 ─┐
                             ├→ F7 ─┘      ├→ F10 → F11 → F12
                             └→ F9 ────────┘
```

- F6, F7 e F9 correm em paralelo depois de F5 (arquivos disjuntos). `plan-gate` (F7) espera `plan-mode` (F6).
- F8 começa pelos recursos que não dependem de subagentes (skills, regras) em paralelo a F6.
- Dentro de uma fase, no máximo 4 frentes de escrita ao mesmo tempo, cada uma com arquivos próprios.
- Transversais, do começo ao fim: sincronização com o upstream ([08](08-sincronizacao-upstream.md)), registro de
  evidências e atualização do checklist.

<a id="8-criterios-globais-de-aceite"></a>

## 8. Critérios globais de aceite

1. `nycode --version` e `nycode --help` funcionam em `HOME` vazio, sem `~/.pi`, sem wrapper e sem rede além do
   provedor do modelo.
2. `rg -n "patch -p1|sed -i|CLAUDE_CONFIG_DIR|node_modules/pi-code|\.pi/agent"` no código migrado não devolve nada
   fora de `import/`, `docs/` e do comando de migração.
3. Todos os testes do ny-pi têm um equivalente verde no nycode, ou uma linha em
   [03](03-mapa-de-migracao.md) que justifica a remoção.
4. Gate do benchmark: braço `nycode` não inferior à referência do ny-pi em acerto, custo por tarefa não pior além da
   margem definida em [09](09-paridade-e-benchmark.md).
5. As 60 linhas (R01 a R60) da tabela de regras em [04](04-regras-do-repositorio.md) estão em "igual ou mais estrito".
6. README sem logo do pi; `docs/assets/nycode-pixel.svg` com sha256
   `7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2`.
7. Sincronização com o upstream executada pelo menos duas vezes depois de F6, com o tempo de conflito registrado.
8. Scorecard, CodeQL, Dependabot e secret scanning sem alerta aberto que o código possa fechar.

## 9. Riscos principais

Registro completo e planos de reversão em [10-riscos-e-rollback.md](10-riscos-e-rollback.md).

| Risco | Efeito | Contenção |
|---|---|---|
| Base do pi muda de 1.5.2 para 1.6.0 junto com a migração | Diferença de comportamento sem causa clara | F4 e F5 medem primeiro a base 1.6.0 "pura" com o harness por fora, depois migram |
| Subagentes embutidos divergem do pi-code remendado | Regressão em frota, times e plano | F6 importa a árvore já remendada byte a byte e só depois reformata |
| Conflito recorrente com o upstream | Sincronização cara | Costuras listadas, arquivos novos, sincronização semanal pequena |
| Regra "histórico linear, só squash" impede fundir o upstream | Sincronização impossível ou histórico perdido | Decisão [D-07](11-decisoes-e-pendencias.md): fusão permitida só para `sync/upstream-*`, auditada |
| Porta nativa do `guard.py` deixa passar um comando | Falha de segurança | Fase A mantém o script; fase B só liga com 100% do corpus e fuzz iguais |
| Custo do benchmark durante a migração | Gasto alto de conta | `bench-pr` só para mudança funcional; `tier smoke` por PR, `full` por fase |

## 10. Papéis

| Papel | Quem | Responsabilidade |
|---|---|---|
| Dono | Marcio | Decisões de [11](11-decisoes-e-pendencias.md), autorizações (apagar ramos, npm, arquivar), aceite de fase |
| Orquestrador | sessão principal do agente | Divide em unidades, escreve os briefings, julga a evidência |
| Executores | subagentes escritores | Um PR por unidade, com teste |
| Revisor | `plan-reviewer`, `code-reviewer`, `security-reviewer` | Revisão por fase; segurança obrigatória em F4 e F8 |
| Entrega | `git-delivery` | Commit, PR, merge em verde |

## 11. Como usar estes documentos

1. Ler este plano e [11-decisoes-e-pendencias.md](11-decisoes-e-pendencias.md).
2. Para executar uma fase: abrir a seção da fase em [06](06-guia-de-execucao.md), seguir os passos, marcar os itens
   em [12](12-checklist-mestre.md) e gravar `evidencias/F<n>.md`.
3. Para saber onde vai um arquivo: [03](03-mapa-de-migracao.md).
4. Para uma regra do repositório: [04](04-regras-do-repositorio.md).
5. Quando um fato do levantamento mudar (novo commit no ny-pi ou no upstream), regerar os anexos e revisar o mapa.
