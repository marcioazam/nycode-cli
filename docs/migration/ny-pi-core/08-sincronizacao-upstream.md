# Sincronização com o upstream (earendil-works/pi)

Política para o nycode continuar recebendo o upstream durante e depois da migração. O registro do fork
(`docs/fork/2026-11-20-fork-do-pi.md`) não tem esta política (lido inteiro em 2026-11-20); este documento a cria.
Decisões citadas: [D-06, D-07](11-decisoes-e-pendencias.md). Costuras K1..K14: [02, seção 4](02-arquitetura-alvo.md).
Estado: **proposta, ferramentas criadas** (C-F6-17, PR A, 2026-11-21). Existem `scripts/fork/{all,image,test_reproduction}.sh`,
`scripts/fork/seams.txt`, `scripts/ci/seams/check-seams.sh`, `docs/fork/sync-pr-template.md` e `docs/fork/syncs/`; o job
`merge-policy` já existe (`.github/workflows/merge-policy.yml`). Nenhuma sincronização foi feita ainda: o restante
desta política continua proposta.

Convenção de rótulos: "medido" = comando rodado em 2026-11-20 e descrito no texto; "documento" = vem dos documentos
canônicos do plano; "não verificado" = não foi possível conferir.

## 1. Fatos

### 1.1 Base do fork

| Fato | Valor | Fonte |
|---|---|---|
| Commit base | `073b0bae8488ee20def26e873b77036dac4e9eea` (2026-11-20 19:49 UTC) | medido: `gh api` e `git cat-file` |
| Versão dos pacotes | 1.6.0 | medido: `git show 073b0ba:packages/coding-agent/package.json` |
| Tag `v1.6.0` | `faac585884ae` (completo no log da coleta), ancestral do commit base | medido: `git merge-base` |
| Distância da tag | O commit base está 28 commits depois de `v1.6.0` | medido: `git log up-v1.6.0..073b0ba` |
| Renome | `f523ebd25` mudou 2316 arquivos (+15151/-17891), pai `4ecc500eb7` | medido: `git show --stat` |
| HEAD do worktree | `fb05db936` (merge do PR #194) | medido |
| Remoto do repositório | só `origin` = `https://github.com/marcioazam/nycode.git` | medido: `git remote -v` |

### 1.2 O remoto `upstream` não existe

- `/home/marcio/source/nycode-cli` não é repositório bare: contém só `MOVED.md`, que diz que o diretório foi
  renomeado para `/home/marcio/source/nycode` (medido: `ls`, `git --git-dir` falhou com "not a git repository").
- `/home/marcio/source/nycode` e o worktree `nycode.wt/migration` têm apenas `origin`. Não há remoto `upstream` em
  nenhum dos dois (medido: `git remote -v`). O objeto do commit base existe porque o histórico do upstream veio junto.
- O nome do repositório no GitHub é `marcioazam/nycode`; o registro do fork ainda diz `marcioazam/nycode-cli`
  (documento). A diferença é um resíduo de nome; a política usa o remoto real.

### 1.3 Ritmo do upstream (coleta em 2026-11-20)

Commits em `main` por semana ISO, por data do committer
(`gh api --paginate 'repos/earendil-works/pi/commits?per_page=100&since=2026-09-01T00:00:00Z'`, 1960 commits):

| Semana | W36* | W37 | W38 | W39 | W40 | W41 | W42 | W43 | W44 | W45 | W46 | W47* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Commits | 108 | 67 | 102 | 83 | 182 | 131 | 131 | 116 | 230 | 337 | 331 | 142 |

\* W36 começa antes do corte `since` (parcial); W47 vai só até sexta 2026-11-20 (parcial). A consulta curta pedida
(`per_page=100` sem paginar) cobre apenas 2026-11-17 a 11-20 (100 commits: 7, 21, 17 e 55 por dia): serve só como
amostra do dia, não do ritmo. Média das quatro últimas semanas completas (W43 a W46): 253,5 commits por semana.

Versões (`gh api repos/earendil-works/pi/releases?per_page=10`, nenhuma `prerelease`):

| Tag | Publicada (UTC) | Dias desde a anterior |
|---|---|---|
| v1.6.0 | 2026-11-20 11:35 | 10,0 |
| v1.5.2 | 2026-11-10 12:25 | 0,5 |
| v1.5.1 | 2026-11-09 23:47 | 7,5 |
| v1.5.0 | 2026-11-02 11:05 | 11,5 |
| v1.4.0 | 2026-10-21 22:49 | 6,1 |
| v1.3.0 | 2026-10-15 19:17 | 2,8 |
| v1.2.0 | 2026-10-12 23:03 | 5,0 |
| v1.1.0 | 2026-10-07 22:26 | 2,0 |
| v1.0.4 | 2026-10-05 22:03 | 0,6 |
| v1.0.3 | 2026-10-05 08:38 | — |

Intervalo médio entre as 10 versões: 5,1 dias (46 dias entre `v1.0.3` e `v1.6.0`). Isto é cadência de lançamento; não
indica estabilidade de cada versão (não verificado).

### 1.4 Tamanho do delta semanal

`git diff --shortstat` entre o último commit anterior à data de corte e o commit base (medido, só upstream):

| Janela até 2026-11-20 | Arquivos mudados | Linhas |
|---|---|---|
| 7 dias | 944 | +72333 / -8379 |
| 14 dias | 1678 | +188897 / -15407 |
| 21 dias | 3549 | +469495 / -55686 |

Dos 944 arquivos da última semana: `apps/p2` 254, `apps/p3` 220, `packages/chord` 195, `packages/coding-agent` 79,
`packages/durable` 74, `packages/ai` 55. A maior parte do delta cai em diretórios que o plano não toca (D-23); as
costuras ficam em `packages/coding-agent`, `packages/mcp` e `packages/tui`.

Estado atual: o `main` do upstream está 8 commits e 22 arquivos à frente do commit base
(`gh api repos/earendil-works/pi/compare/073b0ba...main`, `ahead_by=8`, tip `e98e59334d9c`; medido).

## 2. Modelo adotado (D-07, alternativa A)

### 2.1 Peças

- **Espelho:** ramo `upstream/main` no `origin`. Somente leitura: só recebe avanço rápido (fast-forward) vindo de
  `git fetch upstream`, nunca commit do nycode, sem exclusão e sem push forçado.
- **Remoto:** `upstream` = `https://github.com/earendil-works/pi.git`, adicionado uma vez por clone (passo 1, seção 6).
- **Ramo de trabalho:** `sync/upstream-AAAA-MM-DD`, nasce de `origin/main` e recebe a fusão e as correções.
- **Fusão:** `git merge --no-ff` (merge commit); nunca rebase nem cherry-pick.
- **PR:** base `main`, método **merge**. É o único tipo de PR que usa merge; o resto continua squash.
- **Job `merge-policy`:** roda em todo push em `main`; especificação na seção 4.3.

O ramo `upstream/main` do `origin` e o ref local `refs/remotes/upstream/main` (do remoto `upstream`) são refs
diferentes. Para evitar ambiguidade, os comandos usam `origin/upstream/main` e `refs/remotes/upstream/main`.

### 2.2 Por que squash quebra o ancestral comum

A fusão de duas linhas usa o ancestral comum mais recente (merge base) como referência de três vias. Um PR com squash
grava um commit novo com um só pai, `main`: o conteúdo do upstream entra, mas o commit do upstream não passa a ser
ancestral de `main`. Na sincronização seguinte o merge base continua sendo o commit antigo, e tudo o que o nycode já
resolveu volta a aparecer como diferença entre as duas linhas, conflitando de novo. Com merge commit, o segundo pai
liga `main` ao upstream e o merge base avança. O `rebase` tem o mesmo defeito do squash (reescreve os commits, que
ganham novos hashes). Origem da regra: [D-07](11-decisoes-e-pendencias.md). Fonte externa: nenhuma (P-5); o argumento
é o funcionamento do git.

### 2.3 Alternativas descartadas

- **B.** Histórico linear e `cherry-pick -x` do intervalo do upstream. Mantém a regra linear, mas resolve conflito
  commit a commit (centenas por semana, seção 1.3) e o merge base não avança.
- **C.** Pilha de patches sobre o upstream (modelo VSCodium). É o modelo "por fora" que a migração abandona
  (princípio 4 do mega plano).

### 2.4 O que continua estrito

Sem exclusão de ramo, sem push forçado, PR obrigatório, conversas resolvidas, checks obrigatórios com ramo atualizado,
sem ator com dispensa (D-07). O afrouxamento é só `required_linear_history` e o método `merge` permitido.

## 3. Cadência

- **Rotina:** uma sincronização por semana, em dia fixo. Sugestão: segunda-feira; o CONTRIBUTING do upstream diz que
  issues de sexta a domingo podem não ser revisadas, então a segunda concentra a resposta a pedidos nossos.
- **Antes de abrir fase:** sincronizar antes de F4 a F11 e registrar o SHA no `evidencias/F<n>.md`. Uma fase não
  começa sobre base mais velha que 7 dias.
- **Alvo:** por padrão, a ponta de `main` do upstream. Se a ponta estiver instável, a última tag `v*` (cadência de
  5,1 dias, seção 1.3). A escolha fica registrada na fusão.
- **Atraso máximo:** 14 dias. Passou disso, a sincronização vem antes de qualquer outro PR de migração. Medido: 14 dias
  valem 1678 arquivos e 21 dias valem 3549 (seção 1.4); o custo cresce mais que linearmente.
- **Urgência:** correção de segurança do upstream sincroniza em até 2 dias úteis, fora da rotina.

Os números 7 e 14 dias são propostas deste plano, não medições; revisar com as métricas da seção 9 depois das duas
primeiras sincronizações.

<a id="costuras"></a>

## 4. Costuras

Costura é uma edição do nycode dentro de arquivo do upstream. A lista é fechada: são as 14 de
[02, seção 4](02-arquitetura-alvo.md), mais as costuras do renome (seção 4.3).

### 4.1 Tabela de costuras K1..K14

Frequência medida em 2026-11-20 com `git log --oneline --since='3 months ago' 073b0ba -- <arquivo>` (só commits do
upstream, antes do renome; inclui merges; coluna 1m = `--since='1 month ago'`). Sem a ponta `073b0ba` o comando pedido
(`git log` a partir de HEAD) também conta o renome `f523ebd25` em todo arquivo. "Região" = commits dos últimos 3 meses
cujo diff contém uma linha casando o termo (`git log -G`, aproximação; não é `git log -L`). Critério de risco: alto =
20 ou mais commits no arquivo ou edição numa região que muda; médio = 8 a 19; baixo = 7 ou menos e região estável.

Abreviação: `CA` = `packages/coding-agent/src`; `core/` e `cli/` abaixo são de `CA`.

| # | Arquivo | Natureza da edição | 3m / 1m | Região | Risco |
|---|---|---|---|---|---|
| K1 | `CA/core/sdk.ts:370` | Troca expressão de comparação | 12 / 3 | 1 (`.every(`) | médio |
| K2 | `packages/mcp/src/transports/stdio.ts:10` | Troca constante 500 por 100 | 3 / 2 | 1 | baixo |
| K3 | `CA/cli/args.ts` | Acrescenta 4 flags | 20 / 5 | 0 (`approve`) | alto |
| K4 | `core/settings-schema.ts` e `-defaults.ts` | Blocos novos, 3 padrões | 5+3 / 3+1 | 1 | médio |
| K5 | `CA/extensions/index.ts` | Uma linha por extensão | 2 / 0 | n. med. | baixo |
| K6 | `CA/core/resource-loader.ts` | Escopo `builtin` | 11 / 3 | n. med. | médio |
| K7 | `CA/core/system-prompt.ts` | Seção `docs`, instruções | 8 / 1 | n. med. | médio |
| K8 | `CA/core/tools/bash.ts` | Limite padrão e teto | 12 / 3 | n. med. | médio |
| K9 | `CA/core/compaction/` | Limite absoluto de contexto | 15 / 4 | n. med. | médio |
| K10 | `packages/tui/src/` | API pública nova | 91 / 30 | n. med. | alto |
| K11 | `core/permissions/` (novo) + gancho `tool_call` | Arquivo novo, 1 chamada | novo | indef. | médio |
| K12 | `CA/main.ts` (ramo `migrate`; o importador mora em `CA/migrations/from-pi.ts`) | Uma chamada ao importador | n. med. | n. med. | baixo |
| K13 | `packages/coding-agent/package.json` (`files`) | Inclui `resources/` | 50 / 11 | 0 | médio |
| K14 | `CA/config.ts:605` | "π" de reserva vira "nycode" | 12 / 2 | 0 (`APP_TITLE`) | baixo |

Legenda: 3m/1m = commits em 3 meses e em 1 mês; Região = commits dos 3 meses cujo diff casa o termo (aproximação por
`git log -G`); n. med. = região não medida; indef. = ponto do gancho ainda não decidido.

Justificativas que a tabela não comporta:

- K1, K2: a linha editada quase nunca muda (1 commit na região em 3 meses), embora o arquivo mude. K1 é médio, e não
  baixo, porque `sdk.ts` tem 12 commits e a expressão fica no bloco que decide o reaproveitamento de cache, que o
  upstream pode reescrever por inteiro; K2 é uma constante isolada em arquivo pouco mexido.
- K3: `args.ts` é o arquivo mais mexido entre as costuras de CLI (20 commits em 3 meses, 5 no último) e as flags novas
  entram no mesmo `switch` em que o upstream acrescenta as suas.
- K10: 91 commits em 3 meses no diretório inteiro; porém a edição é adição em arquivos novos mais uma linha de
  exportação em `index.ts`. O conflito esperado fica na linha de exportação; o risco alto é de frequência, não de
  sobreposição.
- K11: o arquivo do gancho em `tool_call` não está definido no documento (arquitetura alvo diz só "gancho"); candidatos
  por tamanho e frequência: `core/extensions/types.ts` (2358 linhas, 31 commits em 3 meses) e `runner.ts` (1576 linhas,
  13). Fechar em F8 e reclassificar; até lá, não verificado.
- K13: o arquivo muda muito (dependências, versão), mas a chave `files` não foi tocada em 3 meses (0 commits). O risco
  real é de merge textual em JSON: o git funde por linha, e a vizinhança de `files` é estável.
- K5: só 2 commits em 3 meses, mas o arquivo tem 14 linhas; duas adições vizinhas conflitam sempre. Cada extensão
  nova entra em linha separada, em ordem alfabética, para o conflito ser trivial.
- K9 e K8: o limite de compactação e o limite do `bash` ficam em funções que o upstream retoca com frequência média;
  a mitigação é função nova em arquivo novo.

### 4.2 Como reduzir cada costura

Regras gerais, aplicadas a todas as 14 (proposta; o verificador `scripts/ci/seams/check-seams.sh` e a lista
`scripts/fork/seams.txt` existem desde C-F6-17; o verificador mora em `scripts/ci/seams/` porque `scripts/ci/` já tem 7
arquivos de código, o limite de `structure_changed.py`):

1. **Marcador.** O ponto editado leva o comentário `// nycode: K<n> <motivo em uma linha>`. Em JSON (K13), que não
   aceita comentário, o marcador vai para o teste e para `seams.txt`.
2. **Uma linha no arquivo do upstream.** A lógica nova mora em arquivo novo (`core/permissions/`, `extensions/<nome>/`,
   `migrations/from-pi.ts`, `tui/src/<dir novo>/`); o arquivo do upstream só ganha uma chamada ou um registro.
3. **Teste que falha se a costura sumir.** Se uma fusão resolver o conflito a favor do upstream e apagar a costura, o
   teste da unidade quebra. `check-seams.sh` confere que cada `K<n>` de `seams.txt` aparece no código e que os
   testes abaixo existem.

Para cada costura: como reduzir (arquivo novo e chamada única) e o teste que falha se ela sumir.

- **K1.** Implementada em F4 com a função `nycodeSameContextMessage` **no próprio `sdk.ts`** (não em arquivo novo): `.every`
  a chama. Mover a função para arquivo novo de `core/` reduziria o conflito; fica como melhoria, sem prazo.
  Teste: `cache-warm-identity` portado (F4).
- **K2.** Constante: sem arquivo novo possível; marcador na linha com a razão. Teste: `mcp-close-grace` portado (F4).
- **K3.** Tabela de flags do harness em arquivo novo; `args.ts` recebe uma chamada que a registra. Teste: `args` com as
  4 flags.
- **K4.** Chaves do harness num esquema novo (`harness-schema.ts`) composto em `settings-schema.ts` por uma linha; os 3
  padrões numa tabela nova. Teste: padrões de `defaultProjectTrust`, `quietStartup` e `retry`.
- **K5.** Uma linha por extensão, em ordem alfabética, num bloco com marcador. Teste: lista as `builtin:` esperadas.
- **K6.** Resolução do escopo `builtin` em arquivo novo; `resource-loader.ts` chama uma função. Teste: carregador com
  recurso embarcado de menor precedência.
- **K7.** Montagem das seções novas em arquivo novo; `system-prompt.ts` recebe uma chamada. Teste: prompt com a
  seção `docs` em uma linha.
- **K8.** Política de tempo limite em arquivo novo; `bash.ts` a chama. Teste: `bash` com 600 s padrão e teto 1800 s.
- **K9.** Regra do limite absoluto em arquivo novo dentro de `core/compaction/`. Teste: `compact-at-400k` portado.
- **K10.** API pública em arquivos novos de `packages/tui/src/`, mais uma linha de exportação. Teste: teste da API e
  `check-entry-graphs` do repositório (documento: anexo B, seção 1).
- **K11.** Motor inteiro em `core/permissions/`; o gancho é uma chamada. Teste: diferencial dos dois motores (D-08).
- **K12.** `migrations/from-pi.ts`; a chamada (`runMigrateCommand`) está em `main.ts`, no ramo `args[0] === "migrate"`, e não
  em `migrations.ts` como a arquitetura alvo previa. Teste: `from-pi-apply.test.ts` e os demais de `test/harness/migrations/`.
- **K13.** JSON não aceita comentário: marcador só em `seams.txt`. Teste: `check-package-install` falha sem
  `resources/` no pacote (documento: arquitetura alvo, seção 8).
- **K14.** Uma string: marcador na linha. Teste: `--version` e `--help` com `HOME` isolado (critério do registro do
  fork).

### 4.3 Costuras do renome

O commit `f523ebd25` mudou 2316 arquivos. Isso não é uma costura localizada: é uma divergência em toda a árvore. Todo
`git merge` direto do upstream conflita com o renome, a menos que o lado do upstream seja renomeado **antes** da fusão.

D-30 (2026-11-20) amplia o renome aos internos (identificadores, comentários, testes, links e `pi.dev`): as regras novas
entram em `scripts/fork/rename.py` (R1 de P-17), e cada sync renomeia o lado do upstream com elas antes da fusão, como
já faz com os nomes de pacote.

#### O que o renome é, de fato (medido)

O registro do fork diz "Script: `/tmp/nycode-rename/rename.py` (+ `post.sh`), determinístico". Verificação em
2026-11-20:

- O script ainda existe, mas só em `/tmp/nycode-rename/` (122 linhas, sha256
  `b69479192fa9e7eeeaf720517facb32df003dc331dfe48e2ec5d0340d8de2c46`), junto de `post.sh`, `post2.sh`, `all.sh` e logs.
  **Nenhum deles estava no repositório** (`git ls-files` não lista `rename`, e não existe `scripts/fork/`). `/tmp` é
  volátil: perdê-lo perde a única definição do renome.
- O renome não é só o `rename.py`. `all.sh` roda: `git rm` de 14 workflows, `rename.py`, `post.sh` (edições `sed`
  em arquivos nomeados à mão), `npm install --package-lock-only`, `generate-coding-agent-install-lock.mjs`. O registro
  do fork acrescenta o `biome --write`, que reformatou 175 arquivos em `packages/` e 49 em `apps/p2`. `post2.sh`
  (restaura `from earendil-works/pi` em 8 arquivos de `apps/p2/plugins` e `apps/p2/src`) não era chamado por `all.sh`.
  Verificado em 2026-11-21 (seção 4.3.1): a ordem `all.sh` (workflows, `rename.py`, `post.sh`, `post2.sh`, locks) e
  depois `biome` reproduz `f523ebd25`; `post2.sh` repete os dois últimos `sed` de `post.sh` e não muda o resultado.
- Fidelidade medida: num clone temporário (removido depois) do commit base, `git rm` dos 14 workflows, `rename.py` e
  `post.sh` produziram uma árvore que difere de `f523ebd25` em 230 de 2316 arquivos: 2 lockfiles, 224 esperados do
  `biome` e do `post2.sh` (a divisão entre os dois não foi medida), mais cerca de 4 não explicados (um é `NOTICE`;
  não verificado). Resolvido em 2026-11-21 (seção 4.3.1): os locks saem idênticos quando `P` os regenera, o `post2.sh`
  não tem efeito, 226 arquivos são do `biome` e os 2 restantes são `NOTICE` e `docs/fork/2026-11-20-fork-do-pi.md`,
  escritos à mão no commit de renome. O procedimento completo está agora em um só script (`scripts/fork/all.sh`).
- As edições `sed` de `post.sh` citam arquivos por nome. Se o upstream apagar ou mover um deles, o script falha
  (`set -e`). O script versionado precisa ser reescrito para ser dirigido por regras e tolerar arquivo ausente.

**Pendência crítica (nova, PC-1):** versionar o pipeline de renome em `scripts/fork/rename.py` (mais `post.sh`
fundido nele e a ordem do `biome`) **na F0**, com teste de reprodução do `f523ebd25`.
Sem isso, nenhuma das duas opções abaixo é executável com garantia, e o objetivo 5 do mega plano (receber o upstream
com custo controlado) fica sem dono.

#### 4.3.1 Pipeline versionado e reprodução medida (C-F6-17, 2026-11-21)

`scripts/fork/all.sh ROOT` é o `P`: remove os 14 workflows da Earendil, roda `rename.py`, `post.sh`, `post2.sh`, regenera
os locks e roda o `biome` (`scripts/fork/biome.sh`: `biome check --write` na raiz, em `apps/p2` e em `apps/p3`), numa árvore
git limpa e sem caminhos fixos em `/tmp`. O `biome` é o do repositório que chama (`node_modules/.bin/biome`, versão fixada
no `package.json`; `npm ci --ignore-scripts` antes); sem ele o script falha com mensagem. O `biome` faz parte de `P` por
decisão do plano (2026-11-21): o renome do fork o rodou, e recalcular `P(U)` no `merge-policy` o inclui. `post2.sh` repete
os dois últimos `sed` de `post.sh` (idempotente). `scripts/fork/image.sh --upstream U --prev R_prev --branch NOME` gera `R`
num worktree temporário (pais `R_prev` e `U`; trailers `Upstream-Commit` e `Rename-Pipeline`, este o sha256 de
`all.sh`, `biome.sh`, `post*.sh` e `rename.py` concatenados em ordem `LC_ALL=C`, mais a versão do `biome` fixado;
qualquer mudança de P muda o trailer).

Mudança de regra: o #195 (`f76fb03b9`) renomeou o repositório para `marcioazam/nycode`; `rename.py`, `post.sh` e
`post2.sh` passaram a emitir esse nome em vez de `marcioazam/nycode-cli`, neste PR de squash, antes de qualquer fusão
(seção "Quando o script de renome muda").

Teste: `scripts/fork/test_reproduction.sh` aplica `P` a `073b0bae8` (lado upstream da base) e compara com a árvore de
`f523ebd25`. Única normalização: `marcioazam/nycode-cli` vira `marcioazam/nycode` no lado de `f523ebd25` (98 linhas), com
o `biome` reformatando as linhas que encurtam; nenhum caminho é excluído, locks inclusos. Medido em 2026-11-21, 13 a 19 s:

| Execução | Resultado |
|---|---|
| `P` sem `biome` (diagnóstico da primeira medição, antes da decisão) | 226 arquivos de conteúdo diferiam (111 em `packages/durable`, 49 em `apps/p2`, 37 em `packages/coding-agent`, o resto em 10 diretórios) |
| `P` completo (com `biome`) | 0 `M`, 0 `D`, 2 `A` (`NOTICE` e `docs/fork/2026-11-20-fork-do-pi.md`, escritos à mão); locks idênticos; exit 0 |

#### Duas opções

**(i) Fusão direta com resolução assistida.** `git merge origin/upstream/main`; os conflitos de renome são resolvidos
com `git rerere` e um script que reaplica o renome nos hunks em conflito.

- Segundo pai: o commit real do upstream; `merge-policy` só verifica ancestralidade.
- Conflito medido: **6 de 22** arquivos do delta de 8 commits (3 em `apps/p3`, `package-lock.json`,
  `packages/ai/package.json` e `packages/coding-agent/install-lock/package-lock.json`).
- Prós: simples de explicar e de validar.
- Contras: o conflito cresce com o delta semanal (944 arquivos na última semana, seção 1.4); o `rerere` só ajuda
  quando o mesmo conflito se repete, e cada semana traz texto novo; reaplicar o renome à mão é erro humano certo.

**(ii) Ramo renomeado determinístico.** Um script gera `upstream-renamed/<sha>` (a árvore do upstream já renomeada) e a
fusão é com esse ramo.

- Segundo pai: o commit imagem `R` (abaixo), não o commit do upstream.
- Conflito medido: **0** de conteúdo no mesmo delta. Houve 1 modify/delete em `docs/fork/`, artefato do experimento: a
  imagem não tinha os arquivos criados depois da base.
- Prós: o renome nunca entra na resolução; sobra só o conflito das costuras.
- Contras: depende do script versionado e determinístico (PC-1); `merge-policy` precisa recalcular a imagem; mudança
  nas regras do script altera imagens antigas.

**Recomendação:** adotar (ii), com a variante do commit imagem de dois pais; não adotar (i) como regra.

Medição das duas opções: 2026-11-20, em clone temporário removido depois. Upstream `e98e59334d9c` (8 commits à frente
da base, 22 arquivos) contra `main` `fb05db936`, com `git merge-tree --write-tree --name-only`. Para (ii) a imagem
foi gerada com `rename.py` e `post.sh` sobre o commit do upstream, com `f523ebd25` como pai (sem `biome`, sem
regenerar locks). É amostra pequena (8 commits) e aproximação do pipeline real; usar como indício, não como prova.

#### O commit imagem e o ancestral comum

Se a fusão fosse simplesmente `git merge upstream-renamed/<sha>` com um ramo sem relação de pai com o upstream, o
segundo pai deixaria de ser descendente do commit do upstream e `merge-base` não avançaria em relação ao upstream. Por
isso a opção (ii) usa um **commit imagem** `R`:

- árvore de `R` = `P(U)`, onde `U` é o commit do upstream e `P` é o pipeline de renome versionado;
- pais de `R`: primeiro `R_prev` (a imagem da sincronização anterior; na primeira vez, `f523ebd25`), segundo `U`;
- mensagem de `R` com os trailers `Upstream-Commit: <sha40 de U>` e `Rename-Pipeline: <sha256 do script>`.

Efeitos: (a) a fusão `main <- R` usa `R_prev` como merge base (já está em `main`), então o diff é
`P(U_prev) -> P(U)`, que é o delta do upstream já renomeado; (b) `U` passa a ser ancestral de `main`, e
`git rev-list main..origin/upstream/main` diz o que falta sincronizar; (c) o segundo pai do merge commit de `main` é
`R`, não `U`.

#### Especificação ajustada do job `merge-policy`

O texto de D-07 ("segundo pai alcançável a partir do espelho `upstream/main`") não vale mais para o segundo pai
direto. Regra nova, a validar em F3 e registrar como ajuste de D-07 (a decisão A não muda; muda o teste):

Para cada merge commit `M` novo em `main` (`git rev-list --merges --first-parent <antes>..<depois>`):

1. `M` tem exatamente 2 pais; o primeiro é o `main` anterior.
2. O segundo pai `R` tem exatamente 2 pais `R_prev` e `U`, e o trailer `Upstream-Commit` é igual a `U`.
3. `U` é ancestral de `origin/upstream/main` (`git merge-base --is-ancestor`), e o espelho avança só por
   fast-forward em relação ao `upstream` real (o job faz `git fetch` do upstream e confere).
4. `R_prev` é ancestral do primeiro pai de `M` (a cadeia de imagens está em `main`).
5. A árvore de `R` é igual a `P(U)` recalculada pelo job, **excluídos** os caminhos regenerados (`package-lock.json`,
   `packages/coding-agent/install-lock/`), comparando `git rev-parse R^{tree}` ou a lista de hashes por caminho.
6. O `P` usado é o de `main` antes de `M`, nunca o do ramo do PR; se o PR altera `scripts/fork/`, falha com a mensagem
   de que a mudança de pipeline entra em PR de squash separado (evita validar o PR contra o script que ele mesmo mudou).
7. Qualquer outro merge commit em `main` falha: o job abre um issue com o hash e o autor.

Limite do job: o GitHub não restringe o método de fusão por ramo de origem, então a verificação é posterior à fusão
(roda no push). O custo é um issue aberto e uma reversão por `git revert -m 1`. Não verificado: o tempo do job
(recalcular `P(U)` inclui o `biome` sobre toda a árvore).

#### Quando o script de renome muda

Uma regra nova (por exemplo, um novo nome de serviço) altera `P(U)` para todo `U`. O efeito aparece como diferença
entre `P_antigo(U_prev)` e `P_novo(U)` na sincronização seguinte: é um delta maior, revisado como mudança normal. O
PR que muda o script entra antes, em squash, junto do teste de reprodução; nunca no mesmo PR da fusão.

## 5. Resumo do desenho operacional

| Etapa | Quem | Onde |
|---|---|---|
| Buscar o upstream e avançar o espelho | executor | clone local, push com autorização (seção 6) |
| Gerar a imagem `R` | script `scripts/fork/image.sh` | ramo `upstream-renamed/<sha12>` |
| Fundir e resolver | executor | ramo `sync/upstream-AAAA-MM-DD` |
| Verificar | `gate-runner` | `npm run check`, `./test.sh`, smoke do bench |
| Fundir o PR com método `merge` | `git-delivery` | GitHub; só em verde |
| Validar a política | job `merge-policy` | push em `main` |

## 6. Procedimento de uma sincronização

Pré-requisitos: árvore limpa, `main` atualizado, `NYCODE_ALLOW_LOCKFILE_CHANGE=1` só nos commits de lockfile. Os
comandos abaixo são **propostos e não foram executados**; os que escrevem no GitHub (push, PR, merge) exigem a
autorização do dono vigente e rodam pelo `git-delivery`.

```bash
# 1. Uma vez por clone: remoto, rerere e estilo de conflito
git remote add upstream https://github.com/earendil-works/pi.git
git config rerere.enabled true
git config rerere.autoUpdate false
git config merge.conflictstyle zdiff3

# 2. Buscar e fixar o alvo (ponta do main ou uma tag)
git fetch upstream --tags --prune
U=$(git rev-parse refs/remotes/upstream/main)   # ou: git rev-list -n1 v1.7.0
S=${U:0:12}
git log --oneline "origin/main..$U" | wc -l      # tamanho do atraso: commits pendentes (anotar)

# 3. Avançar o espelho no origin (fast-forward; falha se não for)
git push origin "$U:refs/heads/upstream/main"

# 4. Gerar a imagem renomeada (R tem pais R_prev e U; ver seção 4.3)
PREV=$(git log --first-parent --merges -1 --grep='^chore(sync): ' --format='%H^2' origin/main | xargs git rev-parse)
scripts/fork/image.sh --upstream "$U" --prev "$PREV" --branch "upstream-renamed/$S"
git rev-parse "upstream-renamed/$S^1" "upstream-renamed/$S^2"   # confere os 2 pais

# 5. Ramo de trabalho e fusão
git switch -c "sync/upstream-$(date +%F)" origin/main
git merge --no-ff "upstream-renamed/$S" -m "chore(sync): upstream $S"
```

Ordem de resolução quando há conflito (regra de cada arquivo, nesta ordem):

1. **Lockfiles** (`package-lock.json`, `packages/coding-agent/install-lock/`): não resolver à mão. Pegar o lado
   do nycode e regenerar:
   `git checkout --ours -- package-lock.json packages/coding-agent/install-lock/package-lock.json`, depois
   `npm install --package-lock-only --ignore-scripts` e `node scripts/generate-coding-agent-install-lock.mjs`.
   O hook de pre-commit bloqueia lockfile sem `NYCODE_ALLOW_LOCKFILE_CHANGE=1` (documento: `AGENTS.md` do fork).
2. **`packages/ai/src/models.generated.ts`**: nunca editar à mão (`AGENTS.md`). Aceitar o lado do upstream e
   regenerar com `npm run generate:models` (`package.json:29`, `packages/ai/package.json:72`); a fonte é
   `packages/ai/catalog/`.
3. **`CHANGELOG.md` de qualquer pacote**: o renome os pula, então a imagem os traz iguais aos do upstream. Aceitar o
   texto do upstream como vem; reaplicar abaixo de `## [Unreleased]` as entradas do nycode (D-19). Seções de versões
   lançadas são imutáveis.
4. **Costuras K1..K14**: resolver mantendo a linha com o marcador `// nycode: K<n>`; conferir com
   `scripts/ci/seams/check-seams.sh` e o teste da costura (seção 4.2).
5. **Arquivos do fork que não vêm do upstream** (`NOTICE`, `docs/fork/2026-11-20-fork-do-pi.md`): manter o nosso. A
   imagem não os tem, porque `P` não os cria; já `R_prev = f523ebd25` os tem, então a primeira fusão os vê como
   apagados no lado do upstream e dá conflito modify/delete (medido no ensaio de 2026-11-21). Só a primeira fusão:
   depois `R_prev` é uma imagem, que não os tem, e o conflito some. Resolver com `git checkout --ours -- <arquivo>` e
   `git add`.
6. **Todo o resto**: aceitar o upstream, salvo se o arquivo for da lista de base de estrutura (seção 7).

Depois da resolução:

```bash
git add -A
NYCODE_ALLOW_LOCKFILE_CHANGE=1 git commit --no-edit      # git rerere grava a resolução
npm ci --ignore-scripts
npm run check                                            # saída completa, sem avisos
./test.sh                                                # nunca `npm test` nem vitest completo (AGENTS.md)
bench run --arm nycode --tier smoke                      # só depois de F3; antes disso, pular e registrar
git diff --stat "upstream-renamed/$S"..HEAD -- . ':!resources' ':!import' ':!bench' | tail -1   # métrica 9.3
```

Abertura e fusão do PR (via `git-delivery`, com a autorização do dono):

```bash
git push origin "sync/upstream-$(date +%F)"
gh pr create --base main --title "chore(sync): upstream $S" --body-file docs/fork/sync-pr-template.md
gh pr merge --merge --match-head-commit "$(git rev-parse HEAD)"   # método merge; nunca --admin
```

O modelo `docs/fork/sync-pr-template.md` e o diretório `docs/fork/syncs/` (registro por sincronização) existem desde
C-F6-17. O `npm run check` roda o Biome com `--write` e pode reescrever arquivos: depois dele, `git status` deve
estar limpo ou o resultado entra no mesmo commit.

Comandos não executados nesta etapa: todos os acima (o plano não implementa nada). Os `gh api` e `git` de leitura da
seção 1 foram executados.

## 7. Regras para manter o conflito baixo

1. **Arquivo novo em vez de edição.** Código do nycode mora em diretórios próprios (`extensions/<nome>/`,
   `core/permissions/`, `migrations/`, `resources/`, `scripts/fork/`, `bench/`). A edição de arquivo do upstream só
   existe nas 14 costuras.
2. **Nunca reformatar arquivo do upstream.** O `npm run check` roda o `biome --write`. O renome já reformatou 224
   arquivos (seção 4.3); depois de cada `check`, revisar o `git diff` e reverter reformatação de arquivo que a mudança
   não tocou. Formatação em massa esconde mudança real e gera conflito.
3. **Nunca mover nem renomear arquivo do upstream.** Mover quebra o rastreio de renome do git e cria
   conflito de modify/delete.
4. **Extensão embutida em diretório próprio** (D-01): `src/extensions/<nome>/` mais uma linha de registro em
   `extensions/index.ts` (K5).
5. **Lista de base de estrutura (D-06).** O limite de 800 linhas e 7 arquivos vale só para arquivos criados pelo
   nycode; arquivos do upstream ficam em `scripts/ci/lint/structure-upstream.txt`. Dividir arquivo do upstream
   aumentaria o conflito; o fork tem 50 arquivos de fonte acima de 800 linhas herdados (documento: arquitetura alvo,
   seção 9; exemplo `core/extensions/types.ts`, 2358).
6. **Uma costura por PR de migração**, com o teste da costura no mesmo PR.
7. **Patch sobre arquivo do upstream por função nova**: quando a lógica passar de 5 linhas, extrair.
8. **Sem retrocompatibilidade nova no código do upstream**: o `AGENTS.md` do fork a proíbe.

## 8. Mudanças do upstream que colidem com o harness

Exemplos: o upstream ganha subagentes ou plan mode nativos; muda a `ExtensionAPI`; muda `settings-schema.ts`.

Regra de decisão, nesta ordem:

1. **Detectar.** Cada sincronização lista, no registro da fusão, os arquivos do upstream que tocam: as 14 costuras,
   `core/extensions/types.ts` e `runner.ts` (API de extensão), `resource-loader.ts`, e qualquer nome novo contendo
   `subagent`, `plan`, `goal`, `hook`, `permission`. Hoje não existe nada disso no core (`rg` em 2026-11-20:
   documento anexo B, seção 2; não reverificado depois).
2. **Adotar o do upstream se cobrir o comportamento medido.** O critério é o gate de [09](09-paridade-e-benchmark.md):
   o braço com o recurso nativo do upstream, mantendo a extensão embutida desligada, não é inferior no `tier full`
   em acerto e não é pior em custo além da margem (critério 4 do mega plano). Se for, a extensão embutida correspondente
   é removida em PR de squash próprio, com a regra registrada em [11](11-decisoes-e-pendencias.md).
3. **Manter o nosso se o gate disser que o do upstream é inferior**, e registrar a lacuna medida como proposta de
   contribuição (seção 8.1).
4. **Mudança de `ExtensionAPI`** (evento removido ou com assinatura nova): o `npm run check` das extensões embutidas
   falha na compilação; a correção entra no mesmo PR da fusão (é a verificação da P-3, repetida a cada sincronização).
5. **Empate ou dúvida**: ficar com o código do upstream quando a diferença for só de forma; ficar com o nosso quando
   for de comportamento que o gate mede. Sem gate disponível (antes de F3), não remover nada; registrar.

Não verificado: se o upstream planeja subagentes ou plan mode nativos. A leitura de roadmap do upstream não foi feita
nesta etapa; o CONTRIBUTING do upstream diz que recurso fora do core vira extensão (documento: anexo B, seção 4c), o que
torna improvável um recurso desse porte no core, mas isso é inferência.

### 8.1 Contribuição de volta ao upstream

K1 (cache-warm) e K2 (mcp-close-grace) são correções genéricas, sem relação com o harness, e são as candidatas a PR para
`earendil-works/pi`. Passos propostos:

1. Reproduzir cada defeito no código do upstream mais recente (K1: comparação por identidade em `sdk.ts` impede o
   reaproveitamento do cache; K2: 500 ms de espera no fechamento de `stdin` do MCP). A medição de origem está na
   especificação 0003 e em `pi-memory-cache-sota-2026-11-13.md` do ny-pi (documento: anexo A, seção 2.2).
2. **O CONTRIBUTING do upstream fecha PR de novos contribuidores automaticamente.** Lido em 2026-11-20
   (`gh api repos/earendil-works/pi/contents/CONTRIBUTING.md`): issues e PRs de novos contribuidores são fechados por
   padrão; `lgtmi` libera issues futuras, e só `lgtm` libera PR; o comando vem na resposta de um mantenedor. Logo: abrir
   uma **issue** curta e concreta primeiro, usando um dos dois modelos, e só abrir o PR depois de `lgtm`.
3. O PR segue o `AGENTS.md` do upstream (`npm run check`, `./test.sh`, testes novos citando a issue).
4. Abrir issue e PR é ação externa em nome do dono: exige autorização dele, nunca por subagente. Aqui não foi feito.
5. Se o upstream aceitar, a costura some na sincronização seguinte (o teste da costura passa a testar o código do
   upstream). Se recusar ou não responder, a costura fica; K1 e K2 têm risco baixo e médio (seção 4.1).

Não verificado: se o upstream já corrigiu K1 ou K2 nos 8 commits à frente da base (não foram lidos um a um).

## 9. Métricas

Registradas em cada `evidencias/sync-AAAA-MM-DD.md` (e, depois de F12, em `docs/fork/syncs/`).

| # | Métrica | Como medir |
|---|---|---|
| 9.1 | Tempo por sincronização (minutos) | Do `git fetch` à fusão do PR, anotado pelo executor |
| 9.2 | Arquivos em conflito | `git diff --name-only --diff-filter=U` logo depois do `git merge` |
| 9.3 | Delta próprio | `git diff --stat upstream-renamed/<sha>..main` sem os diretórios novos (nota abaixo) |
| 9.4 | Atraso | `git rev-list --count main..origin/upstream/main` antes de sincronizar |
| 9.5 | Costuras intactas | Saída de `check-seams.sh` (14 de 14) |
| 9.6 | Resoluções reaproveitadas | Mensagens "Resolved ... using previous resolution" do `rerere` |

Na métrica 9.3, "diretórios novos" são `resources/`, `import/`, `bench/`, `scripts/fork/`, `docs/` e as pastas próprias
de `extensions/`; o delta restante é o das costuras.

Valor de referência inicial (medido, seção 4.3): fusão direta de 8 commits = 6 arquivos em conflito de 22; imagem
renomeada = 0 de conteúdo. A meta provisória para depois de F6 é: média de 3 ou menos arquivos em conflito por
sincronização e tempo de uma hora ou menos; é proposta, a ser recalibrada com as duas primeiras sincronizações.

## 10. Critérios de aceite e riscos

### 10.1 Aceite (critério 7 do mega plano)

1. Duas sincronizações completas **depois de F6**, cada uma com `evidencias/sync-<data>.md` contendo as 6 métricas da
   seção 9, o SHA do upstream, o SHA de `R` e o resultado do job `merge-policy`.
2. `merge-policy` passou nas duas, recalculando `P(U)`; uma terceira rodada de teste negativo (merge commit sem imagem
   válida) foi reprovada pelo job.
3. `npm run check` e `./test.sh` verdes na ponta do ramo de cada sincronização.
4. `check-seams.sh` com 14 de 14.
5. Pipeline de renome versionado em `scripts/fork/` (PC-1) e teste de reprodução do `f523ebd25` verde.
6. Duas sincronizações dentro do atraso máximo de 14 dias.

### 10.2 Riscos específicos desta política

Registro completo e reversão em [10](10-riscos-e-rollback.md); os riscos abaixo estão lá com identificador próprio.

| Risco | Efeito | Contenção |
|---|---|---|
| Pipeline de renome só em `/tmp` | Perda do script impede a opção (ii) e o `merge-policy` | PC-1 na F0 |
| Imagem não reprodutível | Job reprova fusão válida | Excluir locks; fixar `biome`; regras por padrão |
| Atraso acumulado | Delta de 3549 arquivos em 21 dias | Atraso máximo de 14 dias; sincronizar antes de cada fase |
| Merge commit indevido em `main` | Linha quebrada | `merge-policy` abre issue; `git revert -m 1` |
| Upstream muda o que o gate mede | Remoção indevida de extensão | Regra de decisão da seção 8, por gate |
| Resolução de conflito apaga costura | Perda silenciosa do harness | Marcador, `check-seams.sh`, testes por costura |

### 10.3 Pendências abertas deste documento

| # | Pendência | Fecha em |
|---|---|---|
| PC-1 | Versionar o pipeline de renome (`/tmp/nycode-rename/`) em `scripts/fork/` com teste de reprodução | F0; fechada em C-F6-17 (seção 4.3.1): pipeline versionado, `biome` incluído, teste de reprodução verde |
| PC-2 | Definir o ponto do gancho `tool_call` de K11 | F8 |
| PC-3 | Medir o custo de tempo do job `merge-policy` | F3 |
| PC-4 | Conferir se K1 e K2 já foram corrigidos no upstream | Antes de propor o PR (8.1) |
| PC-5 | Região de cada costura medida com `git log -L` em vez de `-G` | Primeira sincronização |

## 11. Não verificado neste documento

- Se o upstream planeja subagentes, plan mode ou outra mudança de `ExtensionAPI`.
- Duração do job `merge-policy`; ponto do gancho de K11; região de K5 a K12 (só K1 a K4, K13 e K14 foram medidas).
- Se os 8 commits à frente da base corrigem K1 ou K2.
- Estabilidade de cada versão do upstream (só a cadência foi medida).
- Comportamento do GitHub ao restringir o método de fusão por ramo: tomado de D-07 (documento), não testado.
