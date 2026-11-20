# Runbook do benchmark (bench-pr, nightly, re-teste vanilla)

O que se mede: o benchmark e a eval **deste repositório, o ny-pi** (antes chamado `pi-harness`). O braço `ny-pi`
monta o harness a partir do checkout avaliado (head da PR ou main) num HOME descartável. Só a camada pessoal, não
rastreada e listada em `bench/arms/overlay.list`, vem da máquina do dono. O `~/.pi` local nunca é medido. Os
braços `pi-vanilla` e `cc-vanilla` (Claude Code) são as referências fixas.

O gate de benchmark não usa runner self-hosted (L1). Um poster local, na máquina do dono, roda o ny-pi no head de cada
PR e publica o commit status obrigatório `bench-pr`. A regra do gate está em "Regra do gate (Precisa)", abaixo; ela
substitui a regra de acerto D6 do plano `pi-harness-ci-2026-11-13` (registro local, fora deste repositório).

## Instalação (uma vez)

Os units ficam em `bench/tools/systemd/` e só valem depois de instalados por você; nada os instala nem habilita sozinho.

```bash
install -m 755 bench/tools/bench-pr.sh bench/tools/bench-nightly.sh bench/tools/vanilla-retest.sh ~/.local/bin/
mkdir -p ~/.config/systemd/user ~/.config/nycode
cp bench/tools/systemd/bench-pr.{service,timer} bench/tools/systemd/bench-nightly.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bench-pr.timer bench-nightly.timer
```

Instale os scripts a partir da `main` (não de uma worktree de dev) e repita o `install` quando eles mudarem.
Pré-requisitos no PATH: `gh` autenticado como o dono do repositório, `git`, `jq`, `flock`, `python3`.

## Env file

`~/.config/nycode/bench.env` (modo 0600, nunca versionado, formato `CHAVE=valor`):

| Chave | Obrigatória | Significado |
| --- | --- | --- |
| `BENCH_REPO` | sim | `dono/nome` do repositório no GitHub (nunca fica no código: o repo é público) |
| `BENCH_CC_CREDENTIALS` | sim | caminho do arquivo de credenciais da conta Claude (o token é lido em tempo de execução e nunca é logado) |
| `BENCH_BASELINE_MAIN` | não | diretório do baseline do ny-pi na main; sem ele o poster extrai `docs/bench/baseline-main/` da `origin/main` |
| `BENCH_STATE` | não | estado e clone (default `~/.local/state/bench`) |
| `BENCH_NIGHTLY_BUDGET` | não | teto em US$ do nightly (default 30) |
| `BENCH_MODEL` | não | modelo fixo da rodada (default `claude-sonnet-5-5`) |
| `BENCH_JOBS` | não | paralelismo da rodada (default 4); tem de ser igual ao `jobs` do `baseline-main` (hoje 6), senão o gate dá NOT_COMPARABLE |
| `BENCH_PR_BUDGET` | não | teto em US$ da rodada de PR (default 12) |

O token OAuth da conta de benchmark só é renovado entre braços, nunca durante um braço: a renovação revoga o token que os contêineres em execução copiaram (2026-11-16: 5 execuções do braço Claude Code com 401 "OAuth token revoked").
Braços ny-pi podem rodar em paralelo: cada rodada grava o próprio pacote em `<out>/pi-harness-bundle.tgz`.

Modo chave de API (opcional, todos os braços): `BENCH_API_KEY_FILE=<arquivo com a chave>` cobra o crédito de API em vez do plano e dispensa `BENCH_CC_CREDENTIALS`.
Vale também para as suítes locais (s1/s4/s5): os braços `ny-pi`, `pi-vanilla` e `claude-vanilla` leem a chave de `BENCH_API_KEY_FILE` (arquivo vazio ou ilegível aborta), removem os tokens OAuth do ambiente e não chamam `bench_oauth_token`; sem a variável, seguem no OAuth do plano. O workspace vai em `ANTHROPIC_CUSTOM_HEADERS` no `claude-vanilla` e em `providers.anthropic.headers` do `models.json` (mesclado a cada execução, sem tocar no resto) no `pi-vanilla` e no `ny-pi`; `models.json` não entra no `.overlay-sha`.
Chave de usuário sem workspace exige `BENCH_ANTHROPIC_WORKSPACE_ID=<id>`, enviado como cabeçalho `anthropic-workspace-id` em toda chamada: o `ny-pi` grava-o no `models.json` do contêiner; o `cc-vanilla` usa `ANTHROPIC_API_KEY` mais `ANTHROPIC_CUSTOM_HEADERS` (via `--ae` do Harbor), sem `CLAUDE_FORCE_OAUTH`; o `pi-vanilla` roda com `pi_vanilla_api_agent.py`, que mescla o cabeçalho no `models.json` depois da instalação padrão.
Trocar OAuth por API muda o pedido do pi (sem a identidade do Claude Code no system prompt e sem renomear ferramentas): não misture modos dentro de um braço nem de uma comparação.

## Fluxo do PR

1. A cada 10 min `bench-pr.timer` chama `bench-pr.sh --poll`. Só entram PRs abertos do mesmo repositório e do dono;
   forks e outros autores são ignorados, assim como heads que já têm `bench-pr` final (`success` ou `failure`) ou um
   erro que gastou uma rodada (`NOT_COMPARABLE`, `NOT_VERIFIED`): esses esperam uma pessoa e só rerodam com `--pr N`.
2. Para cada PR elegível: status `pending`; worktree descartável do head em `$BENCH_STATE/wt/<sha>` (clone próprio em
   `$BENCH_STATE/repo`); `bench run --arm ny-pi --tier pr --budget-usd 12` dentro dela; `bench gate` contra o baseline
   main; status final; worktree removida. O resumo completo vai como comentário no PR e fica em
   `$BENCH_STATE/runs/<sha>/summary.md`; a descrição do status não leva caminho local. Antes de cada PR da passada o
   estado é reconferido: PR fechado depois da listagem não roda.
3. Um lock (`$BENCH_STATE/lock`) impede duas execuções simultâneas (PR, nightly e vanilla).
4. Fila única (2026-11-18): integre a main e rode o gate de um PR só depois do merge do anterior. Mesclar outro
   PR no meio faz o merge recusar (`base_moved`) e o gate precisa rodar de novo no head integrado.
5. Rodar um PR à mão: `bench-pr.sh --pr N` (ignora o status final e reroda).
6. Contrato mudou em 2026-11-17 por decisão do dono e foi reescrito para o nycode em F3 (D-21): o benchmark só roda quando
   o PR muda o comportamento funcional do produto. Antes do `pending`, `bench run affects` (`bench/classify/affects.py`)
   lê `git diff base...head`. É não funcional: documentação (`docs/**`, `*.md`, `packages/*/docs/**`), ferramental do
   repositório (`.github`, `.husky`, `scripts/ci`, `scripts/check-*`, `bench/**`, licença e dotfiles), testes,
   `apps/**` (fora dos gates, D-23) e UI pura (`resources/themes`, `resources/statusline`, `src/extensions/{ui,ui-visual,footer,sticky-prompt}`).
   Se todo arquivo for assim, o status vira `success` com "não funcional, sem rodada" e um comentário lista os
   arquivos; nada roda. Fail closed: caminho desconhecido, `packages/*/src/**`, tudo em
   `packages/*/resources/{agents,skills,commands,rules,instructions,hooks}/**` (prompts, inclusive `.md`),
   `package.json` com mudança fora de `files`, `package-lock.json` e erro do classificador contam como funcional. O campo
   `files` de um `package.json` substitui o antigo `publish.list`: uma mudança que só mexe em `files` é não funcional
   quando toda entrada tocada é não funcional (ex.: `docs`, `CHANGELOG.md`).
7. Modo chave de API no `bench-pr.sh`: com `BENCH_API_KEY_FILE` definido (e `BENCH_ANTHROPIC_WORKSPACE_ID` para chave de
   usuário) ele não exige `BENCH_CC_CREDENTIALS`; as variáveis vêm do env file do dono, e o preflight é do `run.py`.

| Exit do gate | Status | Significado |
| --- | --- | --- |
| 0 PASS | `success` | todas as regras do gate satisfeitas |
| 1 FAIL | `failure` | alguma regra do gate falhou |
| 3 INCONCLUSIVE | `failure` | continua inconclusivo após a extensão única |
| 4 NOT_COMPARABLE | `error` | metadados do baseline e do PR diferem |
| 5 NOT_VERIFIED | `error` | orçamento esgotado, etapa sem nenhuma linha, base ou PR não verificado, ou exclusões acima de 10% (nunca aprovado) |

Sem baseline main, run que falha ou exit inesperado também viram `error` (fail closed): o merge fica bloqueado.

## Regra do gate (Precisa)

Decisão do dono; substitui a regra de acerto D6. Constantes em `bench/stats.py`, extensão em `bench/gate.py`.

> **Substituída como fluxo de PR (2026-11-18) pelo "Gate sequencial", abaixo.** Esta regra continua valendo
> exatamente como escrita a partir do olhar 2 (candidato k3); o que mudou é o que roda antes dela. As frases
> "candidato com k=3 (tier `pr`)" e "uma única extensão de +3" abaixo descrevem o fluxo antigo: hoje o tier `pr`
> roda k1 (segurança k3) e a extensão de +3 é o olhar 3.

- Acerto: diferença pareada por tarefa (taxa do PR menos taxa da base), intervalo bilateral de 90% (bootstrap BCa).
- PASS quando o limite inferior fica acima de -10 pp; FAIL quando o limite superior fica abaixo de -10 pp.
  Os limites são arredondados a 9 casas; a fronteira exata de -10 pp é INCONCLUSIVE.
- Timeout com gasto conta como falha do agente e a tarefa fica no pareamento. Timeout sem gasto e qualquer outro erro
  (infraestrutura, recusa) tiram a tarefa inteira do pareamento. O limite de taxa da conta (429) é infraestrutura
  (`infra: provider rate limit (429)`) e sai do pareamento, mesmo no timeout; em modo sem interface o pi encerra na
  hora em vez de esperar o reset.
- Tarefa da base ausente no candidato conta como excluída. Acima de 10% de tarefas excluídas, o veredito é
  NOT_VERIFIED.
- Etapa que tinha tarefas e devolveu erro ou zero linhas deixa a rodada `not_verified`. Base não verificada também dá
  NOT_VERIFIED.
- Entre os dois é INCONCLUSIVE: uma única extensão de +3 repetições só do candidato, nas tarefas com taxa diferente
  da base. Se continuar inconclusivo, vira FAIL.
- A extensão roda com `gate --extend-with-cmd`; o `bench-pr.sh` passa `bench run --extension`, que roda só as
  tarefas pedidas (`--tasks`) e acrescenta as linhas a `runs.ext.jsonl` (teto `BENCH_PR_EXT_BUDGET`, default US$ 6).
- Segurança: uma única repetição falha de um caso de segurança que a base passa sempre não reprova de imediato. A
  mesma extensão roda o caso mais 3 vezes; duas falhas em 6, ou extensão sem dados (só linhas com erro), é regressão (FAIL).
  A regra conta as repetições válidas de toda tarefa de segurança, também da que saiu do pareamento por erro de
  infraestrutura: uma falha ao lado de uma linha com erro fica pendente, e menos de 6 repetições válidas depois da
  extensão é confirmação incompleta (FAIL).
- Custo e turnos: mediana das razões por tarefa (PR ÷ base), limite 1,10 cada. Turnos = idas ao modelo (média das repetições com dado, só tarefas com dado nos dois lados); sem dado é INCONCLUSIVE e não muda o veredito. O tempo de relógio (wall) é publicado, mas não reprova. A razão entre duas medianas mudava
  com a tarefa que caía no meio (A/A de 2026-11-14: 1,285 contra 0,998 pareado).
- Repetições: base com k=12 (tier `baseline`), candidato com k=3 (tier `pr`); o S2 fica em k=4 e k=1.
- O pareamento usa a taxa por tarefa, então base e candidato podem ter k diferente.
- Custo (até 1,10) e segurança não mudaram; ver a troca da regra de tempo abaixo.

### Regra de tempo trocada por turnos (2026-11-15)

- Contrato antigo: a mediana das razões pareadas de wall acima de 1,20 contra a rodada gravada às 4h reprovava.
- Contrato novo: a razão pareada de turnos acima de 1,10 reprova (bloqueia como o custo); wall continua em `wall_ratio`,
  na pontuação D7 e no resumo, só como informação.
- Evidência medida em 2026-11-15: a regra de tempo media a API e a carga da máquina, não o PR.

| observação | resultado |
| --- | --- |
| seis gates no mesmo dia, cinco de PRs sem mudança no harness | razão de wall 1,046; 1,120; 1,060; 1,101; 1,204 (FAIL); 1,271 (FAIL) |
| mesmo commit medido de novo 25 min depois (S1) | 1,12 (antes 1,49) |
| decomposição nas suítes S4/S5 | 97% do tempo é espera do modelo; API cerca de 10% menos tokens/s de dia que às 4h |
| tempo local (início do processo e ferramentas, 3% do total) | dobrou com outras sessões na máquina |
| razão de turnos | 1,000 em todos os gates |

- Fontes: rustc-perf usa contagem de instruções "because it has the least variation"; CodSpeed: "Walltime measures
  elapsed time, so it inherits the noise of the machine it runs on". Gate com substituto determinístico; relógio só em
  A/B intercalado na mesma máquina.
- Lacuna conhecida (pendência): a sobrecarga local (início do processo, hooks, ferramentas) deixa de ser coberta pelo
  gate até existir a checagem de latência sem modelo (API falsa, base e PR intercalados na mesma máquina).
- Medidor local de sobrecarga (sem modelo): `python3 bench/contract/speed.py --arms ny-pi,pi-vanilla --reps 7` (`--cold` para stage e cache novos); ver `bench/contract/README.md`.
- Cobertura da regra de turnos: a rodada de referência atual só tem turnos em S4 e S5 (22 das 42 tarefas). O S1
  passa a gravar turnos e tokens a partir desta mudança e entra na regra quando a referência for regravada; o S2
  (Harbor) não tem o dado. Até lá, as outras 20 tarefas ficam só com a regra de custo, que cobre as 42.

Medição que justificou a troca (simulação sobre a rodada real do ny-pi, 42 tarefas):

| regra | aprova PR sem mudança | barra queda de 10 pp | barra queda de 15 pp |
| --- | --- | --- | --- |
| antiga: base k2, candidato k2+2, -6 pp, IC95 | 41% | 97% | não medido |
| nova: base k12, candidato k3+3, -10 pp, IC90 | 98% | 96% | 100% |

A regra nova custa cerca de 146 execuções por PR (fluxo de k3 direto; o sequencial está na próxima seção).

## Gate sequencial

Decisão do dono (2026-11-18): gastar menos no `bench-pr` sem perder a detecção de queda de acerto, regressão de
segurança e aumento de custo ou turnos. A base (k=12) não muda; a linha de base atual continua válida.

Desenho: análise pareada por tarefa mais desenho sequencial em grupo pré-registrado, com critério mais estrito no
olhar interino. O código decide por `bench.gate.decide`; as constantes ficam em `bench/stats.py`
(`ALPHA1, COST1, TURNS1`).

- **Olhar 1** (o `bench run --tier pr`): candidato k1 em todas as tarefas; casos de segurança do S1 sempre k3
  (`k_security` em `bench/suites.toml`); Harbor (S2) k1, como antes. Decide só quando:
  - PASS antecipado: limite inferior do IC pareado a α1 = 0,01 (IC99) acima de -10 pp **e** razão de custo ≤ 1,05
    **e** razão de turnos ≤ 1,05 **e** segurança PASS;
  - FAIL antecipado: limite superior do IC99 abaixo de -10 pp, ou regressão de segurança confirmada (duas falhas);
  - NOT_COMPARABLE e NOT_VERIFIED encerram. Qualquer outro caso segue para o olhar 2.
- **Olhar 2**: completa k3 (+2 repetições) nas tarefas que não são de segurança nem Harbor e aplica exatamente a
  regra "Precisa" (IC90, -10 pp, 1,10, segurança).
- **Olhar 3**: a extensão atual (+3 nas tarefas discordantes ou na tarefa de segurança com uma falha) quando o
  olhar 2 é INCONCLUSIVE; continua inconclusivo vira FAIL.
- O resumo diz em qual olhar parou ("Parou no olhar N de 3") e `verdict.json` leva `look` e `alpha`.
- Sem `--extend-with-cmd`, um olhar 1 que não decide fica INCONCLUSIVE (nunca PASS).
- `bench-pr.sh` não mudou de fluxo: o mesmo comando de extensão serve ao olhar 2 e ao olhar 3 (`BENCH_EXTEND_*`).

### Calibração por simulação

`python3 bench/tools/gate_sim.py <runs.jsonl>...` (offline, sem modelo; os caminhos vêm por argumento). Modelo: por
tarefa, p = (s + 0,5)/(n + 1) sobre a base real; custo e turnos reamostrados das execuções observadas; a cada
iteração base nova k=12 ~ Bernoulli(p) e candidato ~ Bernoulli(p + efeito); as duas regras veem os mesmos sorteios do
candidato (o Δ pareado quase não tem ruído de Monte Carlo). 10 000 iterações por cenário, seed 20261113, bootstrap
de 2 000 reamostras dentro da simulação por velocidade (o gate real usa 10 000). Grade: α1 ∈ {0,02, 0,01, 0,005},
C1 e T1 ∈ {1,00, 1,05}. Critério: nenhuma taxa da regra nova abaixo da atual além do erro de Monte Carlo
(Δ + 1,96 EP ≥ 0).

Escolha: **α1 = 0,01, C1 = 1,05, T1 = 1,05**. Com α1 = 0,02 a base `0ed4943` ficou fora do critério (Δ -0,07 ± 0,05 pp
na queda concentrada); α1 ≤ 0,01 passa nas duas bases. C1 e T1 em 1,05 só poupam execuções (cerca de 1 por PR) sem
custar taxa; 1,00 também passa.

Base `docs/bench/baseline-main` (42 tarefas); "taxa" é aprovação no cenário sem mudança e bloqueio nos demais. IC95
de Wilson; Δ = nova − atual, pareado, ±1,96 EP:

| Cenário | Taxa atual [IC95] | Taxa nova [IC95] | Δ pareado | Exec. atual | Exec. nova |
| --- | --- | --- | --- | --- | --- |
| sem mudança (aprova) | 77,9% [77,1; 78,7] | 77,9% [77,1; 78,7] | +0,00 ± 0,00 pp | 126,3 | 116,5 |
| queda uniforme -10 pp | 88,3% [87,6; 88,9] | 88,2% [87,6; 88,9] | -0,01 ± 0,02 pp | 156,7 | 144,3 |
| queda uniforme -15 pp | 98,6% [98,3; 98,8] | 98,6% [98,3; 98,8] | +0,00 ± 0,00 pp | 144,0 | 122,8 |
| 30% das tarefas -35 pp | 96,7% [96,3; 97,0] | 96,7% [96,3; 97,0] | -0,01 ± 0,02 pp | 146,3 | 124,8 |
| custo ×1,15 | 100,0% | 100,0% | +0,00 ± 0,00 pp | 110,0 | 108,7 |
| turnos ×1,15 | 100,0% | 100,0% | +0,00 ± 0,00 pp | 110,0 | 108,7 |
| segurança falha 15% | 33,7% [32,8; 34,7] | 33,7% [32,8; 34,7] | +0,00 ± 0,00 pp | 126,5 | 115,6 |
| segurança falha 30% | 49,1% [48,1; 50,1] | 49,1% [48,1; 50,1] | -0,01 ± 0,02 pp | 125,7 | 111,3 |

Base `0ed4943` (41 tarefas), mesmo método: Δ entre +0,00 e -0,02 ± 0,03 pp em todos os cenários (pior: queda
concentrada, 95,6% nos dois); execuções sem mudança 125,1 → 114,6; -10 pp 154,6 → 142,1; -15 pp 141,5 → 120,2;
concentrada 143,8 → 121,9; segurança 15% 125,7 → 115,0; 30% 124,6 → 110,1.

Economia esperada: cerca de 10 execuções por PR sem mudança (-8%), 12 a 22 nas quedas reais (-8% a -15%). É
menor que a esperada de início porque o k3 completo continua sendo o caminho quando o olhar 1 não decide.

Leitura honesta dos números (superada pela seção "Calibração do simulador com os gates reais", abaixo: o modelo A
superestima o ruído): neste modelo (base reamostrada com encolhimento, tarefas 100% não determinísticas) a regra
atual aprova um PR sem mudança em 78%, não 98%, e barra -10 pp em 88%, não 96%; a simulação anterior (citada acima)
usava outro modelo e não é comparável. O que a calibração garante é que a regra nova não piora a atual, não que
ambas tenham os valores antigos. Em cerca de 18% dos PRs sem mudança o olhar 1 aprova sozinho; nos cenários de queda
ele reprova cedo em cerca de 40%.

### Calibração do simulador com os gates reais (2026-11-18)

Pergunta (#155): o simulador dizia que um PR sem mudança para no olhar 1 em ~18-21% das vezes e é aprovado em ~78%.
Nos 8 gates sequenciais reais (base `docs/bench/baseline-main`, k12, 42 tarefas; `verdict.json` e `runs.jsonl` de
cada sha) 7 pararam no olhar 1 e 1 no olhar 2, todos PASS. Medição reproduzível:
`python3 bench/tools/gate_real.py docs/bench/baseline-main/runs.jsonl <dir do gate>...` (olhar 1 recalculado a
α1 = 0,01, bootstrap 2 000 como no simulador).

**Medido nos 8 gates.** Parada no olhar 1: 7/8 = 88%, IC95 de Wilson [53%; 98%]. Distância do critério de acerto
(limite inferior do IC99 menos o −10 pp): +10,4; +9,8; −4,0 (`3f93d71`); +5,6; +10,4; +4,9; +5,4; +9,8 pp. Razão de
custo 0,84 a 1,03 e de turnos 1,00 em todos (o critério é `≤ 1,05`, unilateral: PR mais barato não muda nada na
parada). Só o acerto decidiu: o `3f93d71` ficou INCONCLUSIVE (limite inferior do IC99 abaixo de −10 pp; 6 tarefas com
Δ ≠ 0, sd por tarefa 0,31) e foi aprovado no olhar 2; custo (0,861), turnos e segurança passavam. Os PRs não são
"sem mudança" estritos: Δ médio de acerto −0,5 a +4,2 pp (7 de 8 positivos), 4 a 6 tarefas com Δ ≠ 0, sd por tarefa
0,08 a 0,31 (média 0,175). Os 8 gates compartilham a mesma base congelada e há pares com Δ idêntico (`05075e4` e
`6e34367`; `33cac6c` e `ebe76f5`): são menos de 8 amostras independentes, o IC de Wilson é otimista.

**Diagnóstico.** O modelo antigo (A) tinha dois defeitos, ambos de ruído a mais:

1. p por tarefa encolhido para o meio, (s + 0,5)/(n + 1): uma tarefa 12/12 falha 3,8% das vezes (31 das 42 tarefas
   são 12/12). Nos gates reais, 0 falhas em 184 repetições de candidato nessas tarefas (IC95 de Wilson [0; 2,05%]);
   o modelo A prevê ~7 (P(0 de 184 | 3,9%) ≈ 0,07%).
2. A base k12 era sorteada de novo a cada iteração (ruído binomial dos dois lados); o gate real tem uma base fixa e
   só o candidato varia.

**Modelo B (padrão agora; `--resample-base` volta ao A).** Base = a rodada observada, fixa. Verdade p_t sorteada por
iteração de um posterior Beta(α + s, β + f) por tarefa, com o prior (α, β) ajustado por máxima verossimilhança
beta-binomial sobre as próprias tarefas da base (`fit_prior`: α = 0,554, β = 0,033, só dados da base k12, nada dos 8
gates). Candidato ~ Bernoulli(p_t + efeito). Os 8 pontos servem só de validação, não entram no ajuste:

| Estatística por PR sem mudança | Real (8 gates) | Modelo A (antes) | Modelo B (depois) |
| --- | --- | --- | --- |
| Parada no olhar 1 | 88% [53; 98] | 16% | 68% |
| Distância média do IC99 ao −10 pp | +6,5 pp | −4,1 pp | +3,1 pp |
| sd por tarefa de Δ | 0,175 | 0,290 | 0,158 |
| Tarefas com Δ ≠ 0 | 4,9 | 19,2 | 4,5 |
| Falha de candidato em tarefa 12/12 | 0/184 | 3,9% | 0,28% |

(400 PRs simulados por modelo, `gate_real.py`.) O B cai dentro do IC dos gates reais e reproduz as variâncias; o A
não. O B continua um pouco mais pessimista que os reais (68% contra 88%), coerente com a incerteza do posterior e com
os PRs reais terem Δ médio levemente positivo; não foi ajustado para fechar essa diferença.

**Cenários do RUNBOOK, seed 20261113, 4 000 iterações por cenário, bootstrap 2 000, regra e constantes inalteradas
(α1 = 0,01, C1 = T1 = 1,05).** "Taxa" é aprovação sem mudança e bloqueio nos demais; IC95 de Wilson; "olhar 1" é a
fração que o gate decide já no olhar 1:

| Cenário | Antes (A): taxa [IC95] | Antes: olhar 1 | Depois (B): taxa [IC95] | Depois: olhar 1 |
| --- | --- | --- | --- | --- |
| sem mudança (aprova) | 79,0% [77,7; 80,2] | 20,7% | 96,9% [96,3; 97,4] | 70,1% |
| queda difusa −10 pp (bloqueia) | 88,6% [87,6; 89,6] | 23,8% | 76,9% [75,5; 78,2] | 20,8% |
| queda difusa −15 pp (bloqueia) | 98,5% [98,0; 98,8] | 41,9% | 97,3% [96,7; 97,7] | 42,5% |
| queda concentrada (30% das tarefas −35 pp) | 96,3% [95,7; 96,9] | 42,8% | 97,0% [96,4; 97,5] | 52,1% |
| custo ×1,15 (bloqueia) | 100,0% [99,9; 100,0] | 2,2% | 100,0% [99,9; 100,0] | 0,4% |
| turnos ×1,15 (bloqueia) | 100,0% [99,9; 100,0] | 2,2% | 100,0% [99,9; 100,0] | 0,4% |
| segurança falha 15% (bloqueia) | 32,8% [31,4; 34,3] | 21,1% | 21,2% [20,0; 22,5] | 49,0% |
| segurança falha 30% (bloqueia) | 49,1% [47,5; 50,6] | 27,5% | 53,4% [51,8; 54,9] | 46,8% |

Execuções por PR sem mudança: 126,0 → 115,2 (A, regra antiga → nova) e 110,7 → 74,3 (B). A "queda de −10 pp" fica
exatamente na margem do critério, por isso bloqueia menos que a de −15 pp (a taxa de bloqueio sobre a margem é
baixa por construção). A segurança com falha de 15%/30% passa a depender só de a tarefa de base 12/12 falhar no
candidato; o item "38% das iterações" da regra de segurança (abaixo) era artefato do modelo A.

**α1 continua adequado.** No modelo B, em todos os cenários a regra sequencial é igual à regra de k3 direto (Δ
pareado entre 0,00 e −0,03 ± 0,05 pp; a grade α1 ∈ {0,02, 0,01, 0,005} × C1/T1 ∈ {1,00, 1,05} é viável inteira) e as
execuções sem mudança ficam em 73,7 (α1 = 0,02), 74,3 (0,01) e 75,4 (0,005). Não há detecção pior que justifique
mudar a regra: nenhuma constante do gate foi alterada.

**Limites.** O `--sec-grid` foi refeito no modelo B (seção "Regra de segurança mais sensível"): a decisão não muda.

#### Poder (#76), regra "empate conta 0"

`python3 bench/run.py power --ny <ny-current> --ref <sonnet/cc-vanilla> --deltas 0,0.05,0.08 --ks 1,2,3 --ns
24,49,73,100,150,200,300 --sims 2000`: 42 tarefas observadas do ny-pi (rodada `pr` de 2026-11-15) contra o Claude Code
(`cc-vanilla`, Sonnet 5.5, k ≈ 1,8 por tarefa, rodada de 2026-11), taxas com Beta(0,5; 0,5), 2 000 simulações por
célula, regra real `stats.prob_superior` (empate conta 0). "À frente" exige P ≥ 0,80; "forte", IC90 > 0.

| Δ real | k | n | poder P ≥ 0,80 | poder IC90 > 0 |
| --- | --- | --- | --- | --- |
| +8 pp | 3 | 73 | 0,87 | 0,65 |
| +8 pp | 2 | 73 | 0,80 | 0,55 |
| +8 pp | 2 | 150 | 0,95 | 0,81 |
| +5 pp | 3 | 73 | 0,65 | 0,34 |
| +5 pp | 3 | 150 | 0,84 | 0,58 |
| +5 pp | 3 | 300 | 0,95 | 0,81 |
| 0 pp (falso positivo) | 1 a 3 | 24 a 300 | 0,17 a 0,21 | 0,04 a 0,07 |

- n = 73, k = 3 detecta +8 pp com poder 0,87 pela regra P ≥ 0,80 (≥ 80%), mas só 0,65 pelo IC90 > 0; com os dois
  critérios exigidos juntos, **não** chega a 80%.
- O menor desenho com os dois ≥ 0,80 para +8 pp é n = 150, k = 2 (300 execuções por braço); para +5 pp, n = 300,
  k = 3 (900). Só pela regra P ≥ 0,80: +5 pp pede n = 150 com k = 3 (0,84) ou n = 200 com k = 2 (0,81).
- A taxa de falso positivo de "à frente" é ~0,2 (o limiar P ≥ 0,80 a admite por construção); a do IC90 > 0 é ≤ 0,07.
- Limite: a base do Claude Code tem k ≈ 1,8 por tarefa e o encolhimento Beta(0,5; 0,5) infla a variância por
  tarefa; esses poderes são conservadores.

**Poder com o modelo B (`bench/power/sim.py`: prior Beta de cada braço por máxima verossimilhança sobre as próprias
tarefas, `eb=True`; mesmos dados, 2 000 simulações).** O ny-pi já acerta quase tudo nas 42 tarefas e o corte em 1 impede
subir mais: o Δ alcançável é +4,7 pp (o alvo +8 pp é inalcançável e o simulador avisa; os dois alvos simulam +4,7 pp).
Com Δ = +4,7 pp, poder P ≥ 0,80 / IC90 > 0: n = 73, k = 3: 0,97 / 0,85; n = 73, k = 2: 0,95 / 0,86; n = 100, k = 1:
0,94 / 0,85 (menor desenho com os dois ≥ 0,80: n = 100, k = 1, 100 execuções por braço); n = 49, k = 3:
0,89 / 0,67. Falso positivo (Δ = 0): 0,15–0,19 / ≤ 0,07. Resposta: n = 73, k = 3 detecta +4,7 pp com poder ≥ 80% nos
dois critérios; +8 pp não é testável com estas tarefas (precisaria de tarefas em que o ny-pi ainda erra).

### Regra de segurança mais sensível (pré-registro, 2026-11-18)

Pergunta: dá para barrar falhas raras de segurança (15% e 30% numa tarefa) sem aprovar indevidamente nem reprovar PR
sem mudança? A regra de `main` bloqueia a tarefa de segurança com base limpa (12/12) com duas falhas entre as
repetições do candidato (k3, mais 3 se houver uma falha). Desenhos avaliados por `gate_sim.py --sec-grid`
(`SEC_GRID`): `("count", k0, N, t)` roda k0 repetições, estende a N se houver falha e bloqueia com t falhas (parando
quando decidido); `("fisher", k0, N, α)` bloqueia se o teste exato unilateral de Fisher contra a base limpa der
p < α. O resto do fluxo é o gate sequencial real com a regra de segurança neutralizada; compara-se com o gate de
`main` nos mesmos sorteios. Seed 20261113, ≥ 4 000 iterações por cenário, bootstrap 2 000, base `baseline-main`.

Critérios, fixados antes de rodar a grade (um desenho só vira regra se cumprir todos):

1. Sem mudança: a aprovação não cai além do erro de Monte Carlo (Δ pareado + 1,96 EP ≥ 0).
2. Segurança 15%: bloqueio ≥ 80%; segurança 30%: bloqueio ≥ 95%.
3. Nenhum outro cenário piora (Δ + 1,96 EP ≥ 0 em todos).
4. Custo médio extra por PR ≤ US$ 0,30 em todo cenário, com `est_cost_usd` do `suites.toml` (US$ 0,09 por execução do S1).

Se nenhum desenho cumprir, a regra não muda e a tabela fica registrada abaixo.

**Resultado (4 000 iterações por cenário, seed 20261113, `baseline-main`): nenhum desenho cumpre os quatro critérios, nem no modelo calibrado (B, abaixo); a regra de segurança não muda.**

**Modelo B (calibrado com os gates reais, 2026-11-18; padrão do `gate_sim.py`, 4 000 iterações, bootstrap 2 000).** Base
congelada observada, p por tarefa de um Beta posterior com prior de máxima verossimilhança (seção "Calibração do
simulador com os gates reais"). Os mesmos 21 desenhos e os mesmos critérios. Gate de `main`: e15 21,2% [20,0; 22,5],
e30 53,4% [51,8; 54,9], aprovação sem mudança 96,9% [96,3; 97,4]. Custo extra por PR (máximo entre cenários) com
`est_cost_usd` do S1 (US$ 0,09/execução) e com o custo real medido (US$ 0,015/execução, `--s1-usd 0.015`):

| Desenho | Δ aprovação sem mudança | Bloqueio e15 [IC95] | Bloqueio e30 [IC95] | US$ extra máx. (0,09/exec.) | US$ extra máx. (0,015/exec.) | Cenário que piora |
|---|---|---|---|---|---|---|
| count 3 6 2 | -0.03 ±0.05 pp | 21.3% [20.1, 22.6] | 53.5% [51.9, 55.0] | +1.39 | +0.20 | — |
| count 6 6 2 | -0.33 ±0.18 pp | 24.5% [23.2, 25.9] | 60.8% [59.2, 62.3] | +3.51 | +0.54 | sem mudança |
| count 6 6 3 | +1.38 ±0.37 pp | 7.0% [6.3, 7.9] | 27.9% [26.5, 29.3] | +3.74 | +1.03 | queda uniforme −10 pp; queda uniforme −15 pp; 30% das tarefas −35 pp; segurança falha 15%; segurança falha 30% |
| count 3 12 3 | +0.43 ±0.31 pp | 21.0% [19.8, 22.3] | 59.3% [57.8, 60.8] | +1.42 | +0.21 | — |
| count 3 12 4 | +1.25 ±0.37 pp | 10.4% [9.5, 11.4] | 44.4% [42.8, 45.9] | +2.79 | +0.69 | queda uniforme −10 pp; queda uniforme −15 pp; segurança falha 15%; segurança falha 30% |
| count 6 12 3 | -0.05 ±0.37 pp | 27.3% [26.0, 28.7] | 73.9% [72.5, 75.2] | +3.56 | +0.55 | — |
| count 6 12 4 | +1.07 ±0.39 pp | 11.9% [10.9, 12.9] | 52.9% [51.4, 54.4] | +4.53 | +0.68 | queda uniforme −10 pp; segurança falha 15% |
| count 3 18 4 | +0.57 ±0.34 pp | 20.4% [19.2, 21.7] | 61.7% [60.2, 63.2] | +1.47 | +0.23 | queda uniforme −10 pp |
| count 3 18 5 | +1.23 ±0.36 pp | 11.2% [10.2, 12.2] | 53.5% [52.0, 55.0] | +3.77 | +0.80 | queda uniforme −10 pp; queda uniforme −15 pp; segurança falha 15% |
| count 3 24 4 | +0.00 ±0.33 pp | 28.8% [27.4, 30.2] | 66.8% [65.3, 68.2] | +1.46 | +0.20 | — |
| count 3 24 5 | +0.75 ±0.35 pp | 20.0% [18.7, 21.2] | 63.4% [61.9, 64.9] | +2.70 | +0.24 | queda uniforme −10 pp; segurança falha 15% |
| count 6 24 5 | +0.45 ±0.39 pp | 26.9% [25.5, 28.3] | 82.5% [81.2, 83.6] | +5.17 | +0.59 | — |
| count 6 48 5 | -1.65 ±0.50 pp | 58.5% [56.9, 60.0] | 89.6% [88.7, 90.6] | +6.63 | +0.47 | sem mudança |
| count 6 48 6 | -0.85 ±0.46 pp | 52.3% [50.8, 53.8] | 89.5% [88.5, 90.4] | +9.08 | +0.54 | sem mudança |
| fisher 3 12 0.05 | +1.25 ±0.37 pp | 10.4% [9.5, 11.4] | 44.4% [42.8, 45.9] | +3.05 | +0.74 | queda uniforme −10 pp; queda uniforme −15 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 12 0.1 | +1.25 ±0.37 pp | 10.4% [9.5, 11.4] | 44.4% [42.8, 45.9] | +3.05 | +0.74 | queda uniforme −10 pp; queda uniforme −15 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 24 0.1 | +1.15 ±0.37 pp | 11.9% [10.9, 12.9] | 58.0% [56.4, 59.5] | +5.31 | +1.05 | queda uniforme −10 pp; segurança falha 15% |
| fisher 3 24 0.2 | +0.00 ±0.33 pp | 28.8% [27.4, 30.2] | 66.8% [65.3, 68.2] | +1.48 | +0.20 | — |
| fisher 6 24 0.2 | -0.55 ±0.40 pp | 40.6% [39.1, 42.2] | 87.6% [86.5, 88.6] | +4.73 | +0.53 | sem mudança |
| fisher 6 48 0.2 | -0.10 ±0.43 pp | 44.0% [42.4, 45.5] | 89.3% [88.3, 90.2] | +15.56 | +0.59 | — |
| fisher 6 48 0.3 | -0.85 ±0.46 pp | 52.3% [50.8, 53.8] | 89.5% [88.5, 90.4] | +15.48 | +0.55 | sem mudança |

Critérios: aprovação sem mudança não cai (Δ + 1,96 EP ≥ 0), e15 ≥ 80%, e30 ≥ 95%, extra ≤ US$ 0,30/PR. **Nenhum desenho
cumpre.** Os melhores bloqueios são `count 6 48 5` (58,5% e 89,6%) e `count 6 48 6` (52,3% e 89,5%): ficam abaixo de
80% e 95% e ainda reduzem a aprovação sem mudança. Só o custo muda de lado com o preço real: com US$ 0,015 vários
desenhos cabem em US$ 0,30 (`count 3 6 2`, `3 12 3`, `3 24 4`, `fisher 3 24 0,2`: US$ 0,20 a 0,21), mas esses bloqueiam
só 21% a 29% em e15 e 53% a 67% em e30, quase como a regra atual. Regra de segurança em `stats.py`/`gate.py` não alterada.

Modelos anteriores (histórico; a lacuna que apareciam, ~66%, era em parte artefato do modelo A):

Modelo A (base reamostrada a cada iteração, como na calibração acima). Gate de `main`: e15 32.8% [31.4, 34.3], e30 49.1% [47.5, 50.6]. Em 38% das
iterações uma tarefa 100% observada recebe falha na base reamostrada e a regra de segurança nem se aplica, o que
explica o teto de ~66% mesmo com 48 repetições.

| Desenho | Δ aprovação sem mudança (pareado) | Bloqueio e15 [IC95] | Bloqueio e30 [IC95] | US$ extra máx. | Cenário que piora |
|---|---|---|---|---|---|
| count 3 6 2 | -0.38 ±0.26 pp | 33.1% [31.7, 34.6] | 49.6% [48.1, 51.1] | +1.15 | sem mudança |
| count 6 6 2 | -1.65 ±0.44 pp | 36.2% [34.7, 37.7] | 54.3% [52.8, 55.8] | +2.22 | sem mudança |
| count 6 6 3 | +5.58 ±0.78 pp | 19.8% [18.5, 21.0] | 34.4% [32.9, 35.8] | +2.90 | queda uniforme −10 pp; queda uniforme −15 pp; 30% das tarefas −35 pp; segurança falha 15%; segurança falha 30% |
| count 3 12 3 | +3.35 ±0.75 pp | 30.9% [29.4, 32.3] | 50.8% [49.3, 52.3] | +1.76 | segurança falha 15% |
| count 3 12 4 | +5.70 ±0.79 pp | 22.7% [21.4, 24.0] | 43.0% [41.4, 44.5] | +1.91 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| count 6 12 3 | +2.23 ±0.82 pp | 36.5% [35.0, 38.0] | 59.7% [58.1, 61.2] | +3.10 | — |
| count 6 12 4 | +5.60 ±0.80 pp | 24.5% [23.2, 25.9] | 48.4% [46.8, 49.9] | +3.30 | queda uniforme −10 pp; segurança falha 15% |
| count 3 18 4 | +5.00 ±0.78 pp | 29.9% [28.5, 31.3] | 51.6% [50.0, 53.1] | +2.15 | segurança falha 15% |
| count 3 18 5 | +5.80 ±0.80 pp | 23.7% [22.4, 25.0] | 47.5% [45.9, 49.0] | +2.27 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| count 3 24 4 | +3.70 ±0.79 pp | 35.2% [33.8, 36.7] | 54.4% [52.9, 56.0] | +2.34 | — |
| count 3 24 5 | +5.60 ±0.79 pp | 29.8% [28.4, 31.2] | 52.9% [51.4, 54.5] | +2.45 | segurança falha 15% |
| count 6 24 5 | +5.42 ±0.80 pp | 36.8% [35.3, 38.3] | 63.6% [62.1, 65.1] | +4.38 | — |
| count 6 48 5 | -1.98 ±1.01 pp | 54.6% [53.1, 56.1] | 67.8% [66.4, 69.3] | +6.07 | sem mudança |
| count 6 48 6 | +3.30 ±0.87 pp | 50.5% [49.0, 52.0] | 66.2% [64.7, 67.6] | +6.51 | — |
| fisher 3 12 0.05 | +5.70 ±0.79 pp | 22.7% [21.4, 24.0] | 43.0% [41.4, 44.5] | +2.00 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 12 0.1 | +5.70 ±0.79 pp | 22.7% [21.4, 24.0] | 43.0% [41.4, 44.5] | +2.00 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 24 0.1 | +5.90 ±0.80 pp | 24.5% [23.2, 25.9] | 50.3% [48.8, 51.9] | +3.28 | queda uniforme −10 pp; segurança falha 15% |
| fisher 3 24 0.2 | +3.70 ±0.79 pp | 35.2% [33.8, 36.7] | 54.4% [52.9, 56.0] | +2.41 | — |
| fisher 6 24 0.2 | +1.98 ±0.89 pp | 45.7% [44.2, 47.3] | 66.0% [64.5, 67.5] | +4.32 | — |
| fisher 6 48 0.2 | +5.38 ±0.82 pp | 46.9% [45.3, 48.4] | 65.6% [64.1, 67.1] | +7.52 | — |
| fisher 6 48 0.3 | +3.30 ±0.87 pp | 50.5% [49.0, 52.0] | 66.2% [64.7, 67.6] | +7.46 | — |

Modelo A com `--clean-base` (a base congelada de cada tarefa de segurança 12/12 continua 12/12, que é o que o gate real
vê). Gate de `main`: e15 44.6% [43.0, 46.1], e30 67.3% [65.8, 68.7] (a lacuna real é menor que os 34% e 49% do modelo A, mas continua).

| Desenho | Δ aprovação sem mudança (pareado) | Bloqueio e15 [IC95] | Bloqueio e30 [IC95] | US$ extra máx. | Cenário que piora |
|---|---|---|---|---|---|
| count 3 6 2 | -0.65 ±0.30 pp | 45.3% [43.8, 46.8] | 67.8% [66.4, 69.3] | +0.99 | sem mudança |
| count 6 6 2 | -2.65 ±0.53 pp | 50.0% [48.4, 51.5] | 74.3% [72.9, 75.6] | +2.71 | sem mudança |
| count 6 6 3 | +8.18 ±0.94 pp | 25.6% [24.3, 27.0] | 45.3% [43.8, 46.8] | +4.29 | queda uniforme −10 pp; queda uniforme −15 pp; 30% das tarefas −35 pp; segurança falha 15%; segurança falha 30% |
| count 3 12 3 | +4.90 ±0.89 pp | 42.1% [40.6, 43.6] | 70.6% [69.2, 72.0] | +1.96 | segurança falha 15% |
| count 3 12 4 | +8.38 ±0.94 pp | 29.8% [28.4, 31.3] | 58.8% [57.3, 60.3] | +2.65 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| count 6 12 3 | +3.33 ±0.97 pp | 50.4% [48.9, 52.0] | 83.2% [82.0, 84.3] | +4.07 | — |
| count 6 12 4 | +8.25 ±0.95 pp | 32.5% [31.0, 33.9] | 66.4% [64.9, 67.9] | +4.42 | queda uniforme −10 pp; segurança falha 15% |
| count 3 18 4 | +7.35 ±0.94 pp | 41.1% [39.6, 42.6] | 72.0% [70.6, 73.4] | +2.58 | segurança falha 15% |
| count 3 18 5 | +8.60 ±0.96 pp | 31.6% [30.2, 33.1] | 65.8% [64.3, 67.3] | +3.61 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| count 3 24 4 | +5.47 ±0.96 pp | 49.6% [48.1, 51.2] | 75.6% [74.3, 76.9] | +2.86 | — |
| count 3 24 5 | +8.33 ±0.95 pp | 41.4% [39.9, 43.0] | 73.8% [72.4, 75.1] | +3.08 | segurança falha 15% |
| count 6 24 5 | +8.10 ±0.96 pp | 52.0% [50.5, 53.6] | 89.7% [88.7, 90.6] | +6.12 | — |
| count 6 48 5 | -2.77 ±1.22 pp | 78.0% [76.6, 79.2] | 94.0% [93.2, 94.7] | +8.84 | sem mudança |
| count 6 48 6 | +4.83 ±1.06 pp | 73.2% [71.8, 74.5] | 93.3% [92.5, 94.1] | +9.50 | — |
| fisher 3 12 0.05 | +8.38 ±0.94 pp | 29.8% [28.4, 31.3] | 58.8% [57.3, 60.3] | +2.98 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 12 0.1 | +8.38 ±0.94 pp | 29.8% [28.4, 31.3] | 58.8% [57.3, 60.3] | +2.98 | queda uniforme −10 pp; segurança falha 15%; segurança falha 30% |
| fisher 3 24 0.1 | +8.70 ±0.96 pp | 33.0% [31.6, 34.5] | 69.8% [68.3, 71.2] | +5.32 | queda uniforme −10 pp; segurança falha 15% |
| fisher 3 24 0.2 | +5.47 ±0.96 pp | 49.6% [48.1, 51.2] | 75.6% [74.3, 76.9] | +2.99 | — |
| fisher 6 24 0.2 | +3.15 ±1.06 pp | 65.2% [63.8, 66.7] | 92.4% [91.5, 93.2] | +6.25 | — |
| fisher 6 48 0.2 | +7.80 ±0.99 pp | 68.0% [66.6, 69.5] | 93.2% [92.3, 93.9] | +18.70 | — |
| fisher 6 48 0.3 | +4.83 ±1.06 pp | 73.2% [71.8, 74.5] | 93.3% [92.5, 94.1] | +18.70 | — |

Leitura:

- Só os desenhos com 48 repetições (`count 6 48 5`, `fisher 6 48 0,2`) chegam perto dos alvos no modelo B (78% e 94%), com
  US$ 3,5 a 6,1 extras por PR (limite 0,30) e, no `count`, queda da aprovação sem mudança. Com US$ 0,015 por execução
  real em vez dos 0,09 de `est_cost_usd` o extra ainda seria ≥ US$ 0,58.
- Os desenhos que cabem em US$ 0,30 (k0 = 3, N ≤ 12) não passam de 30% a 50% de bloqueio em e15: o teste exato de
  Fisher contra uma base 12/12 tem pouco poder (p = 0,24 com 2 falhas em 12) e a taxa de falso bloqueio por tarefa
  sobe com N.
- Muitos desenhos aprovam mais em "sem mudança" e bloqueiam menos em e15: são menos sensíveis, não alternativas.
- O custo extra é medido contra o gate de `main` com a confirmação de segurança feita antes do olhar 2 (um bloqueio
  para o PR no olhar 1); `count 3 6 2`, equivalente à regra atual, mostra o crédito dessa ordem (≈ -US$ 0,2 a -4 por PR
  conforme o cenário) e deve ser descontado ao comparar.
- Limitação: as repetições de segurança extras das tarefas já estendidas pela discordância não são descontadas
  (aproximação conservadora do custo).

Decisão: a regra atual fica; nem 48 repetições por tarefa de segurança cumprem os alvos no modelo B calibrado (melhor:
58,5% em e15 e 89,6% em e30), e as variantes baratas mal diferem da regra atual. Decisão de mudar fica com o dono. Reprodução: `nice -n 10 python3 bench/tools/gate_sim.py
docs/bench/baseline-main/runs.jsonl --sec-grid [--clean-base | --resample-base] [--s1-usd 0.015] --iters 4000 --workers 6` (o padrão é o modelo B).

### Pesquisa

- Jennison & Turnbull, *Group Sequential Methods with Applications to Clinical Trials* (2000): olhares interinos
  pré-registrados com critério mais estrito no olhar antecipado preservam o erro do teste final.
- FDA, *Non-Inferiority Clinical Trials to Establish Effectiveness* (<https://www.fda.gov/media/78504/download>):
  margem pré-fixada e limite do IC contra a margem, como o -10 pp.
- "Efficient Benchmarking in Production", arXiv 2609.21267: subconjunto de tarefas ou IRT servem para ranquear, não para
  um gate de regressão, porque perdem a queda concentrada em poucas tarefas; por isso o gate mantém todas as tarefas e
  economiza em repetições.
- Alocação adaptativa só pré-registrada: as regras e as constantes acima são fixas antes de olhar os dados do PR.

### Riscos e lacunas

- O α1 não foi derivado por uma função de gasto de alfa; é calibrado por simulação contra a regra atual. O erro tipo I
  final depende do modelo de base reamostrada, não de um limite teórico.
- A segurança com falha de 15% é barrada em apenas 34% dos PRs (45% com a base 12/12 mantida; ver "Regra de segurança mais sensível"): a regra de
  segurança não mudou e continua fraca para falhas raras.
- O olhar 1 usa o IC pareado com k1 no candidato e k12 na base; com α1 = 0,01 e 42 tarefas o IC99 é largo, por isso
  decide poucas vezes cedo.
- Custo e turnos usam a mediana das razões por tarefa com k1: ruído maior que no k3, mitigado por C1 e T1 serem
  mais estritos que o limite final e por só PASS exigir C1/T1.
- Não houve rodada real do gate sequencial; a simulação é offline.

## Tier baseline

- `bench/suites.toml` tem o tier `baseline`: as mesmas unidades do tier `pr`, com S1, S4 e S5 em k=12 e S2 em k=4.
- O `docs/bench/baseline-main/` passa a ser gravado com ele:
  `python3 bench/run.py run --arm ny-pi --tier baseline --model <modelo> --budget-usd <teto> --out <dir>` na main.
- O `bench-nightly.sh` continua rodando o tier `full`; ele não grava o baseline do gate.
- Um baseline antigo (k=2) ainda carrega no gate, mas o intervalo fica mais largo e a taxa de aprovação medida acima
  não vale para ele.

## Tier hard (sob demanda)

- Suíte `s8` (`bench/suites/hard`, contrato em `bench/suites/README.md`): tarefas de vários arquivos, para
  comparar harnesses e medir partes do harness (ablações). Nunca entra no tier `pr`: o tempo e o custo do gate
  não mudam. Com Sonnet 5.5 ela saturou em acerto (2026-11-15: ny-pi e Claude Code 36 de 36, pi puro 34 de 36):
  serve para custo, turnos e tempo; diferença de acerto pede tarefas em que o modelo erra.
- Rodar, um braço por vez, na mesma máquina e com o mesmo `--jobs`:
  `python3 bench/run.py run --arm <braço> --tier hard --model <modelo> --budget-usd <teto> --jobs 6 --out <dir>`.
  Segure a trava do gate para não disputar a máquina com o `bench-pr`: prefixe com `flock "${BENCH_STATE:-$HOME/.local/state/bench}/lock"`.
- Comparar: `python3 bench/run.py scoreboard --ny <dir do ny-pi> --refs <dir de cada referência>`.
- Regra de leitura, fixada antes de rodar: nenhuma tarefa sai por causa do resultado (só por defeito da tarefa
  provado sem olhar o braço); "superior em acerto" só com o limite inferior do IC90 pareado acima de zero;
  "não inferior" com o limite acima de -10 pp; fora disso, "inconclusivo".
- Braços comparados: `ny-pi`, `pi-vanilla` e `cc-vanilla` (decisão do dono em 2026-11-15: o `omp` saiu das
  medições, dos placares e dos relatórios; os dados antigos dele ficam só como histórico).
- Toda execução falha é lida (`artifacts/*.test.out`): se o teste oculto cobra algo que nem o prompt nem o SPEC
  pedem, o defeito é da tarefa. Corrija o teste (não o SPEC, para não mudar o que o agente leu) e repontue as
  execuções já feitas a partir do `.diff` guardado: repositório inicial + diff + testes ocultos. Confira antes que
  o método reproduz o resultado gravado com os testes antigos. Antes de aceitar uma suíte nova, um revisor que
  não escreveu os casos confere cada asserção oculta contra o prompt e o SPEC.
- Custo entre braços: compare a razão por tarefa (média geométrica com intervalo), não a soma. Com `--jobs 6`
  as seis primeiras execuções gravam o prefixo em cache ao mesmo tempo (cerca de US$ 0,3 a 0,4 por rodada do
  ny-pi, qualquer que seja o tamanho); ao comparar rodadas de tamanhos diferentes, desconte a gravação do
  primeiro turno.
- Caso novo: escreva `repo/`, `hidden/`, `oracle/` e `case.json`, rode
  `python3 bench/suites/check_oracles.py --suite hard`; ele diz quais casos passam a ser held-out (30%, semente
  fixa) e exige que os testes ocultos falhem no estado inicial e passem com o oracle.

## Placar do objetivo

`python3 bench/run.py scoreboard --ny <rodada ny-pi> --refs <rodada> [<rodada> ...] [--out arquivo.md]` imprime o
placar das três regras do objetivo, em Markdown. É informativo: sai sempre com 0.

- Entram as tarefas em comum com cada referência, sem execução com erro.
- R1 acerto: taxa pontual do ny-pi maior ou igual à do `pi-vanilla`. A tabela traz também a diferença pareada e o
  IC90 contra cada referência.
- R2 teto de custo: custo do ny-pi menor ou igual ao de cada referência que não seja o `pi-vanilla` (este aparece só
  como informação). Custo = soma do custo médio por tarefa, para comparar rodadas com k diferente.
- R3 exceção: tarefas exclusivas, com taxa do ny-pi acima de 0,5 e taxa 0 em todas as referências. O placar lista
  também o inverso (todas as referências acima de 0,5 e ny-pi em 0).
- Veredito: `OBJETIVO: cumprido` quando R1 e (R2 ou pelo menos uma tarefa exclusiva); senão `não cumprido`, com as
  regras que falharam.
- Sem rodada do `pi-vanilla`, a R1 não é avaliada e conta como não cumprida; o mesmo vale para a R2 sem outra
  referência.

## Tornar `bench-pr` obrigatório

Adicione `{ "context": "bench-pr" }` (sem `integration_id`, pois o status vem do `gh api` do dono e não de um app) a
`required_status_checks` em `.github/rulesets/main.json` e aplique o ruleset:

```bash
jq '(.rules[] | select(.type=="required_status_checks").parameters.required_status_checks) += [{"context":"bench-pr"}]' \
  .github/rulesets/main.json > /tmp/main.json && mv /tmp/main.json .github/rulesets/main.json
id=$(gh api repos/$BENCH_REPO/rulesets -q '.[] | select(.name=="main") | .id')
gh api -X PUT "repos/$BENCH_REPO/rulesets/$id" --input .github/rulesets/main.json
```

Faça isso só depois do primeiro `bench-pr` verde e do baseline main commitado; antes disso todo PR ficaria bloqueado.

## Nightly

`bench-nightly.timer` roda às 03:30 `bench-nightly.sh`: tier full do ny-pi na `origin/main` atual, teto
`BENCH_NIGHTLY_BUDGET`, saída em `$BENCH_STATE/nightly/<data>`. Ele não atualiza o baseline: ao terminar com sucesso
imprime os comandos para preparar o PR de atualização de `docs/bench/baseline-main/` (veja `journalctl --user -u
bench-nightly`). Revise o veredito antes de abrir esse PR.

## Re-teste vanilla

Sob demanda, com teto explícito (sem `--budget-usd` o script recusa):

```bash
vanilla-retest.sh --budget-usd 20 [--arms cc-vanilla,pi-vanilla]
```

Roda só os braços vanilla (tier vanilla), divide o teto entre eles, grava em `$BENCH_STATE/vanilla/<data>` e imprime o
comando `bench report` que gera `docs/bench/BASELINE-VANILLA-<data>.md`. Rode-o numa branch nova e abra PR; um baseline
existente nunca é sobrescrito (outra data ou sufixo de hora). Quando um PR toca capacidade sem cobertura vanilla
(`docs/bench/coverage-map.json`), o veredito sugere este re-teste, que nunca roda sozinho.

## NOT_COMPARABLE

O overlay, o modelo ou a versão do braço mudou entre o baseline e o PR. Rode o baseline main de novo com o novo
contexto: `bench run --arm ny-pi --tier baseline` na main (veja "Tier baseline"), proponha o novo
`docs/bench/baseline-main/` por PR, e só então reroda o PR com `bench-pr.sh --pr N`.

Para a camada pessoal não mudar entre o baseline e os PRs, o braço `ny-pi` lê uma cópia congelada quando
`BENCH_OVERLAY_DIR` está definido (sem a variável, lê o `~/.pi/agent` vivo, e qualquer edição ali torna as rodadas
incomparáveis). Crie a cópia junto com cada baseline novo, antes da rodada, e use a mesma em todo PR:

```bash
. bench/arms/overlay-sha.sh
overlay_freeze ~/.pi/agent ~/.local/state/bench/overlay/<data> "$PWD/bench/arms/overlay.list"   # imprime o hash
echo 'BENCH_OVERLAY_DIR=<caminho da cópia>' >> ~/.config/nycode/bench.env
```

A cópia contém segredos (`local.env`): fica fora do repositório, com modo 700. O gate mede as regras pessoais da
data da cópia, não as do momento.

O hash do overlay ordena os arquivos no locale C desde 2026-11-15. Antes seguia o locale de quem rodava, e o mesmo
conteúdo dava `f6afa7d59fa0c8f8` em `en_US.UTF-8` e `c06e62526c0540fe` em C. O `meta.json` do baseline main foi
regravado só nesse campo, sem nova rodada: a cópia congelada é a mesma (conferida pelos dois hashes).

Se a montagem do stage falhar (por exemplo, `npm ci` do `install.sh`), a rodada para antes da primeira execução com
`ny-pi stage not built: <erro>`; o stage só vale com `.ready`. O braço aponta os diretórios do mise para o HOME
real, porque os shims recusam rodar sob o HOME do stage.

## Diagnóstico

`systemctl --user list-timers 'bench-*'`, `journalctl --user -u bench-pr`. Um `pending` preso (queda no meio da rodada)
é reprocessado no próximo ciclo, porque só `success` e `failure` são considerados finais.

## Paralelismo

`bench run` aceita `--jobs N` (padrão: `BENCH_JOBS`, ou 4):

- Com N maior que 1, as suítes rodam ao mesmo tempo e cada uma roda N unidades em paralelo.
- Com `--jobs 1`, tudo roda em sequência.
- O valor fica em `meta.json` (`jobs`). O gate devolve `NOT_COMPARABLE` quando o `jobs` do baseline e o do candidato diferem, porque o tempo medido muda com o paralelismo. Rodadas sem a chave contam como 1.
- Em paralelo, o S1 e o Harbor recebem o saldo do teto no início. A rodada pode passar do teto em até uma etapa de cada; nesse caso ela termina `not_verified`.
- A etapa Harbor usa janela deslizante: até N `harbor run` simultâneos, cada um com uma tarefa; ao terminar uma, a próxima começa, e o teto de gasto é checado antes de iniciar cada tarefa.
- Medição de referência (pi vanilla, S4 e S5, 22 execuções, `--jobs 6`): 47 s contra 355 s em sequência, com o mesmo custo e o mesmo tempo mediano por execução.

## Evidências por execução (engenharia reversa)

`python3 bench/run.py evidence --runs "<rodadas>/*" --out <rodadas>/EVIDENCE.md` gera um índice por execução: resultado, custo e tempo de cada braço, as tarefas em que um braço passou e outro falhou, as ferramentas usadas por braço e os caminhos absolutos dos logs. O arquivo contém caminhos locais e nomes de ferramentas dos transcritos; fica junto das rodadas e nunca vai para o repositório.

| suíte | transcrito do agente | resultado do verificador |
|---|---|---|
| S1 | `raw/<caso>-<rep>.jsonl` e `unit/<caso>-<rep>/` (`pi-events.jsonl`, workspace) em `~/.local/state/pelo-em-ovo/results/bench-<braço>-*` (braços da família pi) ou `~/.claude/evals/results/bench-cc-*` | `runs.jsonl` do round |
| S2, S3, S6 (Harbor) | `<round>/harbor/<job>/<tarefa>__<id>/agent/{pi.txt,claude-code.txt,trajectory.json}` | `verifier/{test-stdout.txt,reward.txt,ctrf.json}`, `result.json`, `trial.log` |
| S4, S5 | `<round>/artifacts/<suíte>-<tarefa>-<rep>.agent.out` (stream JSON) | `.test.out` ao lado |

Rodadas do eval com prefixo `bench-` não entram na rotação: só os rounds `sched-` são apagados.

## Registros por execução

Cada linha de `runs.jsonl` das suítes S4 e S5 traz quatro campos opcionais, lidos do transcrito do agente
(`message_end` com `usage` no pi e no omp, stream-json com `usage` no Claude Code):

| campo | conteúdo |
| --- | --- |
| `tokens` | `{input, output, cache_read, cache_write}` da execução |
| `turns` | mensagens do assistente |
| `tool_errors` | resultados de ferramenta com erro |
| `first_request_tokens` | `input + cache_read + cache_write` da primeira resposta do assistente (o contexto fixo do braço) |

- O valor é `null` quando o transcrito não traz o dado; S1 e Harbor gravam `null`.
- Rodadas antigas, sem os campos, continuam carregando em `gate`, `report`, `scoreboard` e `evidence`.
- O `evidence` preenche o que falta a partir do transcrito em disco e mostra as médias por braço em
  "Tokens and turns per arm".

O `evidence` também classifica cada falha por assinatura (primeira regra que casar) e conta as assinaturas por braço:

| assinatura | regra |
| --- | --- |
| `timeout` | o erro da execução cita timeout |
| `infra-error` | a execução tem outro erro |
| `plan-tool-then-stop` | falhou e a última ferramenta foi `plan_mode_complete` |
| `question-tool-error` | chamou `question` e o veredito traz `asked_question` falso |
| `no-change` | caso `outcome` que falhou sem ferramenta de edição, escrita, bash ou subagente |
| `tests-failed` | caso `outcome` que alterou algo e os testes ocultos falharam |
| `unclassified` | o resto (inclui S1 e Harbor, que não têm `verdict.json`) |

## Referências guardadas (rodam uma vez por conjunto de tarefas)

Regra do dono (2026-11-15): `cc-vanilla` e `pi-vanilla` rodam uma vez em cada conjunto de tarefas que nunca rodaram,
com tudo guardado (`runs.jsonl`, `meta.json`, jobs do Harbor ou artefatos, custo, tokens, turnos, tempo, versão do
braço, modelo). Gates e benchmarks seguintes rodam só o `ny-pi` contra a referência guardada; refazer uma referência
só a pedido explícito do dono ou com um gatilho (2026-11-18): troca do modelo do benchmark, nova versão do
Claude Code ou do pi nos braços, nova afirmação pública de comparação (braços intercalados nas mesmas tarefas, mesmo
modo de conta) ou ~1 mês desde a última medição. Nunca misture OAuth e chave de API numa comparação. Os diretórios ficam fora do repositório, no estado local do benchmark
(`$XDG_STATE_HOME/bench`, padrão `~/.local/state/bench`):

| Conjunto | Referências | Diretório | Medido em |
|---|---|---|---|
| 42 tarefas (S1–S5), k12 | `pi-vanilla` (pi 1.5.2) k12; `cc-vanilla` k2 | `ref-k12/pi-vanilla`; `baseline-2026-11/sonnet/cc-vanilla` | 2026-11-14/15, Sonnet 5.5 |
| Suíte difícil (12 tarefas, k3) | `cc-vanilla`, `pi-vanilla` | `hard-2026-11/{cc-vanilla,pi-vanilla,pi-vanilla-new4}` | 2026-11-15, Sonnet 5.5 |
| Terminal-Bench 2.0, amostra 1 (24 tarefas, k1, semente 20261115) | `cc-vanilla`, `pi-vanilla` | `tb2-sample-2026-11/{cc-vanilla,pi-vanilla}` (lista em `tasks.txt`) | 2026-11-15, Sonnet 5.5, esforço padrão |

## nycode: braços, tier `smoke` e modo de paridade (F3)

Decisões de F3 (`docs/migration/ny-pi-core/09-paridade-e-benchmark.md`):

- Env file do poster e das units: `~/.config/nycode/bench.env` (modo 0600) com `BENCH_REPO=marcioazam/nycode`; `bench-pr.sh`
  roda `--arm nycode`. `bench-nightly.sh` continua no braço `ny-pi` até a decisão de F10.
- Braço `nycode` (`bench/arms/nycode`): estágio `bench-nycode-<sha12>[-dirty]` com `HOME` descartável e
  `NYCODE_CODING_AGENT_DIR=<estágio>/.nycode/agent`; `npm ci --ignore-scripts` e `npm run build` na raiz do checkout;
  executa `packages/coding-agent/dist/bundle/cli.js`. Camada do dono em `bench/arms/overlay-nycode.list`
  (`settings.json`, `AGENTS.md` de `~/.nycode/agent` ou `BENCH_OVERLAY_DIR`); o hash vai para `.overlay-sha`. As flags só do
  pi-code (`--settings`, `--mcp-config`, `--setting-sources`, `--add-dir`, `--strict-mcp-config`) são descartadas até F5.
  O agente Harbor do nycode não existe: S2 com `--arm nycode` para com erro explícito.
- Braço `ny-pi-pi160` (D-25): o mesmo `bench/arms/ny-pi` com `BENCH_PI_VERSION=1.6.0` (tabela `env` do `arms.toml`),
  estágio `bench-nypi160-<sha12>`; exige um pi 1.6.0 gerenciado em `BENCH_PI_INSTALL_DIR` (o `~/.pi/agent/install` do
  dono é 1.5.2 e não serve). Sai com F10.
- Tier `smoke`: apelido do `pr` (`[tier.smoke] alias = "pr"`, D-27); a rodada e o diretório usam o nome `pr`.
- `bench gate --base <ref> --cand <rodada> --parity` (D-28): compara braços diferentes. Ignora `arm_version` e
  `overlay_sha`; `model` e `jobs` continuam exigindo igualdade; margem de custo 1,10; o `verdict.json` ganha
  `parity.ignored_meta` e `parity.cost_max`.
- Runner do `pi`: continua a skill `pelo-em-ovo` fora do repositório, via `BENCH_PELO_RUN_PI` (a skill sai de `claude-home` em F8).
