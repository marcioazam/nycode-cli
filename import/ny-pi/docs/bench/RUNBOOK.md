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
mkdir -p ~/.config/systemd/user ~/.config/ny-pi
cp bench/tools/systemd/bench-pr.{service,timer} bench/tools/systemd/bench-nightly.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bench-pr.timer bench-nightly.timer
```

Instale os scripts a partir da `main` (não de uma worktree de dev) e repita o `install` quando eles mudarem.
Pré-requisitos no PATH: `gh` autenticado como o dono do repositório, `git`, `jq`, `flock`, `python3`.

## Env file

`~/.config/ny-pi/bench.env` (modo 0600, nunca versionado, formato `CHAVE=valor`):

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
4. Rodar um PR à mão: `bench-pr.sh --pr N` (ignora o status final e reroda).
5. Contrato mudou em 2026-11-17 por decisão do dono: o benchmark só roda quando o PR muda o comportamento funcional do
   harness. Antes do `pending`, `bench run affects` (`bench/classify/affects.py`) lê `git diff base...head`: se todo arquivo for
   documentação, teste, CI/ferramental do repositório, infra do próprio bench, licença ou só UI (temas, HUD,
   statusline, extensões visuais, patches só de renderização), o status vira `success` com "N/A: sem mudança
   funcional" e um comentário lista os arquivos; nada roda. Fail closed: caminho desconhecido, `*.md` instalado no
   harness (`claude-home/**`, prompts), `publish.list` que instala ou remove algo e erro do classificador contam como funcional.
   Refinamentos: `claude-home/docs/**` é registro (não funcional), salvo se algum `.md` de instrução instalado sob
   `claude-home/` (fora de `docs/`) citar o caminho (`docs/...`, ou o diretório que o contém) no head; extensões só
   interativas (`sound-notify`, `dev-commands`, `up-dequeue`, `puxar`) e `.pre-commit-config.yaml` não contam; um
   `claude-home/patches/pi-code/*.patch` é UI só se todo arquivo que ele altera (`+++ b/...` no head) for
   `subagent/fleet-ui/*`, `status-line.ts`, `notify.ts` ou `*.md`; patch sem alvos ou removido é funcional.
6. Modo chave de API no `bench-pr.sh`: com `BENCH_API_KEY_FILE` definido (e `BENCH_ANTHROPIC_WORKSPACE_ID` para chave de
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

Leitura honesta dos números: neste modelo (base reamostrada com encolhimento, tarefas 100% não determinísticas) a regra
atual aprova um PR sem mudança em 78%, não 98%, e barra -10 pp em 88%, não 96%; a simulação anterior (citada acima)
usava outro modelo e não é comparável. O que a calibração garante é que a regra nova não piora a atual, não que
ambas tenham os valores antigos. Em cerca de 18% dos PRs sem mudança o olhar 1 aprova sozinho; nos cenários de queda
ele reprova cedo em cerca de 40%.

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
- A segurança com falha de 15% é barrada em apenas 34% dos PRs (tanto na regra atual quanto na nova): a regra de
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
echo 'BENCH_OVERLAY_DIR=<caminho da cópia>' >> ~/.config/ny-pi/bench.env
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
só a pedido explícito do dono. Os diretórios ficam fora do repositório, no estado local do benchmark
(`$XDG_STATE_HOME/bench`, padrão `~/.local/state/bench`):

| Conjunto | Referências | Diretório | Medido em |
|---|---|---|---|
| 42 tarefas (S1–S5), k12 | `pi-vanilla` (pi 1.5.2) k12; `cc-vanilla` k2 | `ref-k12/pi-vanilla`; `baseline-2026-11/sonnet/cc-vanilla` | 2026-11-14/15, Sonnet 5.5 |
| Suíte difícil (12 tarefas, k3) | `cc-vanilla`, `pi-vanilla` | `hard-2026-11/{cc-vanilla,pi-vanilla,pi-vanilla-new4}` | 2026-11-15, Sonnet 5.5 |
| Terminal-Bench 2.0, amostra 1 (24 tarefas, k1, semente 20261115) | `cc-vanilla`, `pi-vanilla` | `tb2-sample-2026-11/{cc-vanilla,pi-vanilla}` (lista em `tasks.txt`) | 2026-11-15, Sonnet 5.5, esforço padrão |
