# Baseline vanilla 2026-11 (congelado)

Este é o baseline do benchmark do repositório **ny-pi**, tirado **uma única vez** em 2026-11-14. Ele mede o braço `ny-pi` e duas referências fixas: o Claude Code vanilla (`cc-vanilla`) e o pi vanilla (`pi-vanilla`). Daqui em diante as PRs rodam só o braço `ny-pi`, e o gate compara cada PR com `docs/bench/baseline-main/`. Os braços vanilla só são re-testados sob demanda, com `bench/tools/vanilla-retest.sh` (RUNBOOK).

**Condições da rodada:**
- Bench em `b346ace`, com o tier `vanilla` igual às unidades do tier `pr`:
  - S1: o subconjunto pr, k2. Quatro casos do conjunto de evals declaram `reps: 1`, então são 28 execuções.
  - S4 e S5: k2.
  - S2: 4 tarefas do Terminal-Bench 2.0, k1.
- Opus: só S4 e S5, k1.
- Todos os braços usaram a mesma conta.

**Versões:** Claude Code 2.1.323, pi 1.5.2, e o overlay do ny-pi `83d8038f5782c040`. Execuções com erro de infraestrutura foram refeitas com `--resume` e não entram nos números.

**O que ficou fora:** o S3 (SWE-bench Pro) e as 73 tarefas restantes do Terminal-Bench saíram do baseline por decisão do dono (2026-11-14: o baseline completo levava mais de 12 h). Eles ficam no tier `full`, sob demanda.

## Resumo

| modelo | braço | execuções | acerto | custo total US$ | custo mediano US$ | wall p50 s |
|---|---|---|---|---|---|---|
| sonnet | cc-vanilla | 76 | 65/76 (85.5%) | 5.55 | 0.0645 | 17.1 |
| sonnet | pi-vanilla | 76 | 67/76 (88.2%) | 2.11 | 0.0231 | 13.5 |
| sonnet | ny-pi | 76 | 58/76 (76.3%) | 7.03 | 0.0854 | 18.5 |
| opus | cc-vanilla | 22 | 16/22 (72.7%) | 3.36 | 0.1585 | 34.3 |
| opus | pi-vanilla | 22 | 18/22 (81.8%) | 1.74 | 0.0780 | 27.6 |
| opus | ny-pi | 22 | 17/22 (77.3%) | 5.42 | 0.2462 | 52.2 |

**Leitura** (Sonnet, as mesmas 76 unidades nos três braços):
- O ny-pi fica 9 a 12 pp abaixo dos vanilla e custa 1,3x o Claude Code e 3,3x o pi vanilla.
- A perda está quase toda no **S4**, a suíte de plano: o ny-pi acerta 0,42, contra 0,67 a 0,71 dos vanilla.
  - Causa conhecida: com o prompt "Planeje antes de implementar." e sem interface, o ny-pi entrega só o plano e não implementa.
  - Esse é o primeiro alvo de correção no harness.
- No **S1** (comportamento) o ny-pi é o melhor: 0,97 contra 0,94.
- No **S2** (Terminal-Bench) os três empatam em 4/4.
- No Opus, o ny-pi fica entre os dois vanilla em acerto e é o mais caro.

**Limitação estatística:** com 76 unidades e IC95 largo por suíte, os números são uma referência de ordem de grandeza. Eles não provam diferenças pequenas entre os vanilla.

## Sonnet 5.5, por suíte

| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |
|---|---|---|---|---|---|---|---|
| cc-vanilla | 2.1.323 (Claude Code) | claude-sonnet-5-5 | - | b346aceb1bf9 | 2026-11-14T15:10:45+00:00 | 12.0 | False |
| pi-vanilla | 1.5.2 | claude-sonnet-5-5 | - | b346aceb1bf9 | 2026-11-14T13:49:03+00:00 | 12.0 | False |
| ny-pi | 1.5.2 | claude-sonnet-5-5 | 83d8038f5782c040 | b346aceb1bf9 | 2026-11-14T15:15:16+00:00 | 12.0 | False |

## s1

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 16 | 28 | 0.938 | [0.62, 1.00] | 0.0645 | 9.6 | 8/8 | 0 | 0 |
| pi-vanilla | 16 | 28 | 0.938 | [0.62, 1.00] | 0.0085 | 7.2 | 7/8 | 0 | 0 |
| ny-pi | 16 | 28 | 0.969 | [0.78, 1.00] | 0.0672 | 13.0 | 7/8 | 0 | 0 |

## s2

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 4 | 4 | 1.000 | [1.00, 1.00] | 0.1545 | 113.0 | - | 0 | 0 |
| pi-vanilla | 4 | 4 | 1.000 | [1.00, 1.00] | 0.0897 | 68.1 | - | 0 | 0 |
| ny-pi | 4 | 4 | 1.000 | [1.00, 1.00] | 0.2206 | 134.2 | - | 0 | 0 |

## s4

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 12 | 24 | 0.667 | [0.25, 0.83] | 0.0546 | 19.2 | - | 0 | 0 |
| pi-vanilla | 12 | 24 | 0.708 | [0.38, 0.88] | 0.0234 | 13.5 | - | 0 | 0 |
| ny-pi | 12 | 24 | 0.417 | [0.17, 0.62] | 0.0844 | 19.8 | - | 0 | 0 |

## s5

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 10 | 20 | 0.900 | [0.40, 1.00] | 0.0683 | 22.5 | - | 0 | 0 |
| pi-vanilla | 10 | 20 | 1.000 | [1.00, 1.00] | 0.0351 | 17.1 | - | 0 | 0 |
| ny-pi | 10 | 20 | 0.850 | [0.45, 0.95] | 0.0932 | 21.8 | - | 0 | 0 |

## Opus 5.5 (S4 e S5), por suíte

| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |
|---|---|---|---|---|---|---|---|
| cc-vanilla | 2.1.323 (Claude Code) | claude-opus-5-5 | - | b346aceb1bf9 | 2026-11-14T15:53:20+00:00 | 11.0 | False |
| pi-vanilla | 1.5.2 | claude-opus-5-5 | - | b346aceb1bf9 | 2026-11-14T15:42:59+00:00 | 11.0 | False |
| ny-pi | 1.5.2 | claude-opus-5-5 | 83d8038f5782c040 | b346aceb1bf9 | 2026-11-14T16:05:50+00:00 | 11.0 | False |

## s4

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 12 | 12 | 0.583 | [0.17, 0.75] | 0.1283 | 25.8 | - | 0 | 0 |
| pi-vanilla | 12 | 12 | 0.667 | [0.25, 0.83] | 0.0693 | 24.8 | - | 0 | 0 |
| ny-pi | 12 | 12 | 0.583 | [0.25, 0.75] | 0.2567 | 49.6 | - | 0 | 0 |

## s5

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 10 | 10 | 0.900 | [0.40, 1.00] | 0.1729 | 38.6 | - | 0 | 0 |
| pi-vanilla | 10 | 10 | 1.000 | [1.00, 1.00] | 0.0828 | 28.2 | - | 0 | 0 |
| ny-pi | 10 | 10 | 1.000 | [1.00, 1.00] | 0.2418 | 53.4 | - | 0 | 0 |

## Dados

- **Rodadas brutas:** `docs/bench/baseline-vanilla-2026-11/<modelo>/<braço>/{runs.jsonl,meta.json}`.
- **Agregados:** `docs/bench/BASELINE-VANILLA-2026-11.json`.
- **Baseline do gate de PR:** `docs/bench/baseline-main/` (ny-pi, Sonnet, as mesmas unidades do tier `pr`).
