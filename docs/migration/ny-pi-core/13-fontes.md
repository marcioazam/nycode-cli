# Fontes e evidências

De onde vem cada fato do plano. Regra: fato local tem comando reexecutável; fato externo tem URL primária lida na
data indicada, ou está marcado como não verificado.

## 1. Fatos locais (coleta de 2026-11-20)

| Fato | Comando | Resultado |
|---|---|---|
| Commit da origem | `git -C ~/source/ny-pi rev-parse origin/main` | `e4f8729` |
| Commit do destino | `git -C ~/source/nycode-cli rev-parse origin/main` | `fb05db936` |
| Arquivos rastreados na origem | `git -C ~/source/ny-pi ls-tree -r --name-only origin/main \| wc -l` | 1485 |
| Mapa cobre todos os arquivos | `python3 anexos/gerar-mapa.py < lista; echo $?` | 0, 1485 linhas, 104 regras, todas usadas |
| Destino é o fork do pi | `git log --oneline -8 origin/main` | `4ecc500eb feat: importa o pi (earendil-works/pi@073b0ba) com histórico`, `f523ebd25 feat: renomeia o fork do pi para nycode` |
| Versão do fork | `npm view @earendil-works/pi-coding-agent version` e `packages/*/package.json` | 1.6.0 |
| pi-code | `npm view pi-code version license repository.url` | 1.10.1 (a mais nova), MIT, `github.com/ilovepixelart/pi-code`; instalada: 1.7.0 |
| pi-code instalado | `find ~/.pi/agent/npm/node_modules/pi-code/extensions -type f \| wc -l` | 159 arquivos |
| Extensões embutidas do fork | `packages/coding-agent/src/extensions/index.ts:8-13` | `llama.cpp`, `codemode`, `tool-search`, `mcp` |
| Costura K1 | `rg -n "messages\.every" packages/coding-agent/src/core/sdk.ts` | linha 370 |
| Costura K2 | `rg -n STDIN_CLOSE_GRACE_MS packages/mcp/src/transports/stdio.ts` | linha 10, valor 500 |
| Escopo npm (D-17: descartado) | `npm view @nycode/coding-agent version` | 404 em 2026-11-20; o plano não usa mais o npm |
| Arquivos acima de 800 linhas no fork | `git ls-files 'packages/*/src/**/*.ts' \| xargs wc -l \| awk '$1>800'` | 50 de 939 |
| Ruleset da origem | `gh api repos/marcioazam/ny-pi/rulesets/27240802` | [anexo D](anexos/D-regras-github-brutas.md), seção 2 |
| Proteção do destino | `gh api repos/marcioazam/nycode/branches/main/protection` | anexo D, seção 3 |
| Alertas de secret scanning do destino | `gh api 'repos/marcioazam/nycode/secret-scanning/alerts?state=open'` | 8 |
| CodeQL do destino | `gh api repos/marcioazam/nycode/code-scanning/default-setup` | `configured`, `actions` e `rust` |
| Logo | `git -C ~/source/nycode-cli show 9ea437bf7:docs/assets/nycode-pixel.svg \| sha256sum` | `7269f242…a9dd2` ([anexo C](anexos/C-logo-historico.md)) |
| Ferramentas | `git --version`; `command -v git-filter-repo`; `git merge -h \| grep unrelated` | git 2.53.0; filter-repo instalado; `--allow-unrelated-histories` existe |

## 2. Fontes externas lidas

| Assunto | Fonte | Data da fonte | O que sustenta | Usado em |
|---|---|---|---|---|
| ~~Publicação confiável no npm~~ (superada pela D-17; ver a linha seguinte) | <https://docs.npmjs.com/trusted-publishers/> | 2026-10-06 | npm CLI 11.5.1 ou mais novo e Node 22.14.0 ou mais novo; executor hospedado pelo GitHub; permissão `id-token: write`; proveniência automática para repositório e pacote públicos; primeira publicação em até 2 dias depois de configurar; opção de proibir tokens | [07](07-ci-qualidade-seguranca.md), F11 |
| Atestação de proveniência de binários (F11) | <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations> e <https://github.com/actions/attest-build-provenance> | 2026-11-21 | `actions/attest` (v4.2.2) com `id-token: write`, `attestations: write`, `contents: read` e `subject-path`; `gh attestation verify <arquivo> -R <dono>/<repo>`; `actions/attest-build-provenance` é só um invólucro desde a v4 | [06](06-guia-de-execucao.md#f11), [07](07-ci-qualidade-seguranca.md) §6.5 |
| Rulesets | <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets> | sem data | Vários rulesets por ramo; a versão mais restritiva vale; convivem com a proteção clássica | [04](04-regras-do-repositorio.md) |
| API de rulesets | <https://docs.github.com/en/rest/repos/rules> | sem data | `GET` e `POST /repos/{owner}/{repo}/rulesets`; `bypass_mode` | 04 |
| Espera do Dependabot | <https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference> | sem data | `cooldown.default-days`; não vale para atualização de segurança | 04, 07 |
| Atestação de build | <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating> | sem data | Build e atestação em workflow reutilizável; permissões `attestations: write`, `id-token: write` | 07 |
| Scorecard | <https://github.com/ossf/scorecard/blob/main/docs/checks.md> | sem data | Nome e risco de 10 verificações (leitura parcial) | 07 |
| `git filter-repo` | <https://raw.githubusercontent.com/newren/git-filter-repo/main/Documentation/git-filter-repo.txt> | sem data | `--to-subdirectory-filter` para preparar a fusão com outro repositório; exige clone novo | D-03, F1 |
| Mudança paralela | <https://martinfowler.com/bliki/ParallelChange.html> | 2014-05-13 | Expandir, migrar, contrair | Princípios |
| Ramo por abstração | <https://martinfowler.com/bliki/BranchByAbstraction.html> | 2014-01-07 | Trocar o fornecedor atrás de uma abstração estável (aqui, a `ExtensionAPI`) | D-01 |
| Figueira estranguladora | <https://martinfowler.com/bliki/StranglerFigApplication.html> | 2024-08-22 | Modernização gradual, peça a peça | Princípios |
| Avaliação de agentes | <https://www.anthropic.com/research/demystifying-evals-for-ai-agents> | 2026-01-09 | Avaliar o resultado e não o caminho; `pass^k`; avaliação de regressão perto de 100% | [09](09-paridade-e-benchmark.md) |

## 3. Afirmações externas não verificadas

A pesquisa de 2026-11-20 esgotou o orçamento de consultas antes de abrir estas fontes. O plano não depende delas
para nenhuma decisão; onde aparecem, estão marcadas.

| Afirmação | Situação | Onde afetaria |
|---|---|---|
| Política de sincronização de forks grandes (VSCodium, Brave, Edge, Cursor) | Só trechos de busca, nenhuma fonte primária aberta | D-07. A escolha se apoia no comportamento do git, não nessas fontes |
| `git subtree` contra `filter-repo` | A página do `git-subtree` devolveu 404; comparação feita por conhecimento próprio | D-03 |
| Tokens clássicos do npm revogados em 2025-12-09 | Só trecho do changelog do GitHub | F11 |
| `npm trust` exige npm 11.15.0 | Não aberta | F11 |
| Fila de merge exige o gatilho `merge_group` nos workflows | Dois provedores concordam por trecho; página não aberta. Os workflows do ny-pi já têm o gatilho | 07 |
| Nível SLSA obtido com `attest-build-provenance` | A página lida não afirma o nível | 07 |
| zizmor, harden-runner, `min-release-age` do npm | Páginas não abertas; o ny-pi já usa os dois primeiros | 07 |
| Testes de equivalência (TOST), barras de erro pareadas | Não abertas; a regra de decisão usada é a do `bench/gate.py` | 09 |
| Prazo para despublicar um pacote no npm | Não verificado | [10](10-riscos-e-rollback.md) |

O provedor de busca Exa respondeu 402 (créditos esgotados) nas duas tentativas.

## 4. Documentos internos reutilizados

| Documento | Onde | Uso no plano |
|---|---|---|
| Registro do fork | `docs/fork/2026-11-20-fork-do-pi.md` (destino) | Regras do renome, exceções, linha de base, riscos |
| Especificação 0005 (escopo do núcleo) | `docs/specs/0005-core-scope.md` (origem) | Classe `core`, `ui`, `optional` de cada peça |
| Especificação 0001 (publicação) | `docs/specs/0001-publish-harness.md` (origem) | O que `publish.list` garantia |
| Runbook do benchmark | `docs/bench/RUNBOOK.md` (origem) | Gate, linha de base, verificador `bench-pr` |
| CI local | `docs/ci-local.md` (origem) | Quando o remoto não roda |
| `AGENTS.md`, `CONTRIBUTING.md` | destino | Regras do upstream a reconciliar |
