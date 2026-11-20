# Checklist mestre

Uma linha por item verificável. Marcar `[x]` só com a evidência gravada em `evidencias/F<n>.md` (comando e saída).
Identificador: `C-F<fase>-<n>`. A coluna "prova" diz o que tem de ser observado.

## F0. Preparação e congelamento

- [x] C-F0-01 Decisões D-01 a D-28 lidas pelo dono; as "aguarda o dono" (D-15, D-16, D-17, D-22) respondidas. Prova: registro datado em `evidencias/F0.md`.
- [x] C-F0-02 SHA de congelamento do ny-pi registrado. Prova: `git -C ny-pi rev-parse origin/main`.
- [x] C-F0-03 Linha de base do destino: `npm ci --ignore-scripts`, `npm run build`, `npm run check` com saída 0. Prova: códigos de saída.
- [x] C-F0-04 `./test.sh` no destino; falhas conhecidas listadas (hoje: `@nycode/env`, falta `cargo`). Prova: resumo do teste.
- [x] C-F0-05 Anexos A, B, C, D regerados se algum commit novo entrou. Prova: SHAs no cabeçalho dos anexos.
- [x] C-F0-06 Pendência P-1 fechada: classe de cada peça copiada da especificação 0005. Prova: coluna preenchida.
- [x] C-F0-07 Ramos herdados listados por prefixo; nenhum com PR aberto. Prova: `gh pr list --state open` vazio.
- [x] C-F0-08 Ramos herdados apagados (D-15, com autorização). Prova: `git ls-remote --heads origin | wc -l`.
- [x] C-F0-09 8 alertas de secret scanning triados (D-16, com autorização). Prova: API devolve 0 abertos.
- [x] C-F0-10 Escopo npm decidido e reservado (D-17). Prova: `npm org ls` ou página da organização. Substituído pela decisão do dono de 2026-11-20 (sem organização npm; repositório público): prova = registro em `evidencias/F0.md` e `gh repo view --json visibility` = `PUBLIC`.
- [x] C-F0-11 Etiqueta `v1.6.0-base` criada no commit do fork (P-6). Prova: `git tag -l`.
- [x] C-F0-12 Script de renome do fork versionado no repositório. Prova: caminho do arquivo.
- [x] C-F0-13 Remoto `upstream` configurado e `rerere` ligado. Prova: `git remote -v`, `git config rerere.enabled`.
- [x] C-F0-14 Descrição e tópicos do repositório corrigidos (a descrição ainda fala em Rust). Prova: `gh repo view`.
- [x] C-F0-15 Rótulo `rust` e ambiente `copilot` removidos. Prova: API.

## F1. Importação do histórico

- [x] C-F1-01 Clone novo do ny-pi filtrado para `import/ny-pi/`. Prova: `git ls-files | grep -vc '^import/ny-pi/'` devolve 0 no clone.
- [x] C-F1-02 Verificação de vazamento no histórico do clone filtrado. Prova: saída 0 de `check-leaks.sh --history`.
- [x] C-F1-03 Fusão com `--allow-unrelated-histories` num PR com método merge. Prova: commit com dois pais em `main`.
- [x] C-F1-04 1485 arquivos sob `import/ny-pi/`. Prova: `git ls-files import/ny-pi | wc -l`.
- [x] C-F1-05 Histórico preservado. Prova: `git log --follow --oneline import/ny-pi/extensions/plan-gate.ts` mostra commits do ny-pi.
- [x] C-F1-06 `import/` fora de `workspaces`, Biome, `tsconfig`, pacote publicado. Prova: `npm run check` igual à linha de base.
- [x] C-F1-07 Nenhum arquivo fora de `import/ny-pi/` mudou no merge. Prova: `git diff --stat <pai1> <merge> -- . ':!import'` vazio (exceto as exclusões de C-F1-06).

## F2. Governança versionada e marca

- [x] C-F2-01 `docs/assets/nycode-pixel.svg` restaurado. Prova: sha256 `7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2`.
- [x] C-F2-02 `docs/assets/nycode-wordmark-ansi.txt` restaurado. Prova: sha256 `22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f`.
- [x] C-F2-03 README sem o logo do pi. Prova: `rg -n "pi.dev/logo" README.md` vazio.
- [x] C-F2-04 README com o logo do nycode no topo. Prova: `rg -n "docs/assets/nycode-pixel.svg" README.md`.
- [x] C-F2-05 README não manda instalar por `pi.dev/install.sh`. Prova: busca vazia.
- [x] C-F2-06 Cada ocorrência de `pi.dev` e `earendil` no README tratada conforme [05](05-marca-e-readme.md). Prova: tabela de 05 marcada.
- [x] C-F2-07 Título de reserva "π" trocado (K14). Prova: `rg -n '"π"' packages/coding-agent/src/config.ts` vazio.
- [x] C-F2-08 `CODEOWNERS`, `PULL_REQUEST_TEMPLATE.md`, `release.yml`, `DISCUSSION_TEMPLATE/` presentes.
- [x] C-F2-09 `dependabot.yml` reescrito para o monorepo, com espera de 7 dias.
- [x] C-F2-10 Modelos de issue fundidos; nenhum aponta para o Discord do upstream.
- [x] C-F2-11 `APPROVED_CONTRIBUTORS` removido (D-18).
- [x] C-F2-12 `CODE_OF_CONDUCT.md`, `SUPPORT.md` presentes; `SECURITY.md` fundido.
- [x] C-F2-13 `.editorconfig`, `.gitattributes`, `.gitignore` fundidos; `.gitleaks.toml`, `.leak-allow` presentes; `.gitleaksignore` reconciliado.
- [x] C-F2-14 `.husky/pre-commit` roda a verificação de vazamento nos arquivos preparados.
- [x] C-F2-15 `AGENTS.md` e `CONTRIBUTING.md` reconciliados segundo a tabela de [04](04-regras-do-repositorio.md).
- [x] C-F2-16 `NOTICE` cita ny-pi e pi-code com licença e commit.
- [x] C-F2-17 Especificações 0001 a 0009 em `docs/specs/`, com caminhos atualizados.
- [x] C-F2-18 Configuração de merge do repositório aplicada. Prova: `gh api repos/marcioazam/nycode` mostra os 8 campos alvo.
- [x] C-F2-19 14 rótulos criados. Prova: `gh api .../labels` com 26 ou mais.
- [x] C-F2-20 Perfil de comunidade em 100%. Prova: `gh api repos/marcioazam/nycode/community/profile -q .health_percentage`.

## F3. CI unificado, gates e benchmark

- [ ] C-F3-01 `scripts/ci/` no destino com caminhos novos; `run-static.sh` e `run-security.sh` passam localmente.
- [ ] C-F3-02 Lints migrados passam: `core_scope.py`, `skill_lint.py`, `structure_changed.py` (com a lista de base do upstream), `check-refs.py`, `instruction_budget.py`.
- [ ] C-F3-03 Workflows `ci-static`, `ci-security`, `instruction-budget`, `codeql`, `scorecard` presentes, com actions por SHA e gatilho `merge_group` nos obrigatórios.
- [ ] C-F3-04 `ci.yml` do fork mantido; `npm-audit.yml` unificado com o `osv-scanner`.
- [ ] C-F3-05 CodeQL "default setup" desligado; workflow próprio analisa `javascript-typescript`, `python`, `actions` (D-20).
- [ ] C-F3-06 Job `merge-policy` presente (D-07).
- [ ] C-F3-07 `bench/` no destino; testes do bench passam; `bench/suites` fora dos lints.
- [ ] C-F3-08 Tier `smoke` criado (D-27) e modo de paridade (D-28); braço `nycode` definido em `bench/arms.toml`; `bench run --arm nycode --tier smoke` roda.
- [ ] C-F3-09 Braço temporário `ny-pi@1.6.0` medido (D-25). Prova: `runs.jsonl` e veredito guardados.
- [ ] C-F3-10 Verificador `bench-pr` apontado para o nycode; classifica mudança não funcional (D-21). Prova: status em um PR de documentação.
- [ ] C-F3-11 PR de teste com os 10 checks obrigatórios verdes. Prova: `gh pr checks`.
- [ ] C-F3-12 Ruleset `main` criado e ativo; JSON versionado em `.github/rulesets/main.json` igual ao aplicado. Prova: comparação.
- [ ] C-F3-13 Proteção clássica removida depois do ruleset. Prova: API devolve 404 "Branch not protected".
- [ ] C-F3-14 Merge por squash é o único possível fora de `sync/upstream-*` na prática. Prova: tentativa de merge commit comum barrada pelo `merge-policy`.

## F4. Core nativo

- [ ] C-F4-01 K1 no fonte; teste portado verde.
- [ ] C-F4-02 K2 no fonte; teste portado verde.
- [ ] C-F4-03 K3: quatro flags aceitas; `nycode --help` as lista.
- [ ] C-F4-04 K4: chaves novas no esquema; esquema JSON regenerado; padrões do ny-pi (`defaultProjectTrust`, `quietStartup`, `retry`, `shellCommandPrefix`).
- [ ] C-F4-05 Cada linha da tabela de variáveis de [02, seção 5](02-arquitetura-alvo.md#5-configuracao-e-variaveis-de-ambiente) com teste de leitura da variável e da chave.
- [ ] C-F4-06 K12: `nycode migrate from-pi` em modo de simulação por padrão; nunca apaga a origem; credenciais só com confirmação. Prova: teste com `HOME` descartável.
- [ ] C-F4-07 Exemplos `mcp`, `models`, `lsp` em `examples/config/`; teste do exemplo de modelos verde.
- [ ] C-F4-08 Revisão de segurança das flags de permissão.
- [ ] C-F4-09 `bin/pi` e `bin/test_pi_env.sh` removidos de `import/`.

## F5. Camada base embutida

- [ ] C-F5-01 Árvore de referência do pi-code conferida: sha1 do tarball e `diff -r` vazio contra a instalada.
- [ ] C-F5-02 Cópia byte a byte de `internal/` e dos módulos base num commit sem outras mudanças.
- [ ] C-F5-03 a C-F5-22 Uma por extensão da tabela 3.1 de [02](02-arquitetura-alvo.md#31-vindas-do-pi-code-170-ja-com-os-19-patches) (20 extensões de F5): registrada como embutida, imports trocados, formatada, teste verde.
- [ ] C-F5-23 Pendência P-3 fechada: `npm run check` sem erro de tipo contra a `ExtensionAPI` da 1.6.0.
- [ ] C-F5-24 `web` nasce desligada; `web_search` ausente da lista de ferramentas numa sessão nova.
- [ ] C-F5-25 Testes de patch portados verdes: `notify-focus`, `rewind-tree`, `statusline-multiline`, `todo-collapse`, `statusline-provider`.
- [ ] C-F5-26 `mcp/` e `version-floor.ts` do pi-code não entram; `internal` sem arquivo órfão.
- [ ] C-F5-27 `settings.json` novo não precisa de `packages`. Prova: sessão em `HOME` vazio com os recursos presentes.
- [ ] C-F5-28 `NOTICE` com a atribuição do pi-code.
- [ ] C-F5-29 Smoke do benchmark não inferior à referência `ny-pi@1.6.0`.

## F6. Orquestração embutida

- [ ] C-F6-01 a C-F6-10 As dez unidades de `subagent` da tabela 3.3 de [03](03-mapa-de-migracao.md#f6-orquestracao), cada uma com seus testes.
- [ ] C-F6-11 `subagent` registrada como embutida.
- [ ] C-F6-12 `plan-mode` embutida; `plan-done-rule.test.ts` e `plan-sota.test.ts` verdes.
- [ ] C-F6-13 `goal` embutida, sem portão de confiança; `goal.test.ts` e `goal-lifecycle.test.ts` verdes.
- [ ] C-F6-14 Suítes `bench/suites/plan` e `multi` não inferiores à referência.
- [ ] C-F6-15 Aninhamento até a profundidade 3 e limite de 4 escritores preservados. Prova: teste de aninhamento.
- [ ] C-F6-16 `scripts/check-patch-stack.sh` e `claude-home/patches/pi-code/` removidos de `import/`.
- [ ] C-F6-17 Primeira sincronização com o upstream depois de F6 feita e medida.

## F7. Extensões próprias

- [ ] C-F7-01 a C-F7-23 Uma por unidade da tabela 3.2 de [02](02-arquitetura-alvo.md#32-vindas-de-extensions-do-ny-pi): migrada, absorvida ou removida conforme a tabela, com o teste indicado no mapa.
- [ ] C-F7-24 K7, K8, K9 no core com teste.
- [ ] C-F7-25 K10: API pública no `@nycode/tui`; nenhuma extensão embutida lê campo privado. Prova: busca por acesso a propriedade privada vazia.
- [ ] C-F7-26 Temas `tokyo-night` e `mono` embarcados; `tokyo-night` é o padrão; `NO_COLOR` troca para `mono`.
- [ ] C-F7-27 Nenhuma diferença visual em relação ao ny-pi. Prova: portões `pi-ui-final-gate.sh` e `terminal-sota` verdes.
- [ ] C-F7-28 22 arquivos de teste de `extensions/` com equivalente verde.

## F8. Recursos embarcados e permissões

- [ ] C-F8-01 K6 e K13: `resources/` carregado com a menor precedência e incluído no pacote.
- [ ] C-F8-02 Instruções (`contract`, `headless`, `lite`) embarcadas; orçamento de instruções não cresce. Prova: `instruction_budget.py check`.
- [ ] C-F8-03 Regras (`safety.md`, 4 de referência) embarcadas.
- [ ] C-F8-04 30 skills embarcadas com a classe da 0005; as `optional` fora do contexto do modelo. Prova: `skill_lint.py`, `core_scope.py`.
- [ ] C-F8-05 17 comandos embarcados.
- [ ] C-F8-06 17 agentes embarcados; `check-agents.py` verde.
- [ ] C-F8-07 Nenhum texto embarcado cita `~/.pi`, `$CLAUDE_CONFIG_DIR` ou `claude-home`. Prova: `check-refs.py` e busca.
- [ ] C-F8-08 Hooks fase A: `guard.py`, `graph_context.py`, `hook-dispatch.sh` registrados por padrão; `test_guard.py`, fuzz e demais testes Python verdes.
- [ ] C-F8-09 Linha de status embarcada; 4 testes do HUD verdes.
- [ ] C-F8-10 `/bypass` e o atalho no motor de permissão (K11).
- [ ] C-F8-11 Hooks fase B: motor nativo com o mesmo veredito que `guard.py` em 100% do corpus e do fuzz. Prova: relatório do teste diferencial.
- [ ] C-F8-12 Falha do motor de permissão nega a chamada. Prova: teste de falha.
- [ ] C-F8-13 Revisão de segurança de F8 concluída.
- [ ] C-F8-14 Ferramentas de `claude-home/bin` em `scripts/harness/`; testes verdes.
- [ ] C-F8-15 `claude-home/docs` em `docs/harness/`; ligações internas válidas.
- [ ] C-F8-16 Pendência P-4 fechada: origem e licença das skills de terceiros no `NOTICE`.

## F9. Terceiros

- [ ] C-F9-01 `lsp` embutida a partir do pi-lsp 0.1.7 remendado; testes verdes; `lsp.json` em `~/.nycode/agent/`.
- [ ] C-F9-02 `ponytail` e `ralph-loop` em fork próprio com o patch como commit; proposta ao autor aberta.
- [ ] C-F9-03 `pr-review-toolkit` e `claude-red` instaláveis por SHA fixo.
- [ ] C-F9-04 Comandos que dependem de pacote opcional marcados `(optional)`.
- [ ] C-F9-05 `third-party.json` e `patches/third-party/` removidos de `import/`; `NOTICE` atualizado.

## F10. Paridade final e nova linha de base

- [ ] C-F10-01 Gate completo do braço `nycode` contra a referência. Prova: veredito.
- [ ] C-F10-02 `pi-vanilla` e `cc-vanilla` medidos uma vez (D-14).
- [ ] C-F10-03 As 11 dimensões com medida ou marcadas "sem medida".
- [ ] C-F10-04 Relatório de paridade em `evidencias/F10-paridade.md`, perdas ao lado dos ganhos.
- [ ] C-F10-05 `docs/bench/baseline-main/` regravado por PR.
- [ ] C-F10-06 Segunda sincronização com o upstream feita e medida (critério global 7).
- [ ] C-F10-07 Todos os testes do ny-pi com equivalente verde ou justificativa no mapa (critério global 3).
- [ ] C-F10-08 Busca do critério global 2 vazia.

## F11. Distribuição

- [ ] C-F11-01 Workflow de publicação com `id-token: write`, executor hospedado, sem token.
- [ ] C-F11-02 Publicador confiável configurado para cada pacote; primeira publicação em até 2 dias.
- [ ] C-F11-03 `2.0.0` publicada com proveniência. Prova: `npm view @nycode/coding-agent dist.attestations`.
- [ ] C-F11-04 Tokens proibidos nos pacotes.
- [ ] C-F11-05 Instalação limpa em contêiner: `npm install -g --ignore-scripts @nycode/coding-agent` e teste de fumaça.
- [ ] C-F11-06 Binários e Nix decididos e, se mantidos, com workflow.
- [ ] C-F11-07 Aviso de versão e autoatualização consultam o registro do nycode (D-12).
- [ ] C-F11-08 README com instruções de instalação do nycode; números só de medição do braço `nycode`.
- [ ] C-F11-09 Skill `release.md` reescrita (P-7).
- [ ] C-F11-10 `install.sh`, `publish.list`, `npm/` removidos de `import/`.

## F12. Corte e descomissionamento

- [ ] C-F12-01 `nycode migrate from-pi` executado na máquina do dono; cópia de segurança guardada.
- [ ] C-F12-02 Período de convivência cumprido pelo critério de [10](10-riscos-e-rollback.md).
- [ ] C-F12-03 Unidades systemd do benchmark apontam para o nycode.
- [ ] C-F12-04 `marcioazam/ny-pi` com aviso no README e arquivado (D-22, com autorização).
- [ ] C-F12-05 `import/ny-pi/` vazio e removido.
- [ ] C-F12-06 `rg -n "ny-pi|pi-harness"` no nycode só em `docs/`, `NOTICE` e registros de mudança.
- [ ] C-F12-07 Os 8 critérios globais de aceite do [mega plano](00-mega-plano.md#8-criterios-globais-de-aceite) conferidos.
- [ ] C-F12-08 Conhecimento reutilizável capturado; memória do agente atualizada (o `pi` do dia a dia passa a ser `nycode`).

## Contagem

| Fase | Itens |
|---|---:|
| F0 | 15 |
| F1 | 7 |
| F2 | 20 |
| F3 | 14 |
| F4 | 9 |
| F5 | 29 |
| F6 | 17 |
| F7 | 28 |
| F8 | 16 |
| F9 | 5 |
| F10 | 8 |
| F11 | 10 |
| F12 | 8 |
| **Total** | **186** |
