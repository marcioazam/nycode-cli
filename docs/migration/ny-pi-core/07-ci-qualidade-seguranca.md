# CI, qualidade e segurança

Como os gates de CI do ny-pi e os do nycode viram um conjunto só em F3
([00](00-mega-plano.md#f3-ci-unificado-gates-e-benchmark)).
Decisões citadas como D-nn e pendências P-n: [11](11-decisoes-e-pendencias.md). Caminhos de destino: seção 2 de
[02](02-arquitetura-alvo.md). Benchmark e o check `bench-pr`: [09](09-paridade-e-benchmark.md).

Convenções: "ny-pi" são fatos de `origin/main` de `marcioazam/ny-pi` (levantamento de 2026-11-20, `e4f8729`);
"nycode" são fatos do worktree de migração (`fb05db936`). Texto marcado **proposta** não existe em nenhum dos dois
repositórios; **não verificado** é o que não pôde ser conferido nos arquivos. Nada deste documento foi executado.

## 1. Quadro atual lado a lado

### 1.1 Workflows

- **Arquivos em `.github/workflows/`**. ny-pi: `ci-static`, `ci-security`, `instruction-budget`, `codeql`, `scorecard`.
  nycode: `ci.yml`, `npm-audit.yml`.
- **Outros arquivos de regra**. ny-pi: `zizmor.yml`, `dependabot.yml`, `CODEOWNERS`, `rulesets/main.json`,
  `release.yml`. nycode: nenhum.
- **Check de benchmark**. ny-pi: `bench-pr`: commit status publicado por um poster local, sem workflow. nycode: não
  existe.
- **`merge_group`**. ny-pi: sim, em `ci-static`, `ci-security` e `instruction-budget`. nycode: não (`ci.yml`, bloco
  `on:`).
- **`permissions` de topo**. ny-pi: `permissions: {}` em todos (a política de `run-security.sh` exige). nycode: ausente
  em `ci.yml`; `contents: read` em `npm-audit.yml`.
- **Runner**. ny-pi: `ubuntu-24.04`. nycode: `ubuntu-latest`.
- **`harden-runner`**. ny-pi: sim, com `egress-policy: block` e lista de destinos. nycode: não.
- **Ações fixadas por SHA**. ny-pi: sim. nycode: sim (checkout `3d3c42e`, setup-node `8207627`).

### 1.2 Jobs e checks

- **ny-pi `ci-static`**. Gatilhos: `pull_request`, `merge_group`, push em main. Job: `ci-static` (30 min). Nome do
  check: `ci-static`. O que roda: `run-static.sh`.
- **ny-pi `ci-static`**. Gatilhos: idem. Job: `mutation` (45 min). Nome do check: `ci-mutation`. O que roda:
  `run-static.sh mutation`.
- **ny-pi `ci-security`**. Gatilhos: idem. Job: `ci-security` (30 min). Nome do check: `ci-security`. O que roda:
  `run-security.sh`.
- **ny-pi `instruction-budget`**. Gatilhos: PR (`labeled`, `unlabeled` incluídos), `merge_group`, push. Job:
  `instruction-budget` (5 min). Nome do check: `instruction-budget`. O que roda: `instruction_budget.py check`.
- **ny-pi `codeql`**. Gatilhos: push e PR em main, cron `41 6 * * 3`, manual. Job: `analyze` (30 min). Nome do check:
  `Analyze (python)`, `(javascript-typescript)`, `(actions)`. O que roda: CodeQL, `build-mode: none`.
- **ny-pi `scorecard`**. Gatilhos: push em main, cron `23 9 * * 1`, manual. Job: `analysis` (15 min). Nome do check:
  `Scorecard analysis`. O que roda: `ossf/scorecard-action` e envio do SARIF.
- **ny-pi (local)**. Gatilhos: poll de 10 min na máquina do dono. Job: `bench-pr.sh`. Nome do check: `bench-pr`. O que
  roda: gate do benchmark (seções 3 e 5 de 09).
- **nycode `ci.yml`**. Gatilhos: push em main, tags `v*.*.*`, PR em main. Job: `build-check`. Nome do check:
  `build-check`. O que roda: `npm ci --ignore-scripts`, `build`, `check`, changelog.
- **nycode `ci.yml`**. Gatilhos: idem. Job: `test` (matriz). Nome do check: `test (coding-agent)`, `(durable)`,
  `(chord)`, `(other)`. O que roda: `npm run test` por pacote.
- **nycode `ci.yml`**. Gatilhos: idem. Job: `mcp-conformance`. Nome do check: `mcp-conformance`. O que roda: `npm run
  test:mcp-conformance`.
- **nycode `npm-audit.yml`**. Gatilhos: cron `37 7 * * *`, manual. Job: `audit`. Nome do check: `audit`. O que roda:
  `scripts/npm-audit.mjs` e `npm audit signatures`.

Fontes: `.github/workflows/*.yml` nos dois repositórios; os 6 contextos obrigatórios do nycode e os 4 do ny-pi
vêm do [anexo D](anexos/D-regras-github-brutas.md) (seções 2 e 3). Observações verificadas:

- O `ci-mutation` do ny-pi é o segundo job de `ci-static.yml`, não um workflow à parte; não é check obrigatório.
- `concurrency` do ny-pi: grupo `<workflow>-${{ github.ref }}` e `cancel-in-progress` só em `pull_request`. No nycode:
  `ci-${{ github.ref }}` com cancelamento sempre, inclusive em push na main e em tag (`ci.yml`, bloco `concurrency:`).
- O `build-check` do nycode só roda o check de changelog se houver uma tag `v*.*.*`; sem tag ele é pulado (P-6 pede a
  tag `v1.6.0-base` em F0).
- O Node do `ci-static` do ny-pi é 24; o do nycode é 22, e o `package.json` do nycode declara `engines.node >=22.19.0`.
  A versão de Node do CI unificado fica **não verificada** (decidir em F3 com `npm run check` e `./test.sh`).
- `npm run check` começa por `node scripts/biome-check.mjs --write` (`package.json:20`): em CI isso reescreve arquivos
  em vez de reprovar formatação. **Proposta:** o job `build-check` roda uma variante sem `--write`; o `check` local
  continua com `--write`.

## 2. Conjunto alvo

### 2.1 Checks obrigatórios (D-05)

União dos dois conjuntos: 10 contextos no ruleset `main` do nycode (substituem os 6 da proteção clássica e os 4 do
ruleset do ny-pi). Todos rodam também em `merge_group`.

| # | Contexto | Origem | Workflow alvo |
|---|---|---|---|
| 1 | `build-check` | nycode | `ci.yml` |
| 2 | `test (coding-agent)` | nycode | `ci.yml` |
| 3 | `test (durable)` | nycode | `ci.yml` |
| 4 | `test (chord)` | nycode | `ci.yml` |
| 5 | `test (other)` | nycode | `ci.yml` |
| 6 | `mcp-conformance` | nycode | `ci.yml` |
| 7 | `ci-static` | ny-pi | `ci-static.yml` |
| 8 | `ci-security` | ny-pi | `ci-security.yml` |
| 9 | `instruction-budget` | ny-pi | `instruction-budget.yml` |
| 10 | `bench-pr` | ny-pi | status local (D-21 decide quando ele pula) |

O ruleset também mantém `strict_required_status_checks_policy: true` (ramo atualizado antes do merge), como no
`rulesets/main.json` do ny-pi. O contexto `bench-pr` não leva `integration_id`, porque o status vem de `gh api` e não
de um app (RUNBOOK, "Tornar `bench-pr` obrigatório"). Um check obrigatório que nunca é publicado trava o PR: nenhum dos
workflows acima pode usar filtro de caminho (`paths:`).

### 2.2 Checks não obrigatórios

- **`ci-mutation`**. Gatilhos: PR e `merge_group` (job do `ci-static.yml`). Papel: Informativo: mutação dos `.py`
  alterados (seção 5.3).
- **`Analyze (javascript-typescript)`, `(python)`, `(actions)`**. Gatilhos: push, PR, cron semanal, manual. Papel:
  CodeQL avançado (D-20); o run em PR existe para o SAST do Scorecard.
- **`Scorecard analysis`**. Gatilhos: push em main, cron semanal, manual. Papel: Nunca em `pull_request`; sobe SARIF.
- **`audit` (npm audit diário)**. Gatilhos: cron `37 7 * * *`, manual. Papel: Vulnerabilidade de produção e assinaturas
  de registro.
- **`merge-policy`**. Gatilhos: push em main. Papel: Auditoria de merge commit (D-07, seção 8).

### 2.3 Gatilhos, permissões e concorrência por workflow

Regra única (o `run-security.sh` do ny-pi já a impõe em `check_workflow_policy`): `permissions: {}` no topo de todo
workflow, permissões declaradas por job, nenhum `pull_request_target` nem `workflow_run`.

- **`ci.yml`**. Gatilhos alvo: `pull_request`, `merge_group`, push em main, tag `v*.*.*`. Permissões por job: `contents:
  read`. Concorrência: `ci-${{ github.ref }}`, cancela só em PR.
- **`ci-static.yml`**. Gatilhos alvo: `pull_request`, `merge_group`, push em main. Permissões por job: `contents: read`.
  Concorrência: igual ao ny-pi.
- **`ci-security.yml`**. Gatilhos alvo: idem. Permissões por job: `contents: read`. Concorrência: igual ao ny-pi.
- **`instruction-budget.yml`**. Gatilhos alvo: PR com `labeled`/`unlabeled`, `merge_group`, push. Permissões por job:
  `contents: read`. Concorrência: igual ao ny-pi.
- **`codeql.yml`**. Gatilhos alvo: push, PR, cron, manual. Permissões por job: `contents: read`, `actions: read`,
  `security-events: write`. Concorrência: `cancel-in-progress: false`.
- **`scorecard.yml`**. Gatilhos alvo: push em main, cron, manual. Permissões por job: acima, mais `id-token: write`.
  Concorrência: `cancel-in-progress: false`.
- **`npm-audit.yml`**. Gatilhos alvo: cron, manual. Permissões por job: `contents: read`. Concorrência: sem.
- **`merge-policy.yml`**. Gatilhos alvo: push em main. Permissões por job: `contents: read`, `issues: write`
  (**proposta**). Concorrência: `cancel-in-progress: false`.
- **publicação (F11)**. Gatilhos alvo: tag `v*.*.*`. Permissões por job: `contents: read`, `id-token: write` (seção
  6.5). Concorrência: sem cancelamento.

Pontos que o nycode precisa mudar em `ci.yml` e `npm-audit.yml` para passar na política acima: adicionar
`permissions: {}` no topo e por job, adicionar `merge_group`, trocar `cancel-in-progress: true` por
`${{ github.event_name == 'pull_request' }}` (um push em main ou uma tag não deve ser cancelado por outro) e fixar o
runner em `ubuntu-24.04`. Os `harden-runner` com lista de destinos entram por job; a lista do `build-check` e do `test`
(registro npm, `github.com`, `apt` para `fd-find` e `ripgrep`) fica **não verificada** até um run em modo `audit`.

### 2.4 Ordem barato para caro

Os jobs são independentes e rodam em paralelo no GitHub; "ordem" vale para três lugares:

1. Dentro de cada script: o autoteste do verificador roda primeiro (`run-static.sh` roda o `pytest scripts/ci` antes de
   tudo, porque um checador quebrado não pode atestar o repositório) e as etapas rodam todas, acumulando falhas.
2. No `local.sh` (seção 7): hoje roda `ci-static` (46 s), `ci-security` (14 s) e `instruction-budget` (menos de 1 s),
   tempos medidos em 2026-11-15 (`docs/ci-local.md`). **Proposta:** a ordem passa a ser `instruction-budget`,
   `ci-security`, `ci-static`, `build-check`, `test`, para falhar cedo. Tempos do nycode **não verificados**.
3. No `bench-pr`: **proposta**, o poster só inicia uma rodada depois de `ci-static`, `ci-security` e `build-check`
   estarem verdes no head. Hoje o `bench-pr.sh` não consulta os outros checks (`bench/tools/bench-pr.sh`), então um PR
   que reprova em segundos ainda gasta US$ da rodada.

## 3. Adaptação dos scripts aos caminhos de destino

Destinos da seção 2 de [02](02-arquitetura-alvo.md): `scripts/ci/` (com `lint/`), `scripts/harness/` (ferramentas de
`claude-home/bin`), `packages/coding-agent/resources/{skills,agents,hooks,...}`,
`packages/coding-agent/src/extensions/`, `packages/coding-agent/test/harness/`, `bench/` e `docs/specs/`.

Legenda: **igual** (sem mudança além de nome), **caminho** (muda de→para), **absorvida** (passa a ser parte de
`npm run check` ou do `test.sh`), **some**.

### 3.1 `scripts/ci/run-static.sh`

- **0**. Etapa (nome no script): autoteste `pytest scripts/ci`. Destino: igual. O que muda: nenhuma.
- **1**. Etapa (nome no script): `install harness (runner HOME)`. Destino: some. O que muda: exigia `install.sh --link
  --apply`; o instalador sai (02, seção 8).
- **2**. Etapa (nome no script): `skill-lint`. Destino: caminho. O que muda: `claude-home/skills` para
  `packages/coding-agent/resources/skills`.
- **3**. Etapa (nome no script): `ruff check` e `ruff format` (alterados). Destino: igual. O que muda: `.py` de
  `bench/`, `scripts/` e `resources/hooks/`; `apps/` fora (D-23).
- **4**. Etapa (nome no script): `mypy --strict` (alterados). Destino: igual. O que muda: nenhuma.
- **5**. Etapa (nome no script): `biome (changed extensions ts)`. Destino: absorvida. O que muda: o Biome do fork
  (tabulação, 120) em `npm run check`; o do ny-pi some (D-06).
- **6**. Etapa (nome no script): `shellcheck -x` (alterados). Destino: igual. O que muda: nenhuma.
- **7**. Etapa (nome no script): `shfmt -i 2 -d` (alterados). Destino: igual. O que muda: nenhuma.
- **8**. Etapa (nome no script): `markdownlint` (alterados). Destino: igual. O que muda: `scripts/ci/markdownlint.jsonc`
  desliga MD013 (linhas longas).
- **9**. Etapa (nome no script): `structure (changed)`. Destino: caminho. O que muda: seção 3.5.
- **10**. Etapa (nome no script): `install tests (offline)`. Destino: some. O que muda: `scripts/test_install.sh` sai
  (02, seção 8; D-06).
- **11**. Etapa (nome no script): `check-refs`. Destino: caminho. O que muda: seção 3.6.
- **12**. Etapa (nome no script): `core-scope`. Destino: caminho. O que muda: seção 3.3.
- **13**. Etapa (nome no script): `pi-code patch stack`. Destino: some. O que muda: `check-patch-stack.sh` sai (02,
  seção 8).
- **14**. Etapa (nome no script): `bench oracles`. Destino: igual. O que muda: `bench/suites/check_oracles.py` mantém o
  caminho.
- **15**. Etapa (nome no script): `pytest + coverage`. Destino: caminho. O que muda: seção 5.1.
- **16**. Etapa (nome no script): `diff-cover >= 80`. Destino: igual. O que muda: seção 5.1.
- **17**. Etapa (nome no script): `node tests`. Destino: absorvida. O que muda: `node --test` dos `extensions/*.test.ts`
  vira vitest (seção 5.2 e [09](09-paridade-e-benchmark.md)).
- **18**. Etapa (nome no script): `harness checks (informational)`. Destino: some até haver equivalente. O que muda: lia
  o `pi` instalado; **proposta:** não portar.

A tabela tem 19 linhas (0 a 18): o autoteste inicial, que não usa `step`, e 18 linhas para as 19 chamadas a `step`,
porque a linha 3 junta `ruff check` e `ruff format`. A etapa 5 do ny-pi só olhava
`extensions/*.ts`; no nycode o `npm run check` cobre os `packages/*/src`, `packages/*/test` e exemplos (lista
`files.includes` de `biome.json`).

O `mutation` (`run-static.sh mutation`) é o outro modo do script: seção 5.3.

### 3.2 `scripts/ci/run-security.sh`

- **1**. Etapa: autoteste de pins e permissões. Destino: igual. O que muda: nenhuma.
- **2**. Etapa: `SHA pins + permissions + no pull_request_target`. Destino: igual. O que muda: `WORKFLOW_DIR` continua
  `.github`; `ci.yml` e `npm-audit.yml` hoje reprovariam (seção 2.3).
- **3**. Etapa: `actionlint`. Destino: igual. O que muda: binário fixado por `install-tools.sh`.
- **4**. Etapa: `zizmor --offline --min-severity medium`. Destino: igual. O que muda: `.github/zizmor.yml` (política
  `hash-pin`) vai junto.
- **5**. Etapa: `gitleaks + trufflehog (check-leaks)`. Destino: caminho. O que muda: seção 3.7.
- **6**. Etapa: `trufflehog history --only-verified`. Destino: caminho. O que muda: `--exclude-paths` cita
  `atualizador/...`, que não existe no nycode; trocar pelo mapa de fixtures.
- **7**. Etapa: `semgrep --error`. Destino: igual. O que muda: imagem por digest (seção 6.2); `--exclude
  scripts/fixtures/leak`.
- **8**. Etapa: `osv-scanner`. Destino: caminho. O que muda: lockfiles do nycode (seção 6.3);
  `scripts/ci/osv-scanner.toml`.

São 8 chamadas a `step`; a primeira é o autoteste (também acessível por `--selftest`). Em CI o `PI_HARNESS_IDENTIFIERS`
aponta para um arquivo
vazio (`run-security.sh`, função `leaks`); no nycode a variável vira `NYCODE_HARNESS_IDENTIFIERS` (D-09 proíbe ler
`PI_*` em tempo de execução, mas o script é ferramenta do repositório, como `BENCH_*`; decisão de nome **proposta**).

### 3.3 `scripts/ci/lint/core_scope.py` e `skill_lint.py`

- **`core_scope.py`**. Fica igual: Marcadores `<!-- core-scope:begin/end -->`, classes `core`/`ui`/`optional`/`remove`,
  saída 0/1/2. Muda: Descoberta de peças: `claude-home/skills` e `claude-home/agents` para `resources/skills` e
  `resources/agents`; `extensions` para `packages/coding-agent/src/extensions`.
- **`core_scope.py` (spec)**. Fica igual: `docs/specs/0005-core-scope.md` mantém o caminho (02, seção 2). Muda: A tabela
  de classes está em P-1 (97 linhas, F0).
- **`skill_lint.py`**. Fica igual: Regras: nome kebab-case igual ao diretório, descrição de 20 a 1024 caracteres, no
  máximo 500 linhas, sem segredo óbvio; falha se não achar skill. Muda: Diretório padrão `claude-home/skills` para
  `packages/coding-agent/resources/skills`.

### 3.4 `instruction_budget.py` e a linha de base

- **Fontes contadas**. ny-pi: `claude-home/CLAUDE.md`, `claude-home/rules/*.md`, `name` e `description` de cada
  `SKILL.md` e agente. nycode alvo: `resources/instructions/*.md`, `resources/rules/*.md` e o frontmatter de
  `resources/skills` e `resources/agents` (02, seção 6).
- **Estimador**. ny-pi: `ceil(bytes_utf8/3.5)`. nycode alvo: igual.
- **Falha**. ny-pi: total acima do baseline, exit 1; rótulo `budget-increase` libera; exit 2 entrada inválida. nycode
  alvo: igual.
- **Linha de base**. ny-pi: `scripts/ci/instruction_budget.baseline.json` (versão 1). nycode alvo: mesmo caminho,
  **regravada** com `update` depois do corte de F8.

02 (seção 6) torna o orçamento obrigatório e diz que o texto sempre carregado não pode crescer com a mudança de lugar.
Como as instruções passam a vir de `contract.md`, `headless.md` e `lite.md` (e não de `CLAUDE.md`), o primeiro baseline
do nycode **só vale depois** da cópia byte a byte das instruções: o total do baseline atual do ny-pi **não foi lido**.
O rótulo `budget-increase` é lido de `GITHUB_EVENT_PATH`, por isso o workflow escuta `labeled` e `unlabeled`.

### 3.5 `structure_changed.py` e a lista de base do upstream (D-06)

O script falha em PR quando um arquivo de código alterado passa de 800 linhas ou um diretório com arquivo alterado
passa de 7 arquivos de código; o legado não alterado nunca bloqueia. Para o nycode:

- **Fonte da lista de sufixos de código**. De: `claude-home/bin/structure/structure.py`. Para:
  `scripts/ci/lint/structure/structure.py` (anexo E, regra C09; F10 converteu; a proposta de `scripts/harness/` caiu: as instruções
  embarcadas já citavam este caminho). `structure_changed.py` carrega a lista daí e mantém `DEFAULT_SUFFIXES` como cópia,
  fixada por teste.
- **Alcance do limite (D-06)**. De: todo arquivo alterado. Para: só arquivos criados pelo nycode (lista em 02, seção 9).
- **Lista de base do upstream**. De: não existe. Para: `scripts/ci/lint/structure-upstream.txt`: arquivo do upstream
  alterado fica isento.
- **Código importado acima do limite**. De: n/a. Para: entra na lista de base no commit de cópia, sai ao ser dividido
  (02, seção 9).
- **`bench/suites/*/*/(repo\|hidden\|oracle)/`**. De: só `ruff` olha. Para: fora do limite de estrutura (seção 4 de
  [09](09-paridade-e-benchmark.md)).

O fork tem 50 arquivos de fonte acima de 800 linhas herdados do upstream (02, seção 9). Sem a lista de base, qualquer
PR que tocasse um deles reprovaria em `structure (changed)`.

### 3.6 `check-refs.py` e `refs-allow.txt`

O script acusa skill, agente ou caminho citado por arquivo entregue que o repositório não contém; passa se o alvo
existe, se a linha é marcada `(optional)`, ou se está em `scripts/refs-allow.txt`.

- **`SCAN`**. De: `claude-home`, `extensions`, `bin`, `docs`. Para: `packages/coding-agent/resources`,
  `packages/coding-agent/src/extensions`, `scripts/harness`, `docs`.
- **`SKIP_PREFIX`**. De: `docs/specs/`, `claude-home/hooks/fixtures/`, `claude-home/patches/pi-code/orig/`. Para:
  `docs/specs/`, `resources/hooks/fixtures/`; a terceira some (patches viram fonte).
- **Marcador de caminho**. De: `$CLAUDE_CONFIG_DIR/...`, `~/.pi/agent/claude-home/...`. Para: `${NYCODE_RESOURCES}` (02,
  seção 6); a validação do marcador é **proposta**.
- **`scripts/refs-allow.txt`**. De: entradas do ny-pi. Para: revisar uma a uma; conteúdo **não lido**.

Local: o script mora em `scripts/check-refs.py` no ny-pi; em `run-static.sh` é chamado como `scripts/check-refs.py`.
Destino sugerido: `scripts/ci/check-refs.py` (**proposta**, junto dos demais verificadores; atualiza o `run-static.sh`).

### 3.7 `check-leaks.sh` e o gancho de commit

- **Modos**. ny-pi: `--tree` (padrão), `--staged FILES...`, `--history`, `--selftest`. nycode alvo: iguais.
- **Configuração gitleaks**. ny-pi: `.gitleaks.toml` e `.leak-allow`. nycode alvo: o nycode usa `.gitleaksignore`
  (fingerprints, 3 linhas lidas); os dois mecanismos coexistem até F2 (**proposta:** manter `.gitleaks.toml` e converter
  as 3 entradas).
- **trufflehog**. ny-pi: 3.99.9, sha256 verificado em `install_trufflehog`. nycode alvo: igual; vem de
  `install-tools.sh`.
- **Gancho**. ny-pi: `.githooks/pre-commit` mais `.pre-commit-config.yaml`. nycode alvo: `.husky/pre-commit` do fork
  chama `check-leaks.sh --staged` (02, seção 8).
- **Identificadores pessoais**. ny-pi: `PI_HARNESS_IDENTIFIERS` (vazio em CI). nycode alvo: variável renomeada (seção
  3.2).

O `.husky/pre-commit` do nycode hoje roda `node scripts/check-lockfile-commit.mjs`, `npm run check` e, se existir
`apps/p2`, `npm --prefix apps/p2 run check`. Os 8 alertas de secret scanning do nycode (D-16) são decisão do dono em F0;
`plan.md` aparece no `.gitleaksignore` com fingerprint `generic-api-key`.

## 4. Quadro dos scripts que não mudam de papel

- **`scripts/ci/changed-files.sh`**. Papel: lista de arquivos alterados contra `BASE_SHA`. Observação: Base: PR base,
  `merge_group.base_sha` ou `event.before`; sem isso, merge-base com `origin/main`.
- **`scripts/ci/install-tools.sh`**. Papel: instala binários por sha256. Observação: Lista no `ci-static`: shellcheck,
  shfmt, biome, rg; no `ci-security`: actionlint, gitleaks, trufflehog, osv-scanner, shellcheck, rg. O `biome` do ny-pi
  sai (D-06).
- **`scripts/ci/requirements-ci.in` e `.txt`**. Papel: pins Python com hash. Observação: `ruff==0.17.5`, `mypy==2.4.1`,
  `zizmor==1.32.0`, `diff-cover==11.0.1`, `mutmut==3.8.1`, `coverage`, `pytest`, `pyyaml`.
- **`scripts/ci/markdownlint*`**. Papel: lint de Markdown. Observação: `package-lock.json` próprio, instalado com `npm
  ci --ignore-scripts`.

Conteúdo de `install-tools.sh` não foi lido por inteiro; a lista acima vem das chamadas nos workflows.

## 5. Cobertura (D-24)

D-24: 80% por arquivo nos arquivos próprios, medida como cobertura do diff.

### 5.1 O que o `run-static.sh` faz hoje

- **Python**. O que mede: `coverage run -m pytest scripts/ claude-home/hooks claude-home/bin bench`, `source=.`,
  `include_namespace_packages`, `patch=subprocess` (mede `guard.py` rodado como processo filho), `combine`, XML; `omit`
  tira node_modules, `.git` e fixtures de `bench/suites`. Limite: `diff-cover --fail-under 80` sobre as linhas do diff
  contra `BASE_SHA`.
- **Node**. O que mede: nada: `node --test` sobre `extensions/*.test.ts` e `claude-home/bin/**/*.test.{ts,mjs}`, sem
  relatório de cobertura. Limite: nenhum.

Um gate local mede cobertura de Node: `claude-home/bin/tests/terminal-sota/gate.sh` usa `node --experimental-strip-types
--test --experimental-test-coverage` e exige 80% de linhas nos arquivos que lista. Ele não roda no CI.

Destino Python: os caminhos de `pytest` passam a `scripts packages/coding-agent/resources/hooks scripts/harness bench`.
`diff-cover` continua com as exclusões de `bench/suites`.

### 5.2 TypeScript no nycode

Fato: `vitest` `4.1.12` está em `packages/coding-agent/package.json:77`; a raiz tem `vitest.base.ts`. Nenhum
`package.json` de raiz nem de `packages/*`, `vitest.base.ts` ou `vitest*.ts` de pacote cita `coverage`. Se
`@vitest/coverage-*` está instalado em algum pacote: **não verificado** (a busca cobriu esses arquivos, não o
`package-lock.json`). Hoje, portanto, o nycode não mede cobertura.

**Proposta** (D-24 aplicado a TypeScript):

1. Cada pacote que recebe código do ny-pi roda `vitest run --coverage` com o provedor `v8`, dependência de
   desenvolvimento em versão exata (o `check:pinned-deps` exige).
2. O relatório sai em formato que o `diff-cover` leia (Cobertura XML é a aposta; a lista de formatos de `diff-cover`
   11.0.1 e o relatório `cobertura` do vitest **não foram verificados**: conferir na primeira unidade de F3).
3. `diff-cover --fail-under 80 --compare-branch=$BASE_SHA` sobre as linhas alteradas, com escopo só nos arquivos criados
   pelo nycode da seção 9 de 02 (`src/extensions/**`, `src/core/permissions/`, `src/migrations/`). Arquivos do upstream
   ficam de fora, como na lista de base de estrutura.
4. O vitest completo nunca roda direto no repositório: o `AGENTS.md:52` do fork manda usar `./test.sh`, porque a suíte
   inclui e2e que se ativam com variáveis de ambiente. O comando de cobertura passa pelo mesmo `test.sh`.
5. Onde o relatório roda: um check dentro de `test (coding-agent)`, não um check novo (D-05 não cresce).

Até a primeira medição, a cobertura TypeScript do nycode é "sem medida".

### 5.3 O que o `ci-mutation` roda

`run-static.sh mutation` percorre os `.py` alterados (menos fixtures de `bench/suites` e testes), acha um teste vizinho
(`test_<nome>.py`, `<nome>_test.py` ou `tests/test_<nome>.py`), copia o repositório para um diretório temporário e roda
`mutmut run` com `timeout 900`. Compara `killed/total` com `scripts/ci/mutmut-baseline.json` por arquivo.

- Sem linha de base para o arquivo, o resultado é informativo.
- O arquivo `mutmut-baseline.json` não aparece na listagem de `scripts/ci/` de `origin/main`, então hoje nenhum
  arquivo tem linha de base e o job só informa; o script tolera a ausência (`jq ... || true`).
- Quando o mutmut não mapeia os testes aos mutantes, o job avisa e só reprova se o arquivo constar da linha de base.
- Não há mutação para TypeScript no ny-pi nem no nycode: **sem medida**.

O job continua não obrigatório (45 min de teto) e roda em PR e `merge_group`; `local.sh --mutation` o reproduz.

## 6. Cadeia de suprimento

### 6.1 Ações, runner e varredura de workflows

- Toda `uses:` por SHA de 40 hex (ou `docker://...@sha256:`), com o número da versão em comentário. O
  `run-security.sh` reprova pin ausente (`check_pins`, linhas 27-39). Os SHAs atuais: checkout `3d3c42e`, setup-python
  `6d4fd22`, setup-node `949feb2` no ny-pi e `8207627` no nycode (versões distintas do mesmo action: unificar em F3),
  codeql-action `33d7b85` (v4.39.3), scorecard-action `fa7117d` (v2.5.0).
- `step-security/harden-runner` `1d88384` (v2.22.4), `egress-policy: block`, destinos por job.
- `actionlint` e `zizmor` (política `hash-pin` em `.github/zizmor.yml`) validam os workflows.

### 6.2 Segredos e SAST

- `gitleaks` mais `trufflehog` via `check-leaks.sh`, e `trufflehog git --only-verified` no histórico.
- `semgrep` roda pela imagem oficial fixada por digest, não pela roda PyPI: `semgrep/semgrep:1.186.0@sha256:6e1b0434...`
  (`run-security.sh`, `SEMGREP_IMAGE`). A razão registrada no script é que a roda fixa `mcp==1.29.0` e
  `opentelemetry-api~=1.37.0`, ambos com avisos abertos. A mudança é o PR #66 do ny-pi (número vindo da instrução desta
  frente; o texto do PR **não foi lido**). Regras: `p/default`, `p/python`, `p/typescript`, `p/command-injection`,
  `p/github-actions`. Com `BASE_SHA`, só acha o que é novo desde a base (`--baseline-commit`); sem ele, varre tudo.
  O job exige Docker no runner.

### 6.3 Dependências

- **Instalação**. ny-pi: `npm ci --ignore-scripts` no `install.sh` e no CI. nycode: `npm ci --ignore-scripts`
  (`ci.yml`). Alvo: igual; `.npmrc` com `save-exact=true`.
- **Versões exatas**. ny-pi: pins no `npm/package.json`. nycode: `scripts/check-pinned-deps.mjs` em `npm run check`.
  Alvo: mantém; vale também para as dependências novas das extensões.
- **Idade mínima**. ny-pi: cooldown de 7 dias no Dependabot. nycode: `.npmrc`: `min-release-age=2`, exceção
  `@earendil-works/*`. Alvo: os dois (o `.npmrc` vale para instalação; o cooldown, para o PR do Dependabot).
- **Lockfile**. ny-pi: n/a. nycode: `.husky/pre-commit` chama `check-lockfile-commit.mjs`;
  `NYCODE_ALLOW_LOCKFILE_CHANGE=1` libera. Alvo: mantém; só local (o CI falha por `npm ci` fora de sincronia).
- **Auditoria PR**. ny-pi: `osv-scanner` (CVSS >= 7 ou sem nota = falha), exceções com dono e prazo em
  `osv-scanner.toml`. nycode: nenhuma em PR. Alvo: `osv-scanner` sobre os 5 `package-lock.json`.
- **Auditoria diária**. ny-pi: n/a. nycode: `npm-audit.yml`: `scripts/npm-audit.mjs` (nível `moderate`, só produção,
  exceções em `acceptedAdvisories`, hoje `{}`) e `npm audit signatures --omit=dev`. Alvo: mantém.
- **Dependabot**. ny-pi: `github-actions` em `/` e `npm` em `/npm`, semanal, espera de 7 dias, agrupado. nycode: não
  existe. Alvo: `github-actions` em `/` e `npm` nos diretórios dos 5 lockfiles (**proposta**); mesma espera e
  agrupamento.

Lockfiles do nycode (`git ls-files`): raiz, três de `packages/coding-agent/examples/extensions/*` e
`packages/coding-agent/install-lock/`.

**Unificar `osv-scanner` e `npm-audit.mjs`** (**proposta**): os dois limites divergem (CVSS >= 7 contra `moderate`).
Manter o `osv-scanner` como gate de PR e o `npm-audit.mjs` como varredura diária, e passar a um único arquivo de
exceções (`scripts/ci/osv-scanner.toml`, com dono e prazo) lido pelos dois; hoje `acceptedAdvisories` e o `.toml` são
listas separadas. A implementação (o `.mjs` ler o `.toml`) não foi desenhada nem testada.

### 6.4 CodeQL (D-20) e Scorecard

- O nycode tem o "default setup" configurado para `actions` e `rust`, semanal ([anexo
  D](anexos/D-regras-github-brutas.md),
  seção 5). Em F3: levar `codeql.yml` do ny-pi (matriz `javascript-typescript`, `python`, `actions`,
  `build-mode: none`, `fail-fast: false`) e desligar o default setup, que ficaria preso em `rust`. Como desligar
  (interface
  ou API do GitHub) **não foi verificado**; é uma ação de escrita no repositório do dono, de responsabilidade do
  executor de F3.
- `python` continua na matriz porque o `bench/` e os `scripts/` do ny-pi entram (D-23 deixa `apps/` de fora dos gates).
- Scorecard: o workflow roda só em push na main, cron e manual; precisa de `id-token: write` para publicar. O ny-pi tem
  2 alertas abertos de Scorecard (SAST e CII-Best-Practices, anexo D, seção 5); o critério 8 de [00](00-mega-plano.md)
  pede nenhum alerta que o código possa fechar.

### 6.5 Publicação por trusted publishing (F11)

Verificado em `docs.npmjs.com/trusted-publishers` em 2026-10-06 (data da conferência desta frente, não revista):

- Exige npm CLI >= 11.5.1 e Node >= 22.14.0, runner hospedado pelo GitHub e `id-token: write`.
- A proveniência é gerada automaticamente para repositório e pacote públicos.
- A primeira publicação precisa ocorrer em até 2 dias depois de configurar o publicador confiável; depois, desabilitar
  tokens ("disallow tokens") no pacote.
- Isso casa com `engines.node >=22.19.0` do nycode. O escopo npm depende de D-17 (organização `@nycode` ou
  `@marcioazam` com prefixo `nycode-`), que aguarda o dono.

`actions/attest-build-provenance` entra como passo adicional do job de publicação. O nível SLSA que ele atende:
**não verificado**; o documento não alega nível SLSA. O fluxo de publicação (`scripts/publish.mjs`, `release.mjs`,
`release-packages.mjs` existem em `scripts/` do nycode) é assunto de F11 e não foi lido aqui.

## 7. CI local (`docs/ci-local.md`, `scripts/ci/local.sh`)

O `local.sh` do ny-pi roda `ci-static`, `ci-security` e `instruction-budget` com os mesmos scripts, binários fixados e
pacotes Python com hash, num `HOME` descartável (`--mutation` acrescenta `ci-mutation`). Limite de 900 s para o conjunto
(`CI_LOCAL_MAX_S`), cache em `~/.cache/ny-pi-ci`, base em `BASE_SHA` (padrão `origin/main`), saída 0/1/124. `--post`
publica cada gate como commit status no HEAD, exigindo árvore limpa e HEAD já publicado (exit 2 se não).

No nycode o script ganha dois gates:

- **`build-check`**. Comando: `npm ci --ignore-scripts && npm run build && npm run check`. Observação: O `check` local
  mantém `--write`.
- **`test`**. Comando: `./test.sh`. Observação: `test.sh` roda `npm test` com `env -i` e um `HOME` isolado
  (`NYCODE_NO_LOCAL_LLM=1`, `AWS_EC2_METADATA_DISABLED=true`).

`./test.sh` roda todas as suítes de uma vez; o CI particiona em `coding-agent`, `durable`, `chord` e `other`. Os
contextos de `--post` seguem os do CI (`test (coding-agent)` etc.) só se o script também particionar; **proposta:** o
local publica um único `test` e o ruleset aceita o contexto local só em contingência (ver abaixo).

Mudanças de nome: cache `~/.cache/nycode-ci` (**proposta**), `BENCH_REPO` do `--post` aponta para o nycode. O limite de
900 s pode não caber build mais testes do nycode: **não medido**.

### 7.1 Regra "verificar uma vez antes do commit"

Do contrato de trabalho (`claude-home/CLAUDE.md`, seção Verification): durante o trabalho só se lê e edita; checks que
não compilam nada e terminam em segundos (formatador nos arquivos editados, `lsp_diagnostics`) são livres. Antes do
commit roda-se a verificação completa **uma vez**: build, gates do repositório, cobertura e toda suíte que os workflows
rodam. Falhou, corrige, repete só o que falhou e fecha com o gate final no head exato. No nycode isto se traduz, de
acordo com `AGENTS.md:44-52`:

1. `npm run check` (saída completa; não roda testes) depois de mudar código.
2. `./test.sh` na raiz para todos os testes que não são e2e; `npm run build` quando algo precisa de `dist/`.
3. `scripts/ci/local.sh` uma vez, no head final, antes do commit; commit só quando o usuário pedir (`AGENTS.md:59`).

O local não prova o CI remoto, nem o `bench-pr`, nem estado de produção.

### 7.2 Contingência sem CI remoto

`docs/ci-local.md` do ny-pi (decisão de 2026-11-15) descreve usar `local.sh --mutation --post` quando o remoto não
roda por cobrança. Ela vale só com a autorização permanente que o dono registrou; um check remoto vermelho não é coberto
por status local verde, e o caminho de desligar workflows **não foi exercitado** com falha real. O doc migra para
`docs/ci-local.md` do nycode com os nomes novos. Nunca `--admin` nem desligar a proteção.

## 8. Job `merge-policy` (D-07)

Regra: em cada push na `main`, para cada merge commit novo, o segundo pai tem de ser ancestral de `upstream/main` de
`earendil-works/pi`. Se não for, o job falha e abre uma issue. Squash não gera merge commit, então o job é inerte para o
fluxo normal. A fusão da importação (D-03) é um merge commit anterior ao ruleset de F3 e fica fora do intervalo
verificado (`before..sha`).

Esboço (**proposta**, não executado; `issues: write` é a única permissão além de leitura):

```yaml
name: merge-policy
on:
  push:
    branches: [main]
permissions: {}
concurrency:
  group: merge-policy-${{ github.ref }}
  cancel-in-progress: false
jobs:
  merge-policy:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Audit new merge commits
        env:
          BEFORE: ${{ github.event.before }}
          AFTER: ${{ github.sha }}
          GH_TOKEN: ${{ github.token }}
        run: |
          git fetch --no-tags https://github.com/earendil-works/pi.git main:refs/remotes/upstream/main
          bad=()
          range="$BEFORE..$AFTER"
          [ "$BEFORE" = 0000000000000000000000000000000000000000 ] && range="$AFTER"
          for m in $(git rev-list --merges "$range"); do
            git merge-base --is-ancestor "$m^2" upstream/main || bad+=("$m")
          done
          [ "${#bad[@]}" -eq 0 ] && exit 0
          gh issue create --title "merge-policy: merge fora da política em ${AFTER:0:12}" \
            --body "Merge commits cujo segundo pai não está em upstream/main: ${bad[*]}"
          exit 1
```

Pontos em aberto (nenhum resolvido aqui):

- **Lacuna na regra literal.** Quando a sincronização usa um ramo `sync/upstream-*` que contém um commit de resolução de
  conflito, o segundo pai do merge commit do PR é a ponta desse ramo, que **não** é ancestral de `upstream/main`. A
  regra como escrita só aceitaria PR cujo ramo fosse um commit do próprio upstream. A variante que o fluxo real parece
  pedir: aceitar quando a ponta de `upstream/main` (ou o `merge-base` com ela) é ancestral do segundo pai. A escolha
  precisa de um PR de sincronização de teste em F3, antes de o check passar a valer.
- O nome do remoto e a política de busca (HTTPS anônimo) são **propostas**; o espelho `upstream` descrito em D-07 não
  foi lido.
- O job não pode impedir o merge (roda depois); é auditoria. O ruleset continua com PR obrigatório, sem exclusão de
  ramo e sem push forçado (D-07).
- `allow_merge_commit` hoje é `true` no nycode e `false` no ny-pi; o conjunto de métodos fica em 04.

## 9. Ordem de ativação em F3, aceite e riscos

### 9.1 Ordem

1. Levar os workflows e `scripts/ci/` para o nycode com os caminhos da seção 3, **sem** torná-los obrigatórios; ajustar
   `ci.yml` e `npm-audit.yml` (seção 2.3). Rodar `local.sh` no head.
2. Instalar o poster local: `bench-pr.sh`, `bench-nightly.sh` e `vanilla-retest.sh` em `~/.local/bin`, units em
   `~/.config/systemd/user`, env em `~/.config/nycode/bench.env` (modo 0600; detalhe em 09, seção 3).
3. Medir a referência do ny-pi sobre o pi 1.6.0 (D-25) e regravar `docs/bench/baseline-main` por PR (09, seções 6 e 7).
4. Levar `codeql.yml` e desligar o default setup (D-20); levar `scorecard.yml` e `merge-policy.yml`.
5. Abrir o PR de teste (seção 9.2). Só com o primeiro `bench-pr` verde e a baseline commitada, ativar o ruleset `main`
   com os 10 contextos e a política de métodos de D-07 e remover a proteção clássica. Ativar antes travaria todo PR
   (RUNBOOK, "Tornar `bench-pr` obrigatório"). A ativação é ação de escrita no GitHub do dono: não foi feita.

### 9.2 Critério de aceite

- Um PR de teste com mudança funcional passa nos 10 contextos; `gh pr checks <n>` lista todos como `pass` e nenhum
  `pending` fica pendurado. Leitura apenas.
- Um PR de teste só de documentação recebe `bench-pr` `success` com a descrição "não funcional, sem rodada" (D-21) e os
  demais checks verdes.
- O mesmo PR aparece verde na fila de merge (`merge_group`) para cada um dos 10 contextos (um contexto sem o gatilho
  nunca aparece e bloqueia o merge).
- `merge-policy`: um push de teste com merge commit fora da regra abre a issue (testar num ramo descartável).
- `scripts/ci/local.sh` termina em verde no head do PR de teste.
- `bash scripts/ci/run-security.sh --selftest` e o autoteste de `scripts/ci` passam; o `run-security.sh` completo não
  acusa `ci.yml` nem `npm-audit.yml`.

### 9.3 Riscos

- **Tempo de CI maior (build, vitest, CodeQL, Docker do semgrep)**. Efeito: Fila de PR lenta; o ny-pi mede 46 s e 14 s
  só nos gates Python. Contenção: Medir os jobs do nycode no PR de teste; cache de npm já existe (`cache: npm`); tempos
  do nycode **não medidos**.
- **Custo do `bench-pr`**. Efeito: Cada PR funcional gasta estimados US$ 6,72 no olhar 1 (09, seção 6), até US$ 18 com a
  extensão. Contenção: Poster só depois de `ci-static`, `ci-security` e `build-check` (proposta 2.4); D-21 pula o que
  não é funcional.
- **Runner local parado**. Efeito: PR travado: `bench-pr` fica `pending` ou ausente e é obrigatório. Contenção: Alarme e
  procedimento abaixo.
- **Check obrigatório sem gatilho de `merge_group`**. Efeito: PR nunca entra na fila. Contenção: Aceite 9.2; sem
  `paths:`.
- **`ci.yml` fora da política `permissions: {}`**. Efeito: `ci-security` reprova no próprio PR de F3. Contenção: Ajustar
  na etapa 1.
- **`check` com `--write` mascara formatação**. Efeito: CI verde com árvore alterada. Contenção: Variante de CI sem
  `--write` (proposta).

**Runner local parado.** O que existe (RUNBOOK, seção "Diagnóstico"): `systemctl --user list-timers 'bench-*'` e
`journalctl --user -u bench-pr`; um `pending` preso por queda no meio da rodada é reprocessado no ciclo seguinte (só
`success` e `failure` são finais); o timer dispara a cada 10 min (`bench-pr.timer`: `OnBootSec=2min`,
`OnUnitActiveSec=10min`, `Persistent=true`) e o serviço tem `TimeoutStartSec=90min`. `bench-pr --poll` ignora PR com
erro que gastou rodada; esses só rerodam com `--pr N`. Alarme automático para "timer parado" **não existe** no código
lido.

**Proposta** de alarme e procedimento: (1) um check agendado e não obrigatório (cron de 30 min no GitHub) que falha se o
PR aberto mais antigo estiver sem `bench-pr` há mais de 2 h; (2) procedimento: conferir `list-timers`, ler o
`journalctl`, conferir o token OAuth (o braço recusa quando faltam menos de 30 min de validade,
`bench/arms/oauth-token.sh`), conferir espaço livre (`BENCH_MIN_FREE_GB`, padrão 30) e rodar `bench-pr.sh --pr N` à
mão; (3) se a máquina ficar indisponível por mais que o aceitável, a contingência é do dono; o ny-pi não definiu
tempo máximo. Contornar o ruleset nunca é saída.
