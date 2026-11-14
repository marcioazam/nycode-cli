# Runbook do benchmark (bench-pr, nightly, re-teste vanilla)

O que se mede: o benchmark e a eval **deste repositório, o ny-pi** (antes chamado `pi-harness`). O braço `ny-pi`
monta o harness a partir do checkout avaliado (head da PR ou main) num HOME descartável. Só a camada pessoal, não
rastreada e listada em `bench/arms/overlay.list`, vem da máquina do dono. O `~/.pi` local nunca é medido. Os
braços `pi-vanilla` e `cc-vanilla` (Claude Code) são as referências fixas.

O gate de benchmark não usa runner self-hosted (L1). Um poster local, na máquina do dono, roda o ny-pi no head de cada
PR e publica o commit status obrigatório `bench-pr`. Regra do gate: D6 em
o registro local do plano `pi-harness-ci-2026-11-13` (fora deste repositório).

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

## Fluxo do PR

1. A cada 10 min `bench-pr.timer` chama `bench-pr.sh --poll`. Só entram PRs abertos do mesmo repositório e do dono;
   forks e outros autores são ignorados, assim como heads que já têm `bench-pr` final (`success` ou `failure`).
2. Para cada PR elegível: status `pending`; worktree descartável do head em `$BENCH_STATE/wt/<sha>` (clone próprio em
   `$BENCH_STATE/repo`); `bench run --arm ny-pi --tier pr --budget-usd 12` dentro dela; `bench gate` contra o baseline
   main; status final; worktree removida. O resumo completo fica em `$BENCH_STATE/runs/<sha>/summary.md`.
3. Um lock (`$BENCH_STATE/lock`) impede duas execuções simultâneas (PR, nightly e vanilla).
4. Rodar um PR à mão: `bench-pr.sh --pr N` (ignora o status final e reroda).

| Exit do gate | Status | Significado |
| --- | --- | --- |
| 0 PASS | `success` | D6 satisfeita |
| 1 FAIL | `failure` | alguma regra de D6 falhou |
| 3 INCONCLUSIVE | `failure` | continua inconclusivo após a extensão única |
| 4 NOT_COMPARABLE | `error` | metadados do baseline e do PR diferem |
| 5 NOT_VERIFIED | `error` | orçamento esgotado antes de terminar (nunca aprovado) |

Sem baseline main, run que falha ou exit inesperado também viram `error` (fail closed): o merge fica bloqueado.

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
contexto: `bench-nightly.sh` (ou `bench run --arm ny-pi --tier full` na main), proponha o novo
`docs/bench/baseline-main/` por PR, e só então reroda o PR com `bench-pr.sh --pr N`.

## Diagnóstico

`systemctl --user list-timers 'bench-*'`, `journalctl --user -u bench-pr`. Um `pending` preso (queda no meio da rodada)
é reprocessado no próximo ciclo, porque só `success` e `failure` são considerados finais.
