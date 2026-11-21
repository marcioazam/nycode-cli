# Guia de execução da migração ny-pi para o core do nycode

Estado: **plano, nada executado**. Os comandos são para um executor futuro; ao escrever só se rodaram leituras (`rg`,
`git show`, `git ls-tree`, `npm view`, versões). Identificadores (F0 a F12, D-01 a D-25, K1 a K14, P-1 a P-8) vêm de
[00](00-mega-plano.md), [02](02-arquitetura-alvo.md) e [11](11-decisoes-e-pendencias.md). Fatos de origem:
[anexo A](anexos/A-inventario-ny-pi.md) (`ny-pi@e4f8729`); de destino: [anexo B](anexos/B-mapa-core-nycode.md)
(`nycode@fb05db936`). Reversões detalhadas: [10](10-riscos-e-rollback.md). Checklist: [12](12-checklist-mestre.md).
Cada "não verificado" é um item aberto. **[AUTORIZAÇÃO]** marca ação que escreve no GitHub ou no npm: só o
`git-delivery` ou o dono a executa, com a autorização do dono na tarefa.

<a id="pre-requisitos"></a>

## Pré-requisitos da máquina

| Item | Exigido | Conferir | Observado aqui |
|---|---|---|---|
| git | >= 2.53 | `git --version` | 2.53.0 |
| git-filter-repo | instalado | `git filter-repo --version` | `a40bce548d2c` |
| gh | autenticado | `gh auth status` | 2.46.0; login não verificado |
| Node | >= 22.19 (`engines`) | `node -v` | v24.22.3 |
| Python | 3.12 | `python3 --version` | **3.14.4, não serve**; usar 3.12 (`mise`) |
| jq, patch, rg, gitleaks, trufflehog | recentes | `command -v` de cada | presentes |

```bash
export ORIG=/home/marcio/source/ny-pi                 # origem: ler SÓ com git -C "$ORIG" show origin/main:<caminho>
export DEST=/home/marcio/source/nycode.wt/migration   # worktree do destino
export UP=marcioazam/nycode ORIGREPO=marcioazam/ny-pi
```

O working tree de `$ORIG` está sujo (351 entradas): nunca é lido nem tocado.

<a id="convencoes"></a>

## Convenções

1. **Um PR por unidade** (extensão, grupo de regras, costura), verde, reversível, com o teste dela.
2. **Ramo** `mig/f<n>-<unidade>` a partir de `origin/main` (`git switch -c mig/f5-todo origin/main`).
3. **Commit e PR** no formato do `AGENTS.md`, `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: msg`, em inglês.
4. **Squash**, exceto F1 (merge commit, D-03) e `sync/upstream-*` (D-07). **Entrega** (commit, push, PR, merge) pelo
   agente `git-delivery`; escritores nunca fundem.
5. **Verificar uma vez antes do commit:** `npm run check` mais um teste pontual,
   `cd packages/coding-agent && npx vitest --run test/<arquivo>.test.ts` (o `AGENTS.md` proíbe `npm test` e a suíte
   inteira). Antes do PR, `./test.sh` (`CONTRIBUTING.md`). `npm run build` só se a unidade precisar de `dist`.
6. **Git:** `git add <caminho>`; nunca `add -A`, `reset --hard`, `stash`, `--no-verify`, push forçado (`AGENTS.md`).
7. **Limites** (D-06): arquivo novo até 800 linhas, diretório até 7 arquivos de código; excedente importado vai à lista
   `scripts/ci/lint/structure-upstream.txt` (criada em F3). **Rerere** ligado em F0
   ([08](08-sincronizacao-upstream.md)).
8. **Evidência** por fase em `docs/migration/ny-pi-core/evidencias/F<n>.md`, criada no primeiro PR e completada no
   último, sem segredo nem saída longa (`head`/`tail`; o resto em `/tmp`). Modelo:

```markdown
# Evidência F<n>: <nome>
## Objetivo | SHAs (nycode main antes, ny-pi congelado, PRs com sha de merge)
## Comandos e saídas (com código de saída) | Itens do checklist fechados (12-checklist-mestre.md, com prova)
## Desvios (o que diferiu, por quê, quem autorizou) | Não verificado
```

<a id="ciclo"></a>

## Ciclo de uma unidade

De F2 em diante, para arquivo já em `import/ny-pi/` (a cópia do pi-code, em F5, F6 e F9, tem ciclo próprio). Exemplo
`bash-timeout`:

1. **Ramo** `mig/f7-bash-timeout` de `origin/main`; **mover** com `git mv`, em commit sem editar conteúdo (a
   autoria segue): `mkdir -p packages/coding-agent/{src/extensions,test/harness}/bash-timeout`, depois
   `git mv import/ny-pi/extensions/bash-timeout/index.ts packages/coding-agent/src/extensions/bash-timeout/index.ts` e
   `git mv .../index.test.ts packages/coding-agent/test/harness/bash-timeout/`; commit
   `feat(coding-agent): move bash-timeout from import/ny-pi unchanged`.
2. **Ajustar imports** em outro commit: `@earendil-works/pi-coding-agent` para `@nycode/coding-agent`,
   `@earendil-works/pi-tui` para `@nycode/tui`, variável `pi` para `nycode`, imports relativos com `.ts`, sem `any` nem
   import dinâmico. Conferir `rg -n "earendil|PI_|\.pi/agent|CLAUDE_CONFIG_DIR" <diretório novo>` (sem saída).
3. **Portar o teste** de `node:test` para vitest com `test/suite/harness.ts` e provedor falso, sem enfraquecer
   asserções. **Registrar** em `packages/coding-agent/src/extensions/index.ts` (K5), como em `index.ts:8-13`:
   `{ name: "bash-timeout", factory: bashTimeoutExtension, builtin: true }`.
4. **Verificar uma vez** (`npm run check` e o teste), `./test.sh` antes do PR; título
   `feat(coding-agent): embed bash-timeout as builtin extension`; entrega pelo `git-delivery`, squash.

<a id="f0"></a>

## F0. Preparação e congelamento

**Objetivo:** fechar as decisões, medir a linha de base do destino, congelar o ny-pi e limpar o destino.

**Pré-condições:** `git -C "$DEST" status --porcelain | wc -l` devolve 0;
`gh pr list -R "$UP" --state open --json number --jq length` devolve 0 (anexo D §6).

**Passos:**

1. Registrar em `evidencias/F0.md` as respostas do dono a D-15, D-16, D-17 e D-22; sem elas, os passos 5 a 7 param.
2. **Linha de base** na `main` limpa. Esperado: `ci`, `build` e `check` com código 0; `./test.sh` com **uma** falha
   conhecida, em `@nycode/env` (cargo ausente, `docs/fork/2026-11-20-fork-do-pi.md`); outra falha é base suja.

   ```bash
   cd "$DEST" && git switch --detach origin/main
   npm ci --ignore-scripts 2>&1 | tee /tmp/f0-ci.log | tail -5
   npm run build 2>&1 | tee /tmp/f0-build.log | tail -5
   npm run check 2>&1 | tee /tmp/f0-check.log | tail -5
   ./test.sh 2>&1 | tee /tmp/f0-test.log | tail -20
   ```

3. **Congelar o ny-pi:** `git -C "$ORIG" fetch origin && git -C "$ORIG" rev-parse origin/main` (hoje
   `e4f8729bfab57e9e2b222f020710c85d0a578c8d`). Esse é o "SHA de congelamento": até F12 só correção de segurança entra
   em `ny-pi/main`; o resto se vê com `git -C "$ORIG" log <sha>..origin/main --oneline`.
4. **Ramos remotos e PRs abertos** (leitura): `git ls-remote --heads origin | sed 's#.*refs/heads/##' | sort >
   /tmp/f0-heads.txt` (esperado: 213, anexo D §6; guardar também os SHAs em `/tmp/f0-heads-sha.txt`);
   `cut -d/ -f1 /tmp/f0-heads.txt | sort | uniq -c | sort -rn`; PRs abertos:
   `gh pr list -R "$UP" --state open --json headRefName --jq '.[].headRefName'` (esperado: vazio). Montar
   `/tmp/f0-delete.txt` com `dependabot/cargo/*`, `backup/*`, `feat/sota-v140-*` e os demais do antigo projeto em Rust,
   sem `main` e sem ramo de PR aberto.
5. **[AUTORIZAÇÃO] D-15, apagar os ramos**, só depois do passo 4:
   `while read -r b; do git push origin --delete "$b"; done < /tmp/f0-delete.txt`; conferir com
   `git ls-remote --heads origin | wc -l` (esperado: 213 menos os apagados). Também **[AUTORIZAÇÃO]**:
   `gh label delete rust -R "$UP" --yes`, `gh api -X DELETE repos/$UP/environments/copilot` e
   `gh api -X PATCH repos/$UP/code-scanning/default-setup -f state=not-configured` (CodeQL "default setup" preso em
   `actions, rust`; o CodeQL próprio entra em F3, D-20). Forma exata das chamadas: não verificada.
6. **[AUTORIZAÇÃO] D-16, triagem dos 8 alertas de secret scanning:**
   `gh api "repos/$UP/secret-scanning/alerts?state=open&per_page=100" --jq '.[] | [.number, .secret_type] | @tsv'`
   (esperado: 8 linhas, `google_oauth_client_id` e `_secret` em `packages/ai/src/utils/oauth/google-*.ts` e `plan.md`,
   anexo D §5). Com a autorização, fechar cada um como credencial pública de cliente instalado
   (`gh api -X PATCH repos/$UP/secret-scanning/alerts/<n> -f state=resolved -f resolution=wont_fix`; valores aceitos:
   não verificado) e abrir o PR `docs: remove historical plan.md`. Nunca imprimir o valor do segredo.
7. **D-17, escopo npm:** `npm view @nycode/coding-agent 2>&1 | head -3` (hoje `E404`). Criar a organização `@nycode` é
   ação do dono em npmjs.com (procedimento: não verificado); indisponível, plano B `@marcioazam` com prefixo `nycode-`.
8. **Etiqueta (P-6) [AUTORIZAÇÃO, push de tag]:**
   `git tag -a v1.6.0-base fb05db936 -m "nycode: base from earendil-works/pi@073b0ba (1.6.0)" && git push origin
   v1.6.0-base`. O `ci.yml:42-43` já pula o check de changelog sem tag (P-6 pode estar mitigado); o push dispara o CI
   (`ci.yml:7`). Efeito sobre `scripts/release.mjs`: não verificado.
9. **Versionar o script de renome**, que vive em `/tmp/nycode-rename/{rename.py,post.sh}` (citado em
   `docs/fork/2026-11-20-fork-do-pi.md`; `git ls-files` não o contém; conteúdo: não lido): PR
   `docs: version the fork rename script` com `cp` para `scripts/fork/`, antes de F5; se `/tmp` foi limpo, reconstruir
   pela tabela "Renomeação aplicada" do mesmo documento.
10. `git config rerere.enabled true`.

**Verificação de saída:** `git config --get rerere.enabled` devolve `true`; `git ls-remote --tags origin v1.6.0-base |
wc -l` devolve 1; com D-16 executado, a consulta do passo 6 devolve 0 alertas.

**Evidência:** saídas dos 4 comandos de base, SHA de congelamento, ramos antes e depois, PRs conferidos, respostas de
D-15, D-16, D-17 e D-22, `npm view`, SHA da etiqueta. **Reversão:** F0 não altera código; ramo apagado volta com
`git push origin <sha>:refs/heads/<nome>` por `/tmp/f0-heads-sha.txt`.

<a id="f1"></a>

## F1. Importação do histórico do ny-pi

**Objetivo:** trazer o histórico do ny-pi para `import/ny-pi/` num único PR com merge commit.

**Pré-condições:** `evidencias/F0.md` existe; `gh api repos/$UP --jq .allow_merge_commit` devolve `true`;
`gh api repos/$UP/rulesets --jq length` devolve `0` (o ruleset de F3 ainda não existe).

**Passos** (comandos de D-03):

1. **Clone limpo e reescrita**, fora do destino (o clone vem do GitHub, não do working tree sujo):
   `git clone --no-local https://github.com/marcioazam/ny-pi /tmp/ny-pi-import && cd /tmp/ny-pi-import && git
   filter-repo --to-subdirectory-filter import/ny-pi`. Se `origin/main` passou do SHA de congelamento, `git reset
   --hard <sha>` no clone **antes** do `filter-repo`, que remove o remoto `origin` (esperado).
2. **Verificação de vazamento no clone filtrado:**

   ```bash
   cd /tmp/ny-pi-import
   git ls-tree -r --name-only HEAD | grep -vc '^import/ny-pi/'     # esperado: 0
   git rev-list --count HEAD                                        # 59 no levantamento
   gitleaks git --redact --no-banner /tmp/ny-pi-import              # esperado: nenhum achado (flags não verificadas)
   trufflehog git file:///tmp/ny-pi-import --only-verified --fail   # esperado: nenhum segredo verificado
   ```

   Achado real (segredo, identificador pessoal) **bloqueia**: tratar com o dono e reescrever o clone
   (`git filter-repo --replace-text`). `.gitleaks.toml` e `.leak-allow` ficam em `import/ny-pi/`: comparar os achados
   com elas.
3. **Fundir no destino**, em worktree limpo da `main` (`--no-tags` não traz as etiquetas do ny-pi):

   ```bash
   cd "$DEST" && git remote add ny-pi-import /tmp/ny-pi-import && git fetch --no-tags ny-pi-import \
     && git switch -c mig/f1-import-history origin/main \
     && git merge --allow-unrelated-histories --no-ff ny-pi-import/main \
        -m "feat: import ny-pi history under import/ny-pi (marcioazam/ny-pi@<sha de congelamento>)"
   ```

4. **Tirar `import/` dos gates** (leitura do destino em `fb05db936`):

   | Arquivo, chave ou linha | Alcança `import/`? | Ação |
   |---|---|---|
   | `package.json:5-10`, `workspaces` | Não (`packages/*`, `apps/*`, 4 exemplos) | Nenhuma |
   | `biome.json:25-40`, `files.includes` | Não (lista branca) | Acrescentar `"!!import"` junto de `"!!apps"` |
   | `tsconfig.json`, `include` | Não | Acrescentar `"import/**"` a `exclude` |
   | `packages/coding-agent/package.json:23-30`, `files` | Não | Nenhuma |
   | `scripts/check-pinned-deps.mjs:5,28` | **Sim**, varre `"."` | `"import"` em `ignoredDirectories` |
   | `scripts/check-ts-relative-imports.mjs:16,49` | **Sim**, varre `"."` | `"import"` em `ignoredDirectories` |

   As duas últimas linhas fariam o `npm run check` ler `import/ny-pi/npm/package.json` e todo `.ts` importado. Commit
   próprio no mesmo PR: `docs: keep import/ out of the root gates` ([02](02-arquitetura-alvo.md) §2).
5. **Verificar uma vez** (`npm run check`, `./test.sh`). Fora de `import/ny-pi/` só mudam os quatro arquivos do passo 4:
   `git diff --name-only origin/main...HEAD | grep -v '^import/ny-pi/'`.
6. **PR com método MERGE [AUTORIZAÇÃO de entrega]:** `gh pr create -R "$UP" --base main --head mig/f1-import-history
   --title "feat: import ny-pi history under import/ny-pi"` e, com checks verdes, `gh pr merge <n> -R "$UP" --merge`
   (**não** `--squash`; `--admin` proibido), antes do ruleset de F3 (D-03, D-07).

**Verificação de saída:** em `origin/main`, `git log --follow --oneline import/ny-pi/extensions/plan-gate.ts | wc -l`
devolve mais de 1 (o último é o commit original, não o merge) e `git rev-list --parents -n1 origin/main | wc -w` devolve
3 (merge commit).

**Evidência:** SHA de congelamento usado, commits contados, saídas de `gitleaks` e `trufflehog`, SHA do merge commit,
saída do `git log --follow`, os quatro arquivos editados. **Reversão:** `git revert -m 1 <sha do merge>` num PR.

<a id="f2"></a>

## F2. Governança versionada e marca

**Objetivo:** trazer os arquivos de regra, reconciliar `AGENTS.md` e `CONTRIBUTING.md` e trocar o logo e o README.

**Pré-condições:** o `git log --follow` de F1 devolve mais de 1 commit; `ls .github` sem `CODEOWNERS` (anexo D §7).

**Passos:** conteúdo e reconciliação em [04](04-regras-do-repositorio.md) (30 linhas de regra) e
[05](05-marca-e-readme.md). Ordem dos PRs (`git mv` de `import/ny-pi/...` quando o arquivo existe lá):

1. `docs: add CODEOWNERS, dependabot, release and zizmor config` (o `dependabot.yml` do ny-pi cobre `/` e `/npm`:
   ajustar aos diretórios do destino).
2. `docs: add PR and discussion templates` (mantém os modelos de issue).
3. `docs: add CODE_OF_CONDUCT and SUPPORT` (perfil de comunidade de 71% a 100%).
4. `docs: add editorconfig, pre-commit and gitleaks config` (o destino usa `.husky/pre-commit` e `.gitleaksignore`).
5. `docs: reconcile AGENTS.md and CONTRIBUTING.md` (D-18, D-19: hoje o `CONTRIBUTING.md` proíbe editar `CHANGELOG.md`
   e o `AGENTS.md` manda editar `[Unreleased]`).
6. `docs: restore nycode logo and update README` (K14 em F4):

   ```bash
   mkdir -p docs/assets && R=/home/marcio/source/nycode-cli
   git -C $R show 9ea437bf7:docs/assets/nycode-pixel.svg > docs/assets/nycode-pixel.svg
   git -C $R show 9ea437bf7:docs/assets/nycode-wordmark-ansi.txt > docs/assets/nycode-wordmark-ansi.txt
   sha256sum docs/assets/nycode-pixel.svg   # esperado 7269f242f8f7c6dca765f8a780cf72f3a0d471a40e41e2524fc7f705328a9dd2
   ```

   O `.txt` deve dar `22201bcbda73ca8176350bc818ebea4fc70400f3572c507383decf19e836613f` (anexo C). O objeto `9ea437bf7`
   no clone usado: não verificado.

**Verificação de saída:** `rg -n "logo-auto.svg" README.md` sem saída; `rg -n "docs/assets/nycode-pixel.svg" README.md`
com 1 ocorrência; `gh api repos/$UP/community/profile --jq .health_percentage` devolve 100 (pode demorar; P-8).

**Evidência:** hashes dos assets, as 30 linhas de 04 em "igual ou mais estrito", perfil de comunidade, SHAs.
**Reversão:** `git revert` de cada PR (só arquivos novos e o README).

<a id="f3"></a>

## F3. CI unificado, gates e benchmark

**Objetivo:** unificar scripts de CI, workflows e `bench/`, medir a base do pi 1.6.0 e só então ativar o ruleset.

**Pré-condições:** `gh api repos/$UP/rulesets --jq length` devolve 0; `.github/workflows` só com `ci.yml` e
`npm-audit.yml`.

**Passos**, nesta ordem (checks em [07](07-ci-qualidade-seguranca.md); benchmark em [09](09-paridade-e-benchmark.md)):

1. **`scripts/ci/`:** `git mv import/ny-pi/scripts/ci scripts/ci`, mais
   `scripts/check-refs.py` (`scripts/check-leaks.sh` e `scripts/fixtures/leak/` já entraram em F2, PR #202, para o
   pre-commit de C-F2-14). Criar `scripts/ci/lint/structure-upstream.txt` (arquivos do upstream acima de 800 linhas:
   `git ls-files 'packages/*/src/**/*.ts' | xargs wc -l | awk '$1>800'`). `rg -n "claude-home|publish.list|\.pi/agent"
   scripts/ci` só pode sobrar onde F8 resolve. O `scripts/ci/biome.json` (2 espaços, aspas simples) não vale para o
   TypeScript do destino (D-06).
2. **Workflows:** mover `ci-static.yml`, `ci-security.yml`, `instruction-budget.yml`, `codeql.yml`, `scorecard.yml` para
   `.github/workflows/`, mantendo `ci.yml` e `npm-audit.yml`. Exigir actions por SHA, gatilhos `pull_request`,
   `merge_group` e `push` (sem `merge_group` o check obrigatório nunca reporta na fila), Node 22 e 24, Python 3.12 e
   CodeQL com `javascript-typescript`, `python`, `actions` (D-20). Validar sem rodar o CI:
   `actionlint .github/workflows/*.yml` e `zizmor --min-severity medium .github/workflows`.
3. **`bench/`:** `git mv import/ny-pi/bench bench` e `git mv import/ny-pi/docs/bench docs/bench` (o destino não tem
   `bench/`). A mudança de raiz quebra `bench/arms/ny-pi:12` (`repo=$(cd "$here/../.." && pwd)`, que usa `install.sh`,
   `npm/package.json` e `publish.list` da raiz do ny-pi, só em `import/ny-pi/`): apontar `repo` para
   `<raiz>/import/ny-pi` enquanto ele existir; idem `bench/arms/overlay-sha.sh` e `bench/tools/bench-pr.sh` (não lidos
   linha a linha: não verificado). O poller é a unidade systemd `bench/tools/systemd/bench-pr.{service,timer}`
   com `~/.config/ny-pi/bench.env` (`BENCH_REPO=$UP`): etapa manual do dono, fora do repositório.
4. **Braço `ny-pi@1.6.0` (D-14, D-25):** em `bench/arms.toml`, braço `ny-pi-pi160` (mesmo `bin` de `arms/ny-pi`, base pi
   1.6.0). O `bin/pi` do ny-pi usa `PI_HARNESS_PI_VERSION:-1.5.2` e os 2 patches de `dist` só aplicam nessa versão
   (anexo A §1 item 10): o braço mede "ny-pi sem os 2 patches de core sobre o pi 1.6.0", e isso entra no resultado. O
   instalador confere sha256 dos artefatos de 1.5.2 (`scripts/install-lib.sh:6-9`); os de 1.6.0 vêm de
   `https://pi.dev/api/installer/releases/1.6.0/` e o executor os confere (não verificado). Simulação sem custo:
   `python3 bench/run.py run --arm ny-pi-pi160 --tier pr --model claude-sonnet-5-5 --budget-usd 12 --dry-run`. Os
   níveis reais (`bench/run.py:535-539`) são `pr`, `baseline`, `full`, `vanilla`, `tb41`, `hard`: o "`tier smoke`" dos
   documentos canônicos **não existe** ali; usar `pr` ou criar `smoke` em `bench/suites.toml` (registrar em 09).
   Rodada real: conta `claude`, fila única, gasto autorizado.
5. **PR de teste** (`docs: ci smoke`, um arquivo funcional e um de documentação): todos os checks obrigatórios do
   conjunto unificado (D-05, lista em 07) reportam e passam; `bench-pr` com "não funcional, sem rodada" quando couber
   (D-21).
6. **Ruleset [AUTORIZAÇÃO]**, só depois do passo 5: partir de `import/ny-pi/.github/rulesets/main.json` com as mudanças
   de D-07 (sem `required_linear_history`; `allowed_merge_methods` `["squash","merge"]`) e os contextos de D-05:
   `gh api -X POST repos/$UP/rulesets --input .github/rulesets/main.json`; conferir
   `gh api repos/$UP/rulesets --jq '.[] | [.name, .enforcement] | @tsv'` (esperado `main  active`).
7. **Remover a proteção clássica [AUTORIZAÇÃO]**, com o ruleset ativo (guardar antes a saída de
   `gh api repos/$UP/branches/main/protection`): `gh api -X DELETE repos/$UP/branches/main/protection` (depois, a
   mesma leitura devolve 404). Alinhar ao ny-pi (anexo D §1): `delete_branch_on_merge`, `allow_auto_merge`,
   `allow_update_branch` em `true` (`gh api -X PATCH repos/$UP -F ...`; nomes dos campos: não verificado);
   `allow_merge_commit` fica `true` (D-07).

**Verificação de saída:** `gh api repos/$UP/rulesets --jq '.[0].enforcement'` devolve `active`;
`gh pr checks <n do PR de teste> -R "$UP"` mostra todos os contextos em `pass`.

**Evidência:** contextos obrigatórios e o resultado de cada um no PR de teste, JSON do ruleset, saída do `--dry-run`,
resultado ou pendência da rodada `ny-pi-pi160`, decisão sobre `smoke`. **Reversão:**
`gh api -X DELETE repos/$UP/rulesets/<id>` e recriar a proteção clássica pela saída guardada.

<a id="f4"></a>

## F4. Core nativo

**Objetivo:** transformar wrapper, variáveis de ambiente e reescrita de `dist` em código do core, com teste, e criar
`nycode migrate from-pi`.

**Pré-condições:** `gh api repos/$UP/rulesets --jq length` devolve 1 (F3); linha de base de F0 sem falha nova.

Um PR por costura. Linhas conferidas com `rg` em `fb05db936`; reconferir antes de editar. O teste do ny-pi vira o teste
da costura, reescrito em vitest em `packages/coding-agent/test/harness/` (K2: `packages/mcp/test/`).

### K1. `piSameContextMessage` em `core/sdk.ts`

- `packages/coding-agent/src/core/sdk.ts:370`: `messages.every((message, index) => currentMessages[index] === message)`
  passa a comparar por identidade de conteúdo (função de `claude-home/patches/pi-core/cache-warm-identity.mjs`, lido
  com `git -C "$ORIG" show origin/main:...`; renomeada `nycodeSameContextMessage`).
- Teste de origem: `claude-home/bin/tests/cache-warm-identity.test.ts`, que verifica o **script** de reescrita do
  `dist`; o novo verifica o comportamento no fonte (mesmo conteúdo em objetos distintos conta como igual; conteúdo
  alterado, não). Conteúdo linha a linha do teste de origem: não verificado.

### K2. `STDIN_CLOSE_GRACE_MS` em `packages/mcp`

- `packages/mcp/src/transports/stdio.ts:10` (`const STDIN_CLOSE_GRACE_MS = 500;`, usado em `:180`): de 500 para 100
  (spec 0003).
- Teste de origem: `claude-home/patches/pi-core/mcp-close-grace.test.ts` (o anexo A o põe em `bin/tests/`; o caminho
  real em `origin/main` é `patches/pi-core/`). O novo sobe um servidor MCP stdio lento e confere o `SIGTERM` em 100 ms.

### K3. Flags do wrapper em `cli/args.ts`

- `packages/coding-agent/src/cli/args.ts:241-243` trata `--approve|-a` e `--no-approve|-na` (ajuda em `:341-342`).
  Acrescentar `--bypass` e `--dangerously-skip-permissions` (ligam `permissions.bypass`) e `--safe`, `--no-bypass`
  (desligam), com linhas de ajuda. O `--no-approve` do wrapper vira o padrão `defaultProjectTrust: "never"` (K4). Os
  subcomandos `install|remove|uninstall|update|list|config|auth|mcp` já são despachados antes, em `main.ts:642-660`.
- Teste de origem: `bin/test_pi_env.sh`, do **carregador de `local.env`** (que some); o novo cobre as 4 flags e a
  precedência variável sobre `settings.json`. As checagens do carregador (dono, modo 0600, 9 chaves) vão ao teste de
  `migrate from-pi`.

### K4. Chaves e padrões em `settings-schema.ts` e `settings-defaults.ts`

- `core/settings-schema.ts:206` (`SettingsSchema`; `quietStartup` `:265`, `defaultProjectTrust` `:271`) e
  `core/settings-defaults.ts:18` (`retry`), `:29` (`quietStartup: false`), `:30` (`defaultProjectTrust: "ask"`).
- Mudanças: `defaultProjectTrust` padrão `"never"`; `quietStartup` padrão `"header"` (o tipo atual é boolean: ampliar
  o tipo ou manter boolean e registrar o desvio); `retry` do ny-pi (`enabled`, `maxRetries 10`, `baseDelayMs 2000`,
  `maxAgentDelayMs 60000`); blocos `permissions` e `harness` e as chaves da tabela de 02 §5, cada uma com sua `NYCODE_*`
  (documentar em `packages/coding-agent/docs/environment-variables.md`); chave `hooks` (ausente do schema:
  `rg -n "hooks" packages/coding-agent/src/core/settings-schema.ts`). Regenerar `packages/coding-agent/schemas`.
- Teste: um por chave nova (padrão, validação, sobreposição por variável). Nenhuma leitura de `PI_*` ou
  `CLAUDE_CONFIG_DIR` em tempo de execução (D-09).

### K12. `nycode migrate from-pi`

- Arquivos: `packages/coding-agent/src/migrations/from-pi.ts` (novo) e despacho em `main.ts` junto de `:642-660`;
  `src/migrations.ts` (`runMigrations`, `:306`) roda sozinho na partida e não serve. Origem `~/.pi/agent` (ou
  `--from <dir>`); destino `getAgentDir()` (`config.ts:654`, `~/.nycode/agent`).
- **Padrão `--dry-run`** (imprime o plano, não escreve); escrever exige `--apply` (nome **proposta**, não existe).
- **Copia:** `settings.json` convertido pela tabela de 02 §5, lendo `local.env` (9 chaves, só com dono = usuário e
  modo 0600 ou 0400, nunca por `source`; lista em 02 §5; `PONYTAIL_QUIET_STARTUP` é do pacote `ponytail`); tira de
  `packages` o `pi-code` e `./vendor/pi-lsp` (embutidos) e relata `./vendor/ponytail` como pacote a instalar;
  `mcp.json` (segredos como `${ENV}`), `models.json`, `lsp.json`, `keybindings.json`, `sessions/` (copiada) e a
  confiança de projeto (destino em `trust-manager.ts:221`; nome do arquivo no pi 1.5.2: não verificado).
- **Nunca toca:** `~/.pi`, `~/.claude`, `install/`, `npm/`, `bin/` e `claude-home/` do pi (personalizações em
  `claude-home` só listadas; política de cópia: não decidida). `auth*.json` só com confirmação interativa, nunca em
  `--dry-run` nem sem terminal. **Backup:** arquivo existente vai a `~/.nycode/agent/.backup-from-pi/<timestamp>/`.
- Testes (vitest, `HOME` em `mktemp`): dry-run não escreve; conversão das 9 chaves; `local.env` 0644 recusado;
  `auth.json` pede confirmação; origem idêntica por hash antes e depois.

### K14. Título de reserva em `config.ts`

- `packages/coding-agent/src/config.ts:605`: `export const APP_TITLE: string = nycodeConfigName ? APP_NAME : "π";`; o
  literal `"π"` vira `"nycode"`. Entra em F2 pela marca; o teste (`--help` com `HOME` vazio mostra "nycode";
  `--version` imprime só a versão, sem "π", como no upstream, que faz `console.log(VERSION)`) fecha em F4. Sem teste
  de origem; teste novo em `packages/coding-agent/test/`.

**Verificação de saída:** `npm run check && ./test.sh`; `rg -nw "PI_[A-Z_]+|CLAUDE_CONFIG_DIR|\.pi/agent"
packages/coding-agent/src packages/mcp/src | rg -v "migrations/from-pi"` sem saída (`-w`: sem ele o padrão casa
`ANTHROPIC_API_KEY` e outras 36 linhas do upstream); com build, `HOME=$(mktemp -d) node packages/coding-agent/dist/cli.js
--help` contém "nycode", `--version` imprime a versão sem "π" e `... migrate from-pi` imprime só o plano.

**Evidência:** SHAs dos PRs K1 a K4, K12, K14; saída do `rg` negativo; trecho do dry-run; testes portados com o arquivo
de origem; laudo do `security-reviewer` (obrigatório em F4, 00 §10). **Reversão:** `git revert` do PR da costura; a
migração só escreve com `--apply` e com backup.

<a id="f5"></a>

## F5. Camada base embutida (pi-code 1.7.0 com os 19 patches)

**Objetivo:** importar a árvore do pi-code já remendada como extensões embutidas, 3 commits por extensão
([02](02-arquitetura-alvo.md) §3.1), com os testes de patch portados.

**Pré-condições:** `ls import/ny-pi/claude-home/patches/pi-code/*.patch | wc -l` devolve 67 depois da unidade que
congela a pilha do checkout local (D-32; antes dela, 19);
`rg -n 'name: "hooks"' packages/coding-agent/src/extensions/index.ts` sem saída.

**Passo 1, árvore de referência:** `mkdir -p /tmp/pi-code-ref && cd /tmp/pi-code-ref && npm pack pi-code@1.7.0 --silent
&& tar -xzf pi-code-1.7.0.tgz` (extensões em `./package/extensions`); `sha1sum pi-code-1.7.0.tgz` deve dar
`8ba1f814773da6897f6708c62c7c517cee2baf4e`, senão PARAR.

**Passo 2, os 19 patches em ordem alfabética** (o glob do `bin/pi` ordena por nome e os `z` impõem a ordem; `LC_ALL=C`
torna o resultado independente do idioma):

```bash
export LC_ALL=C ext=/tmp/pi-code-ref/package/extensions
for p in "$DEST"/import/ny-pi/claude-home/patches/pi-code/*.patch; do
  patch -d "$ext" -p1 -N --no-backup-if-mismatch < "$p" || { echo "FALHOU: $p"; break; }
done
```

O `sed` do `TRUST_GATE` (anexo A §1 item 9) só age se a linha original estiver intacta; com `goal.patch` ela já vem
comentada (`goal.patch:111-112` em `origin/main`), então normalmente nada muda:

```bash
grep -n "TRUST_GATE" "$ext/goal.ts"    # esperado: a linha "if (!trusted)" comentada
PI_CODE_TARBALL=/tmp/pi-code-ref/pi-code-1.7.0.tgz bash import/ny-pi/scripts/check-patch-stack.sh
# esperado: "patch-stack: ok 19 patches"
```

**Passo 3, conferir contra a árvore instalada** (com D-32, a árvore instalada é congelada em
`import/ny-pi/pi-code-installed/` e o `diff -r` compara a cópia congelada com a instalada; os passos 1 e 2 valem só para os
19 patches da `origin/main`) (máquina do dono, só leitura): `diff -r
"$HOME/.pi/agent/npm/node_modules/pi-code/extensions" /tmp/pi-code-ref/package/extensions && echo IGUAIS`. Diferença
fora dos 19 patches e do `sed` é desvio a registrar e resolver **antes** de importar. Que a instalação do dono bata:
não verificado.

**Passo 4, importar cada extensão em 3 commits** (revisão commit a commit; squash no merge). Exemplo `todo`: ramo
`mig/f5-todo`; `cp "$ext/todo.ts" packages/coding-agent/src/extensions/todo/index.ts` e
`cmp` byte a byte; `git add` do diretório; commits (1) `feat(coding-agent): copy pi-code 1.7.0 todo verbatim`, (2)
`feat(coding-agent): rewrite todo imports to @nycode, rename pi variable`, (3)
`feat(coding-agent): format todo with biome, register as builtin`.

Commit 2: `@earendil-works/pi-{coding-agent,tui,ai,agent-core}` para `@nycode/{coding-agent,tui,ai,agent-core}` (com
`scripts/fork/rename.py` se cobrir). Commit 3: Biome do fork, regras do `AGENTS.md` (sem `any`, sem import dinâmico),
registro em `index.ts` (K5) e teste. O commit 1 não passa no `npm run check` (o pi-code não segue o Biome do fork) e
`--no-verify` é proibido: ou se comita só com `check` verde (aplicar os 3 passos no working tree e dividir em commits
depois), ou o commit 1 exclui o diretório por `"!!<diretório>"` em `biome.json` e o 3 remove a exclusão. Qual funciona
com o `husky` atual: não verificado; registrar a escolha. P-3: a primeira unidade mostra, no `npm run check`, se algum
evento da `ExtensionAPI` mudou de 1.5.2 para 1.6.0.

**Passo 5, ordem** ([02](02-arquitetura-alvo.md) §3.1; um PR por unidade): `_shared` (`internal/`, 5559 linhas;
as demais importam dela; a parte de `goal` fica em F6); `hooks` (2501, base dos hooks de F8); `todo` + `todo-collapse`;
`question`; `commands` + `commands-print`; `notify` + `notify-focus`; `git-checkpoint` + `rewind-tree`; sem patch: `memory`, `claude-rules` (absorve a regra de
`no-context-files-covers-claude-md.ts`, F7), `context-imports` (1392 linhas, lista de base), `output-styles`,
`skills-compat`, `session-title`, `thinking`, `env-settings`, `settings-flags`, `init`, `context-usage`; por
fim `web`, **desligada** (D-10). `status-line` (+ `statusline-multiline`, `zzzzzzzz-statusline-provider`) e `run`
importam `subagent/fleet-ui`, `section-nav`, `fleet` e `background`: vão a F6, item 1b abaixo (D-34). Não migram: `mcp/` e `version-floor.ts`. O campo que desliga uma extensão por padrão:
`enabledByDefault: false` em `InlineExtension` (criado na unidade `web`).

**Testes de patch:** vão a `packages/coding-agent/test/harness/<extensão>/`, convertidos de `node:test` para vitest por
`git mv` de `import/ny-pi/claude-home/patches/pi-code/` (5 arquivos em F5: `todo-collapse`, `statusline-multiline`,
`provider`, `notify-focus`, `rewind-tree`). Em `origin/main` há 24 arquivos de teste para 19 patches e **4 patches sem
arquivo próprio** (`commands-print`, `zz-hotkeys-no-alt`, `zz-panel-main-root`, `zzz-panel-column0`), embora o anexo A
diga "um teste por patch": escrever um teste de caracterização para cada um ou provar por `grep` que outro os cobre
(não verificado).

**Verificação de saída:** `rg -n "patch -p1|sed -i|node_modules/pi-code|CLAUDE_CONFIG_DIR"
packages/coding-agent/src/extensions` sem saída; `npm run check && ./test.sh` verdes.

**Evidência:** sha1 do tarball, saída de `check-patch-stack.sh`, resultado do `diff -r` e desvios, SHA de cada PR com os
3 commits, testes portados, os 4 patches sem teste e o que se fez. **Reversão:** `git revert` do PR da extensão.

<a id="f6"></a>

## F6. Orquestração embutida

**Objetivo:** embutir `subagent` (8526 linhas, 9 patches), `plan-mode` (2628, 3 patches) e `goal`, na ordem que
preserva as dependências.

**Pré-condições:** F5 concluída (`internal/`, `hooks`, `todo`, `commands` embutidos);
`ls import/ny-pi/claude-home/patches/pi-code/subagent-panel/*.test.ts | wc -l` devolve 6.

**Procedimento:** o de [F5](#f5), passos 2 a 4, sobre `/tmp/pi-code-ref` (já com os 19 patches); 3 commits por PR,
reformatando só no terceiro. Arquivos em [03](03-mapa-de-migracao.md#f6-orquestracao). P-2: o executor lê linha a linha
os patches grandes (`subagent-panel`, 2547 linhas; `goal`, 872). Patch que cruza submódulos entra como está na árvore
de referência (a divisão em PRs segue diretórios); submódulo que não compile sem um irmão vai no mesmo PR, com desvio.

**Ordem interna** (D-35: o código de `subagent` entra num PR só, porque os submódulos se importam em ciclo; os testes
de cada item entram depois, em PRs por grupo; testes vitest em `test/harness/`, movidos de
`import/ny-pi/claude-home/patches/pi-code/`):

1. `subagent` núcleo (`run`, `modes`, `concurrency`, `index`, `params`): `subagent-nesting.test.ts`; `background`.
   1b. Depois de `fleet-ui` e `section-nav` (itens 2 e 4): `status-line` + `statusline-multiline` +
   `zzzzzzzz-statusline-provider` e `run`, vindos de F5 (D-34); fecham C-F5-21, C-F5-22, C-F5-25 e C-F5-26.
2. `fleet` (store, tracker, inbox, source): `fleet*.test.ts` (4); depois `fleet-ui` (patches `zz-panel-main-root` e
   `zzz-panel-column0`, sem teste próprio): `fleet-ui.test.ts`, `fleet-ui-layout.test.ts`.
3. `transcript`: `subagent-render/render.test.ts`.
4. `nesting`, `respawn`, `send`: `respawn.test.ts`, `send.test.ts`.
5. `model-effort`: `render`, `replay`, `tracker` (de `zzzzzzz-subagent-model-effort`).
6. `team`: `team*.test.ts` (2).
7. `plan-mode` (patch `zz-hotkeys-no-alt` sem teste próprio, `zzzz-plan-done-rule`, `zzzzz-plan-sota`):
   `plan-done-rule.test.ts`, `plan-sota.test.ts`. Exige o skill `plan-workflow/SKILL.md`, que chega em F8: até lá o
   teste usa um recurso de teste.
8. `goal` (`goal.ts`, `internal/goal-*`, `model-complete.ts`; inclui o fim do portão de confiança): `goal.test.ts`,
   `goal-lifecycle.test.ts`.

**Suítes do benchmark por unidade** (rodada real com gasto autorizado; `--dry-run` é gratuito). Depois de F3 existem
`bench/contract` (API falsa) e `bench/suites/{hard,multi,plan}`. Itens 1 a 6 para `multi`; 7 e 8 para `plan` (qual
caso cobre `/goal`: não verificado); mapeamento para `s1`..`s8` de `bench/suites.toml` em
[09](09-paridade-e-benchmark.md). O braço `nycode` só entra em `arms.toml` com F6 verde (simulação:
`python3 bench/run.py run --arm nycode --tier pr --suites s1 --model claude-sonnet-5-5 --budget-usd 12 --dry-run`).

**Verificação de saída:** `npm run check && ./test.sh`;
`cd packages/coding-agent && npx vitest --run test/harness/subagent test/harness/plan-mode test/harness/goal`;
`rg -n "PI_CODE_SUBAGENT|PI_SUBAGENT_RESPAWN" packages/coding-agent/src --glob '!**/migrations/**'` sem saída (viraram
`NYCODE_SUBAGENT*`; `src/migrations/` guarda a tabela de conversão do `migrate from-pi`, D-09).

**Evidência:** testes migrados por item (24 arquivos de teste de patch no total, 5 deles de F5), saídas do `--dry-run`
e das rodadas reais, desvios de ordem. **Reversão:** `git revert` do PR do item; o último a reverter remove o registro.

<a id="f7"></a>

## F7. Extensões próprias

**Objetivo:** migrar as 23 unidades de `extensions/` do ny-pi conforme [02](02-arquitetura-alvo.md) §3.2.

**Pré-condições:** F5 concluída (para `plan-gate`, também F6). Lista real de testes:
`git -C "$ORIG" ls-tree -r --name-only origin/main extensions claude-home/bin/tests | grep test` devolve 22 `.test.ts`
em `extensions/` e, em `claude-home/bin/tests`, 8 `.test.ts` e 3 `.sh`.

Cada item segue o [ciclo de uma unidade](#ciclo). Das 23 unidades, 21 têm "Fase F7" na tabela 3.2 (`permissions` é F8
e `no-web-search` é F5); 19 migram e 2 não. Ordem de dependência, com o teste que vira o da extensão (`ext/` =
`extensions/`, `bt/` = `claude-home/bin/tests/`):

1. `docs-pointer` (de `pi-docs`, extensão embutida, D-36), `bash-timeout` (K8, opção da ferramenta `bash`), `compact-threshold` (K9, de
   `compact-at-400k.ts`), `footer` (de `footer-no-stats.ts`, sem teste em `origin/main`).
2. `up-dequeue`, `sound-notify`, `auto-resume`, `completion-gate`, `prefix-cache-1h`, `todo-sync` (funde em `todo`),
   `syntax-check` (`@vscode/tree-sitter-wasm` 0.3.1 exata), `dev-commands` (2 testes), `headless-lean`, depois
   `effort-sandwich` (importa `headless-lean`; desligada).
3. `import-claude-session` (opcional) de `ext/puxar.ts` + `claude-home/bin/puxar/puxar.py` (`test_puxar.py`, Python;
   vai a `scripts/harness/puxar/`).
4. **K10**, API pública em `packages/tui` (widget fixo no topo, clique no cabeçalho, observador de entrada): testes
   novos em `packages/tui/test/`. Depois `sticky-prompt` (usa K10), `ui` (`a11y` primeiro; 6 testes) e `ui-visual`
   (usa `ui/a11y` e `icons`; logo pelo componente exportado; 5 testes).
5. `plan-gate` (após F6; precisa do agente `plan-reviewer`, de F8): `bt/plan-gate.test.ts`.

Os testes de cada uma ficam ao lado de `ext/<nome>/` (`ext/` = `extensions/`) ou em `bt/` (= `claude-home/bin/tests/`).

Não migram: `cache-prefix-probe` (D-10, sem teste) e `context-files` de `no-context-files-covers-claude-md.ts` (some,
D-10; regra absorvida por `claude-rules`; `no-context-files.test.ts` sai, com linha em [03](03-mapa-de-migracao.md)).

As 19 que migram são todas menos K10 (costura). Testes: 22 em `extensions/` mais 5 de `claude-home/bin/tests`;
`cache-warm-identity` é K1 (F4). `sticky-prompt`, `ui/a11y`, `ui-visual/header` e `ui/terminal` vêm depois de K10 (usam
campos internos do pi-tui 1.5.2, anexo A §9 item 6). Chaves de configuração: 02 §5.

**Verificação de saída:** `rg -n "@nycode/tui/(src|dist)|node_modules/@nycode" packages/coding-agent/src/extensions`
sem saída (sem caminho privado); `npm run check && ./test.sh` verdes.

**Evidência:** tabela extensão para teste portado (22 arquivos), as 2 que não migram, K10, chaves novas.
**Reversão:** `git revert` do PR da extensão; K10 é aditivo e reverte sem tocar nas demais.

<a id="f8"></a>

## F8. Recursos embarcados e permissões

**Objetivo:** embarcar regras, instruções, skills, comandos, agentes e hooks e só então ligar o motor nativo de
permissão atrás de chave.

**Pré-condições:** F5 e F6 concluídas; `ls packages/coding-agent/resources` ainda falha (diretório novo, N3).

**Ordem** ([02](02-arquitetura-alvo.md) §6):

1. **Regras e instruções:** `claude-home/CLAUDE.md`, `CLAUDE.headless.md`, `lite/APPEND.md` para
   `resources/instructions/{contract,headless,lite}.md`; `rules/safety.md` e as 4 de `rules-ref/` para
   `resources/rules/`. Caminhos absolutos viram `${NYCODE_RESOURCES}`. Mover `scripts/ci/instruction_budget.py` e a
   linha de base no mesmo PR: o texto sempre carregado **não pode crescer**.
2. **Skills** (30 pastas, 227 arquivos) para `resources/skills/`, classe `core`, `ui` ou `optional` (P-1, 0005). P-4:
   licença e autoria das de terceiros (`claude-home/docs/third-party/`: `addy-agent-skills`, `mattpocock-skills`,
   `obra-superpowers`) vão ao `NOTICE`.
3. **Comandos** (17) para `resources/commands/`.
4. **Agentes** (17) para `resources/agents/` (`plan-reviewer.md` destrava o `plan-gate`).
5. **Hooks, fase A (D-08):** `claude-home/hooks` (21 arquivos: `guard.py`, `graph_context.py`, `dispatch/`, `claims/`,
   `impeccable_gate.sh`, fixtures, testes) para `resources/hooks/`, registrados por padrão em `hooks` de
   `settings-defaults.ts` e executados pela extensão `hooks` (F5). Exige `python3` e `jq`.
6. **K6 e K13:** `core/resource-loader.ts` ganha o escopo `builtin` de menor precedência (K6; o `:1254-1268` já resolve
   `SYSTEM.md` e `APPEND_SYSTEM.md`); `packages/coding-agent/package.json` `files` (`:23-30`) recebe `"resources"`
   (K13). Testes: precedência (usuário > projeto > embarcado, 02 §6) e `npm pack --dry-run` lista `resources/`.
7. **Motor nativo, fase B (K11, D-08):** `core/permissions/` com `permissions.engine` (`"script"` padrão, `"native"`
   opcional) e gancho em `tool_call`. Teste diferencial: o corpus de `claude-home/hooks/test_guard.py` e o fuzz
   `fuzz/test_guard_fuzz.py` rodam nos dois motores com **semente fixa** e exigem veredito igual em 100%. O padrão só
   vira `native` depois do `security-reviewer`. Falha ao iniciar o motor escolhido: a chamada é **negada**.

**Lints a passar com os caminhos novos** (também por `scripts/ci/run-static.sh`): `scripts/ci/lint/core_scope.py`
(confere `docs/specs/0005` contra skills, agentes e extensões entregues; só passa depois dos passos 2 a 4 e de F7),
`scripts/ci/lint/skill_lint.py`, `scripts/harness/checks/check-agents.py`, `scripts/check-refs.py` (atualizar
`refs-allow.txt`) e `scripts/ci/instruction_budget.py check` (atualizar a linha de base), todos com `python3`. As raízes
que cada lint varre (hoje `claude-home/`, `extensions/`, `docs/specs/`) passam a `packages/coding-agent/resources/`,
`packages/coding-agent/src/extensions/` e `docs/specs/`: editar cada script; argumentos: não verificado (ler `--help`).
O resto de `claude-home/bin` (`git-deliver`, `doctor/`, `hud/`, `puxar/`, `structure/`, `telemetry/`, `evals/`) vai a
`scripts/harness/` e aos subcomandos `nycode doctor` e `nycode deliver` ([03](03-mapa-de-migracao.md)); os 29
documentos de `claude-home/docs` vão a `docs/harness/`.

**Verificação de saída:** `rg -n '\$\{?CLAUDE_CONFIG_DIR|~/\.pi\b|claude-home' packages/coding-agent/resources` sem
saída (C-F8-07; as 5 linhas que atribuem `CLAUDE_CONFIG_DIR=$HOME/.nycode/agent` para o plugin claude-hud ficam, porque
ele lê essa variável: [evidência F8](evidencias/F8.md#correção-da-verificação-de-saída-do-06)); `ls packages/coding-agent/resources/{agents,skills,commands}` lista 17, 30 e 17 entradas;
`cd packages/coding-agent && npx vitest --run test/harness/permissions` com o diferencial em 100%.

**Evidência:** contagens (17 agentes, 30 skills, 17 comandos, 21 arquivos de hooks), saída de cada lint, concordância
do teste diferencial (alvo 100% do corpus e do fuzz), laudo do `security-reviewer`, P-1 e P-4 fechados. **Reversão:**
`permissions.engine: "script"` (padrão) desliga o motor nativo sem reverter código; recursos por `git revert`.

<a id="f9"></a>

## F9. Terceiros

**Objetivo:** embutir `pi-lsp` como extensão `lsp` e deixar `ponytail`, `ralph-loop`, `pr-review-toolkit` e `claude-red`
como pacotes opcionais (D-11).

**Pré-condições:** F5 concluída; `git -C "$ORIG" show origin/main:third-party.json | jq '.components | length'` devolve
5 (nome do campo: não verificado).

**Passos:**

1. **`pi-lsp` 0.1.7 + `patches/third-party/pi-lsp.patch` (4080 linhas):** técnica de F5: `npm pack pi-lsp@0.1.7`,
   conferir o sha512 de `third-party.json`, `patch -p1 -N`, copiar para `packages/coding-agent/src/extensions/lsp/` em 3
   commits (é código próprio; arquivos acima de 800 linhas vão à lista de base). `lsp.json` passa a
   `~/.nycode/agent/lsp.json`; exemplo em `packages/coding-agent/examples/config/lsp.json`.
2. **Opcionais:** `ponytail` (git `ef8ca48`, MIT) e `ralph-loop` (claude-plugins-official `893173f`, Apache-2.0) em fork
   `marcioazam/<nome>` com o patch (351 e 26 linhas) como commit e proposta ao autor (D-11; **ação externa,
   [AUTORIZAÇÃO]**); `pr-review-toolkit` (`893173f`) e `claude-red` (`a8de813`) instalados da origem com SHA fixo.
3. Remover `third-party.json` e `patches/third-party/` só depois de cada opcional instalar por `nycode install <fonte>`
   num `HOME` isolado. `NOTICE`: origem, versão e licença de cada um (e do pi-code, MIT, de F5).

**Verificação de saída:** `test ! -e third-party.json && test ! -d patches/third-party && echo REMOVIDOS`;
`rg -n "pi-lsp|ponytail" NOTICE`; `cd packages/coding-agent && npx vitest --run test/harness/lsp`.

**Evidência:** SHAs e integridades, saída de `nycode install` por opcional, diff do `NOTICE`. **Reversão:** `git
revert` do PR de remoção restaura `third-party.json` e a pilha.

<a id="f10"></a>

## F10. Paridade final e nova linha de base

**Objetivo:** provar a paridade do braço `nycode` com a referência e gravar a nova linha de base `main`.

**Pré-condições:** F6 a F9 concluídas; `bench/arms.toml` com o braço `nycode`. Critério, margem de custo e 11
dimensões: [09](09-paridade-e-benchmark.md#criterio-de-paridade) (este guia não repete os números).

**Passos:** rodar `full` do braço `nycode` e as referências `pi-vanilla` e `cc-vanilla` (D-14), na conta `claude`, em
fila única, com gasto autorizado; passar o gate; regravar `docs/bench/baseline-main/` por PR (flags de
`bench/run.py:533-570`):

```bash
python3 bench/run.py run --arm nycode --tier full --model claude-sonnet-5-5 --budget-usd <de 09> --out /tmp/f10-nycode
python3 bench/run.py gate --base docs/bench/baseline-main --cand /tmp/f10-nycode   # depois: report --runs ... --out ...
```

**Verificação de saída:** `gate` sem regressão contra a referência guardada (ou contra `ny-pi-pi160` de F3, se ela já
diferia por causa da base, D-25); `git diff --stat docs/bench/baseline-main` só no PR da nova linha de base.

**Evidência:** saídas de `gate` e `report`, custo real, relatório de paridade assinado pelo dono. **Reversão:** a nova
linha de base é um PR; reverter o PR restaura a anterior.

<a id="f11"></a>

## F11. Distribuição

**Objetivo:** publicar o nycode `2.0.0` (D-13) pelo repositório público `marcioazam/nycode`: etiqueta `v2.0.0`, GitHub
Release com binários autocontidos e atestação de proveniência (D-17, D-42). Sem organização, sem registro e sem token de
longa duração: `@nycode/*` não vai ao npm (`npm whoami` devolve 401 e as dependências `@nycode/*` não existem lá).

**Pré-condições:** F10 fechada; D-17 (canal do repositório) e D-42 (autorização da publicação) registradas em
[11](11-decisoes-e-pendencias.md); repositório público (`gh repo view marcioazam/nycode --json visibility`, `PUBLIC` em
2026-11-21); `gh` 2.49 ou mais novo para `gh attestation verify` (a máquina do dono tem 2.46.0: instalar uma versão nova
em `~/.local/bin` antes do passo 7); Docker (`docker version`, servidor 29.1.3 em 2026-11-21).

**Estado real do aviso de versão e da autoatualização** (lido em `origin/main` `21243b690`, depois do K15, #228):

- Aviso de versão e changelog **já** usam o GitHub Releases: `packages/coding-agent/src/utils/version-check.ts:5-6`
  (`RELEASES_URL = https://github.com/marcioazam/nycode/releases`, consulta
  `api.github.com/repos/marcioazam/nycode/releases/latest`, `tag_name` sem o `v`), coberto por
  `test/version-check.test.ts`. `rg -n "pi\.dev" packages/*/src -g '!*.test.ts'` não devolve nada.
- Binário `bun` (`detectInstallMethod() === "bun-binary"`): `nycode update` não executa nada e imprime
  `Download from: https://github.com/marcioazam/nycode/releases/latest` (`config.ts:371`). É o comportamento certo para o
  canal escolhido.
- Instalação "gerenciada" (`package-manager-cli.ts:229-239`): sem `NYCODE_INSTALLER_API_BASE` falha e aponta para
  `RELEASES_URL`; nenhum canal do nycode grava o marcador `nycode-managed-install`, então o ramo fica inerte (não mexer:
  é código do upstream).
- Instalações por `npm`, `pnpm`, `yarn` ou `bun` (`config.ts:121-170`) montam `<gerenciador> install -g @nycode/coding-agent@<v>`,
  que dá E404 sem registro. Nenhum canal de F11 produz essas instalações; o passo 5 troca o texto que ainda as sugere.

**Escolha do artefato** (item 1 da investigação, testada em 2026-11-21 no ramo `docs/f11-repo-channel` sobre `21243b690`,
versão 1.6.0, `npm run release:local -- --out ~/.local/share/nycode-mig/rel/r1 --force --skip-check --skip-test`, exit 0):

| Opção | Resultado medido | Veredito |
|---|---|---|
| (a) binário `bun` autocontido (`scripts/build-binaries.sh`, `nycode-<plataforma>.tar.gz`/`.zip`) | `node:22` limpo: `tar -xzf nycode-linux-x64.tar.gz && nycode/nycode --version` imprime `1.6.0`. 59 MB; sem Node, sem `npm install`, sem rede | **escolhida** |
| (b) tarballs dos 11 pacotes públicos instalados juntos | `npm i -g --ignore-scripts /t/*.tgz` no `node:22` instala e `nycode --version` imprime `1.6.0`; 17 MB, mas exige baixar 11 arquivos com hash no nome e `nycode update` do `npm` pediria o registro | só para desenvolvimento (`release:local`, `use-local-packages.mjs`); não vai ao Release |
| (c) tarball de `@nycode/coding-agent` sozinho | `npm i -g /t/nycode-coding-agent-*.tgz`: `E404 GET https://registry.npmjs.org/@nycode%2fagent-core`; `bundleDependencies` exigiria reescrever o `package.json` de um pacote já com 5 dependências `@nycode/*` | descartada |

`release:local` também gera `node/nycode` (a opção b instalada, `--version` = `1.6.0`) e `bun/nycode` (a opção a, `--version`
= `1.6.0`). O `release:local` completo roda `generate:models` e `./test.sh`; com `--skip-check --skip-test` ele só provou
empacotamento e instalação, então o passo 7 roda sem esses dois cortes. Binários de `darwin-*`, `windows-*` e `linux-arm64`
saem do mesmo `bun build --compile` cruzado, mas só `linux-x64` foi executado aqui; os outros ficam com a matriz de fumaça
do passo 3 (macOS e Windows hospedados).

**Proveniência sem npm:** `actions/attest` na versão estável `v4.2.2`
(`1e69f48acb82d1966a394da916b4c1698aa569d6`; `actions/attest-build-provenance` `v4.2.2`,
`4d101475d8b20a2381f78447822ac1eab6504dd8`, é só um invólucro dela desde a versão 4 e "novas implementações devem usar
`actions/attest`"). Permissões: `id-token: write`, `contents: read`, `attestations: write`; entrada `subject-path`.
Verificação: `gh attestation verify <artefato> -R marcioazam/nycode`. Fonte:
<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations> e
<https://github.com/actions/attest-build-provenance> (leitura de 2026-11-21; SHAs por `gh api repos/<repo>/git/ref/tags/<tag>`).

**Passos** (um PR cada, salvo indicação):

1. **`release.mjs` sem npm e sem empurrar para a `main`.** Tirar `assertPackagesAreRegisteredWithNpm` (anexo B §5) e o
   que restava do passo do catálogo do Nix (só um comentário e uma mensagem: o código que fixava `nix/model-catalog.json` já
   tinha saído), e parar no commit `Release vX.Y.Z` do ramo atual: o ruleset da
   `main` exige PR e não tem exceção, então `git push origin main` seria recusado. A etiqueta `vX.Y.Z` é criada no commit
   que o squash deixou na `main`, depois do merge (`git tag -a v2.0.0 <sha> && git push origin v2.0.0`). O commit
   `Add [Unreleased] section for next cycle` vai em outro PR, depois da etiqueta, feito à mão (o skill `release.md` descreve):
   `addUnreleasedSection` saiu do script. Remover `scripts/publish.mjs`,
   `publish-model-catalog.mjs` e `publish-release-announcement.mjs` (com os testes), que falam com o registro npm e o R2
   do upstream, e os scripts `publish*` do `package.json` raiz.
2. **Nix (P-18): remover da distribuição** (`flake.nix`, `nix/package.nix`, a seção "Run with Nix" do `README.md`).
   Justificativa: `npm run build:offline` precisa dos dados de modelo hidratados pela rede e o build do Nix é isolado,
   então não constrói desde o K15; não há `nix` nesta máquina nem workflow para provar um conserto; manter exigiria
   versionar um instantâneo do catálogo de modelos só para um canal sem uso medido. Reversão: `git revert`, o conteúdo
   volta do histórico. Reabrir por pedido do dono com a opção "instantâneo versionado".
3. **Workflow `.github/workflows/publish.yml`**, a partir do `build-binaries.yml` removido
   (`git show f523ebd25^:.github/workflows/build-binaries.yml`, que já tinha o rascunho de Release, a matriz de fumaça
   `ubuntu`/`macos`/`windows` e o `smoke-test-codemode-binary.mjs`), sem o `publish-npm` e o R2. Disparo `on: push: tags:
   ['v*']` (mais `workflow_dispatch` com a etiqueta, para recuperação). Regras do `run-security.sh`: `permissions: {}` no
   topo, actions por SHA de 40 hex, sem `pull_request_target` nem `workflow_run`, executor hospedado pelo GitHub,
   `persist-credentials: false`, `bun-version` fixa. Jobs: `build` (`contents: read`; `hydrate:model-data`,
   `create-source-archive.sh`, `build-binaries.sh --offline-model-data` para os 6 alvos, `SHA256SUMS`, `upload-artifact`);
   `smoke` (matriz de 3 SOs: extrai o arquivo da plataforma e roda `--version`); `release` (`contents: write`,
   `id-token: write`, `attestations: write`; baixa os artefatos, `actions/attest@1e69f48…` com `subject-path` nos 6
   arquivos, no `.tar.gz` do código-fonte e no `SHA256SUMS`, cria o Release como rascunho com `RELEASE_NOTES.md`, sobe os
   ativos e só então o publica). O único segredo é o `GITHUB_TOKEN` do próprio run. Validar com `actionlint`, `zizmor
   --min-severity medium` e `bash scripts/ci/run-security.sh` (o PR passa por `ci-security`).
4. **Binários:** `scripts/build-binaries.sh` já cobre os 6 alvos e é o que o workflow chama. O laço "Copy shared files" ganha
   `cp -r resources` (costura K6): sem isso o binário não acha `dirname(execPath)/resources` e nega toda ferramenta. O
   `README.md` "Building standalone binaries" passa a dizer que os binários vêm do Release.
5. **README de instalação, aviso de versão e autoatualização:** `README.md` (seção "Getting started" e "Supply-chain
   hardening", que hoje dizem "Nothing is published yet") e `packages/coding-agent/docs/quickstart.md:12,15,115` passam a
   baixar `nycode-<plataforma>` do Release, conferir `SHA256SUMS` e `gh attestation verify`. `package-manager-cli.ts:1196-1197`
   (aviso de instalação `npm`) e o comentário de `:229-231` ("not published yet (F11)") deixam de citar a publicação
   futura; o texto de `config.ts:371` já está certo. Sem mudar a lógica do aviso de versão; um teste novo confirma que
   `nycode update` de um binário imprime a URL do Release.
6. **Skill `.nycode/skills/release.md` (P-7):** reescrever os passos 3 a 6 (citam `build-binaries.yml`, `nix.yml`, `npm`,
   R2 e `pi.dev`) para o fluxo: PR de versão por `release.mjs`, merge por squash, etiqueta no commit da `main`, run de
   `publish.yml`, verificação. O skill diz "No major releases" e D-13 exige `2.0.0`: registrar a exceção no PR e no skill.
7. **Versão `2.0.0` [AUTORIZAÇÃO coberta pela D-42], só com o `release:local` completo verde:**

   ```bash
   systemd-run --user --scope --slice=build.slice --quiet --collect -- \
     npm run release:local -- --out ~/.local/share/nycode-mig/rel/r2 --force
   ~/.local/share/nycode-mig/rel/r2/node/nycode --version && ~/.local/share/nycode-mig/rel/r2/bun/nycode --version
   NYCODE_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:major   # ramo release/v2.0.0, sem push
   ```

   Abrir o PR de versão, fundir (squash), criar e empurrar a etiqueta `v2.0.0` no commit da `main` e acompanhar o run
   (`gh run watch`). A publicação do Release sem nova pergunta é a D-42.
8. **Fumaça em contêiner limpo, do Release publicado (fora do CI):**

   ```bash
   docker run --rm node:22 sh -c 'set -e; cd /tmp; b=https://github.com/marcioazam/nycode/releases/download/v2.0.0
     curl -fsSLO "$b/nycode-linux-x64.tar.gz"; curl -fsSLO "$b/SHA256SUMS"
     grep " nycode-linux-x64.tar.gz\$" SHA256SUMS | sha256sum -c -
     tar -xzf nycode-linux-x64.tar.gz; nycode/nycode --version'    # esperado: 2.0.0
   gh release download v2.0.0 -R marcioazam/nycode -p nycode-linux-x64.tar.gz -D /tmp/f11v   # no host, gh >= 2.49
   gh attestation verify /tmp/f11v/nycode-linux-x64.tar.gz -R marcioazam/nycode
   ```

9. **Limpeza de `import/` (C-F11-10):** `git rm import/ny-pi/install.sh import/ny-pi/publish.list` e `git rm -r
   import/ny-pi/npm`, em PR próprio (o `install.sh` instalava o pi por symlinks; o fluxo do nycode é o do Release).

**Verificação de saída:** `gh release view v2.0.0 -R marcioazam/nycode --json assets,isDraft,isPrerelease --jq
'{draft:.isDraft,pre:.isPrerelease,assets:[.assets[].name]}'` lista os 6 arquivos, o código-fonte, `SHA256SUMS` e
`isDraft=false`; o contêiner imprime `2.0.0`; `gh attestation verify` sai com 0 para cada arquivo.

**Evidência:** `evidencias/F11.md` com a saída do `release:local` completo e do contêiner, o link do run de
`publish.yml`, a saída de `gh attestation verify`, o SHA do commit de `release.md` e os do PR de remoção de `import/`.
**Reversão:** o Release é um objeto do GitHub: `gh release delete v2.0.0 --cleanup-tag -R marcioazam/nycode` o retira
(sem imutabilidade de Release ligada em 2026-11-21: `repos/marcioazam/nycode/immutable-releases` devolve `enabled: false`) e a
correção sai como `2.0.1`. A atestação continua nos registros públicos do Sigstore depois de apagar o Release (limite do
serviço, não verificado). A remoção do Nix e o `release.mjs` novo revertem por `git revert`.

<a id="f12"></a>

## F12. Corte e descomissionamento

**Objetivo:** migrar os dados do dono, conviver por um período, arquivar o ny-pi e remover `import/ny-pi/`.

**Pré-condições:** F11 fechada; `nycode --version` instalado pelo canal de F11; resposta de D-22.

**Passos:**

1. **Migração de dados do dono** (K12); `auth*.json` só com confirmação interativa:

   ```bash
   nycode migrate from-pi                # padrão: dry-run, não escreve
   nycode migrate from-pi --apply        # flag proposta; backup em ~/.nycode/agent/.backup-from-pi/<timestamp>/
   test -d ~/.pi/agent && echo "origem intacta"
   ```

   Compatibilidade dos arquivos de sessão do pi 1.5.2 com o 1.6.0: não verificado (abrir uma sessão antiga).
2. **Convivência:** trocar o `pi` do dia a dia por `nycode`, mantendo o wrapper `~/.local/bin/pi` por um período de
   observação do dono (sugestão: 2 semanas, **proposta**); falhas vão a `evidencias/F12.md`. O ny-pi segue congelado.
3. **[AUTORIZAÇÃO] D-22, arquivar o ny-pi (não apagar).** Antes, um PR no ny-pi (exceção ao congelamento) com o
   aviso abaixo no topo do `README.md`. O ruleset do ny-pi exige `ci-static`, `ci-security`, `instruction-budget` e
   `bench-pr` (anexo A §6); `bench-pr` é postado localmente, então o poller fica ligado até o merge.

   ```markdown
   > **Este repositório está arquivado.** O ny-pi foi incorporado ao core do
   > [nycode](https://github.com/marcioazam/nycode). Baixe o binário em <https://github.com/marcioazam/nycode/releases>.
   > **This repository is archived.** ny-pi now lives in the core of nycode.
   ```

   Depois do merge: `gh api -X PATCH repos/$ORIGREPO -F archived=true` (campo: não verificado; alternativa
   `gh repo archive $ORIGREPO --yes`) e `gh api repos/$ORIGREPO --jq .archived` (esperado `true`).
4. **Remover `import/ny-pi/`**, já esvaziado por F2 a F11 (as exclusões de F1 passo 4 podem ficar): ramo
   `mig/f12-remove-import`; `find import/ny-pi -type f | wc -l` (o que sobrou tem destino em 03 ou justificativa);
   `git rm -r import/ny-pi`, commit `docs: remove import/ny-pi after migration (history stays in git)`; critério
   global 2 (00 §8, D-41): `python3 scripts/ci/lint/criterio2/criterio2.py` termina em `criterio2 OK`.
5. **Fechar o checklist** [12](12-checklist-mestre.md) em 100%, com a sincronização com o upstream executada ao menos 2
   vezes depois de F6 (critério 7) e a política de sincronização em `docs/fork/` ([08](08-sincronizacao-upstream.md)).
   **[AUTORIZAÇÃO]** atualizar a descrição e os tópicos do repositório (`gh repo edit $UP --description "..."`).

**Verificação de saída:** `gh api repos/$ORIGREPO --jq .archived` devolve `true`; `test ! -d import/ny-pi`;
`git log --follow --oneline packages/coding-agent/src/extensions/plan-gate/index.ts | tail -1` mostra o commit original.

**Evidência:** dry-run e aplicação (sem segredos), datas da convivência, SHA do PR de aviso no ny-pi, resposta de
`.archived`, SHA da remoção de `import/ny-pi/`, checklist fechado. **Reversão:** desarquivar é ação do dono
(`archived=false`); `import/ny-pi/` volta por `git revert` do PR de remoção.

<a id="se-der-errado"></a>

## Se der errado

1. **Merge de F1 recusado pelo ruleset ("squash only").** O ruleset entrou antes de F1. Não contornar: pedir ao dono
   que ponha o ruleset em `enforcement=disabled`, fundir com `--merge`, reativar e registrar; nunca `--admin`.
2. **Check obrigatório fica "esperando" e nunca reporta.** Falta o gatilho `merge_group` no workflow, ou o poller do
   `bench-pr` está parado: conferir o `on:` e `systemctl --user status bench-pr.timer`; repostar com
   `bash bench/tools/bench-pr.sh --pr <n>`.
3. **`git filter-repo` recusa ("refusing to destructively overwrite repo").** O clone não é novo ou foi feito com
   `--local`: `rm -r /tmp/ny-pi-import` (caminho exato) e repetir `git clone --no-local`.
4. **`git log --follow` mostra só o merge.** O PR de F1 foi por squash ou o filtro não foi aplicado:
   `git rev-list --parents -n1 origin/main` precisa de 2 pais; se foi squash, `git revert` e refazer com `--merge`.
5. **`patch -N` recusa em F5 ("Reversed or previously applied").** Ordem diferente (idioma) ou árvore suja:
   `export LC_ALL=C`, refazer `tar -xzf` em pasta vazia, reaplicar e rodar `check-patch-stack.sh`.
6. **`diff -r` contra o pi-code instalado não é vazio.** A instalação do dono tem patch local não versionado ou
   `node_modules`: `diff -rq`, decidir arquivo a arquivo, registrar o desvio e não importar antes de resolver.
7. **`npm run check` falha em `check:pinned-deps` ou `check:ts-imports` depois de F1.** Os dois varrem `"."` e
   alcançam `import/`: acrescentar `"import"` a `ignoredDirectories` nos dois (F1 passo 4).
8. **`build-check` falha em `check:released-changelogs`.** A etiqueta `v1.6.0-base` não existe ou diverge do
   `CHANGELOG.md`: `git ls-remote --tags origin 'v*.*.*'` e criar a etiqueta (F0 passo 8).
9. **Braço `ny-pi-pi160` sai com código 2 nos patches de core.** Esperado: os 2 patches de `dist` só aplicam em pi
   1.5.2. Registrar como parte do resultado de D-25; não "consertar" o patch.
10. **`publish.yml` falha ou o Release fica em rascunho.** Etiqueta `v*` criada em commit que não é o da `main` com a
    versão, ou permissão faltando no job `release` (`contents: write`, `id-token: write`, `attestations: write`): ler o log
    do run, `gh release delete v2.0.0 --cleanup-tag` se o rascunho ficou, corrigir pelo PR e reetiquetar; nunca rodar
    `release.mjs` de novo para a mesma versão.
Falha fora da lista: reproduzir, uma hipótese, uma nova tentativa; depois parar e avisar o dono ([10](10-riscos-e-rollback.md)).
