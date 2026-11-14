# Baseline vanilla 2026-11 (congelado)

Este é o baseline do benchmark do repositório **ny-pi**, tirado em 2026-11-14. Ele mede o braço `ny-pi` e três referências fixas: o Claude Code vanilla (`cc-vanilla`), o pi vanilla (`pi-vanilla`) e o Oh My Pi (`omp`). Daqui em diante as PRs rodam só o `ny-pi` e comparam com `docs/bench/baseline-main/`; as referências só são medidas de novo sob demanda (`bench/tools/vanilla-retest.sh`).

**Condições da rodada:**

- Tier `vanilla`, igual às unidades do tier `pr`:
  - S1: o subconjunto pr, k2. Quatro casos do conjunto de evals declaram `reps: 1`, então são 28 execuções.
  - S4 e S5: k2.
  - S2: 4 tarefas do Terminal-Bench 2.0, k1.
- Opus: só S4 e S5, k1.
- Terminal-Bench 4.1 (suíte `s6`): 6 tarefas, k1, só no Sonnet. Detalhes na seção própria.
- Modelos `claude-sonnet-5-5` e `claude-opus-5-5`, esforço médio em todos os braços.

**Versões:** Claude Code 2.1.323, pi 1.5.2, Oh My Pi 18.20.0 e o overlay do ny-pi `83d8038f5782c040`. Os casos de pergunta refeitos e o Terminal-Bench 4.1 rodaram com o overlay `00cb354716d14d16`: o checkout só ganhou arquivos do benchmark em `claude-home/bin/evals/harbor`, e o harness é o mesmo. Execuções com erro de infraestrutura foram refeitas com `--resume` e não entram nos números.

**O que ficou fora:** o S3 (SWE-bench Pro) e as 73 tarefas restantes do Terminal-Bench 2.0 saíram do baseline por decisão do dono (2026-11-14: o baseline completo levava mais de 12 h). Eles ficam no tier `full`, sob demanda.

## Resumo

| modelo | braço | execuções | acerto | custo total US$ | custo mediano US$ | wall p50 s |
|---|---|---|---|---|---|---|
| sonnet | cc-vanilla | 76 | 73/76 (96.1%) | 5.57 | 0.0645 | 17.6 |
| sonnet | pi-vanilla | 76 | 74/76 (97.4%) | 2.10 | 0.0231 | 13.6 |
| sonnet | omp | 76 | 69/76 (90.8%) | 7.54 | 0.0931 | 17.2 |
| sonnet | ny-pi | 76 | 62/76 (81.6%) | 7.06 | 0.0861 | 18.8 |
| opus | cc-vanilla | 22 | 20/22 (90.9%) | 3.36 | 0.1585 | 34.3 |
| opus | pi-vanilla | 22 | 22/22 (100.0%) | 1.74 | 0.0780 | 27.9 |
| opus | omp | 22 | 21/22 (95.5%) | 6.63 | 0.2831 | 43.4 |
| opus | ny-pi | 22 | 20/22 (90.9%) | 5.43 | 0.2462 | 52.2 |

**Leitura** (Sonnet, as mesmas 76 unidades nos quatro braços):

- O pi vanilla é o mais barato e o que mais acerta: 74/76 por US$ 2.10.
- O ny-pi acerta 62/76 e custa US$ 7.06: fica 12 execuções abaixo do pi vanilla, custa 3,4x o pi vanilla e 1,3x o Claude Code.
- A perda do ny-pi está quase toda no **S4**, a suíte de plano: 14/24, contra 24/24 dos dois vanilla e 21/24 do omp.
  - Em 6 execuções de implementação ele chama `plan_mode_complete` fora do modo plano e para à espera de aprovação.
  - Em 4 execuções de pergunta a ferramenta `question` falha sem interface e a resposta final sai sem pergunta.
  - Toda execução do ny-pi que chegou a implementar passou nos testes ocultos (10 de 10).
- No **S1** (comportamento) o ny-pi e o Claude Code empatam em 27/28; o omp faz 25/28.
- No **S2** (Terminal-Bench 2.0) só o omp perde uma tarefa (3/4).
- O omp é o braço mais caro (US$ 7.54) e fica entre os vanilla e o ny-pi em acerto.
- No Opus, o pi vanilla acerta 22/22; o ny-pi e o Claude Code acertam 20/22, e o ny-pi custa 1,6x o Claude Code.

**Limitação estatística:** com 76 unidades e IC95 largo por suíte, os números são uma referência de ordem de grandeza. Eles não provam diferenças pequenas entre os braços.

## Mudança de regra do avaliador (2026-11-14)

A primeira versão deste baseline exigia, nos 4 casos de pergunta do S4, **todos** os termos de `ask_terms` na resposta. O contrato em `bench/suites/README.md` pede **pelo menos um**: os termos são variantes de grafia, como "período" e "periodo". Com a regra errada esses casos eram quase impossíveis (pi vanilla 1/8, os outros 0/8).

O avaliador foi corrigido e os 4 casos foram executados de novo em todos os braços. Por isso o S4 e os totais desta versão são maiores que os da primeira: no Sonnet, o Claude Code passou de 65 para 73, o pi vanilla de 67 para 74 e o ny-pi de 58 para 62. As execuções dos outros casos são as mesmas.

## Oh My Pi

O braço `omp` é o Oh My Pi 18.20.0 (`can1357/oh-my-pi`, um fork do pi), no binário de release com SHA256 conferido.

**Configuração do braço:**

- `--thinking medium`, o mesmo esforço dos outros braços.
- HOME descartável por chamada, porque o omp lê `~/.omp`, `~/.claude` e `~/.codex`.
- Auto QA desligado (`PI_AUTO_QA=0`) e checagem de versão desligada.
- `PI_PROXY` recebe o valor de `HTTPS_PROXY`: o transporte do omp para a Anthropic ignora `HTTPS_PROXY`, e sem isso os casos do S1 que rodam atrás do proxy de saída falhavam por falta de rede.

**Observações de rede** (verificação de configuração e tráfego; o código não foi auditado por inteiro):

- Na partida o omp consulta dois catálogos de modelos (`catalog.stencil.so` e `coding-intl.dashscope.aliyuncs.com`), além de `api.anthropic.com`.
- Executado com o diretório de trabalho na pasta pessoal do usuário, ele trata a pasta como projeto e inicia os servidores MCP configurados ali. No benchmark isso não ocorre: o diretório de trabalho é uma subpasta e o HOME é descartável.

**Contas:** as rodadas usaram três contas, com o mesmo modelo e a mesma configuração, porque o limite de uso foi atingido no meio. O omp no Sonnet ficou dividido entre duas delas; os casos de pergunta refeitos rodaram em uma e o Terminal-Bench 4.1 inteiro em outra. O omp no Opus rodou com `--jobs 4` (unidades em paralelo); o tempo dele não é comparável ao dos outros braços do Opus, que rodaram em sequência.

## Terminal-Bench 4.1

Suíte `s6`: 6 tarefas de CPU do `terminal-bench/terminal-bench@4.1.0`, k1, Sonnet, as mesmas 6 nos quatro braços.

**Como as 6 foram escolhidas:** sorteio estratificado de 12 tarefas por categoria e, depois, sorteio de 6 dessas 12 (semente 20261114), por decisão do dono para caber em tempo e gasto. A lista e as 6 descartadas estão em `bench/tasks/tb41.json`; as 3 tarefas que pedem GPU estão em `bench/tasks/tb41.excluded.json`.

**Não é comparável ao placar público:** além de ser um subconjunto, cada tarefa tem teto de 1 hora (multiplicador 0,125 do tempo do agente).

| braço | resolvidas | quais | custo US$ | tempo somado min |
|---|---|---|---|---|
| cc-vanilla | 1/6 | `risk-scorer-replay` | 3.15 | 40 |
| pi-vanilla | 1/6 | `risk-scorer-replay` | 2.05 | 17 |
| omp | 1/6 | `risk-scorer-replay` | 1.83 | 40 |
| ny-pi | 2/6 | `fin-saccr-rwa`, `risk-scorer-replay` | 2.79 | 23 |

| tarefa | cc-vanilla | pi-vanilla | omp | ny-pi |
|---|---|---|---|---|
| `cad-model` | falhou | falhou | falhou | falhou |
| `fin-saccr-rwa` | falhou | falhou | falhou | passou |
| `ks-solver-cpp` | falhou | falhou | falhou | falhou |
| `production-planning` | falhou | falhou | falhou | falhou |
| `risk-scorer-replay` | passou | passou | passou | passou |
| `session-window-debug` | falhou | falhou | falhou | falhou |

**Leitura:**

- O ny-pi resolveu 2 das 6; os outros três resolveram 1 cada.
- `fin-saccr-rwa` só foi resolvida pelo ny-pi. É uma única execução por braço, então isso é um indício, não uma prova.
- Quatro tarefas não foram resolvidas por nenhum braço.

## Sonnet 5.5, por suíte

| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |
|---|---|---|---|---|---|---|---|
| cc-vanilla | 2.1.323 (Claude Code) | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:35:53+00:00 | 20.0 | False |
| pi-vanilla | 1.5.2 | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:34:25+00:00 | 20.0 | False |
| omp | 18.20.0 | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:40:34+00:00 | 20.0 | False |
| ny-pi | 1.5.2 | claude-sonnet-5-5 | 00cb354716d14d16 | 6d2e408ed390 | 2026-11-14T20:37:57+00:00 | 20.0 | False |

## s1

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 16 | 28 | 0.938 | [0.62, 1.00] | 0.0645 | 9.6 | 8/8 | 0 | 0 |
| pi-vanilla | 16 | 28 | 0.938 | [0.62, 1.00] | 0.0085 | 7.2 | 7/8 | 0 | 0 |
| omp | 16 | 28 | 0.906 | [0.62, 0.97] | 0.0718 | 9.7 | 7/8 | 0 | 0 |
| ny-pi | 16 | 28 | 0.969 | [0.78, 1.00] | 0.0672 | 13.0 | 7/8 | 0 | 0 |

## s2

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 4 | 4 | 1.000 | [1.00, 1.00] | 0.1545 | 113.0 | - | 0 | 0 |
| pi-vanilla | 4 | 4 | 1.000 | [1.00, 1.00] | 0.0897 | 68.1 | - | 0 | 0 |
| omp | 4 | 4 | 0.750 | [0.00, 1.00] | 0.1571 | 97.3 | - | 0 | 0 |
| ny-pi | 4 | 4 | 1.000 | [1.00, 1.00] | 0.2206 | 134.2 | - | 0 | 0 |

## s4

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 12 | 24 | 1.000 | [1.00, 1.00] | 0.0546 | 20.1 | - | 0 | 0 |
| pi-vanilla | 12 | 24 | 1.000 | [1.00, 1.00] | 0.0234 | 13.6 | - | 0 | 0 |
| omp | 12 | 24 | 0.875 | [0.54, 0.96] | 0.0926 | 17.7 | - | 0 | 0 |
| ny-pi | 12 | 24 | 0.583 | [0.33, 0.75] | 0.0880 | 20.1 | - | 0 | 0 |

## s5

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 10 | 20 | 0.900 | [0.40, 1.00] | 0.0683 | 22.5 | - | 0 | 0 |
| pi-vanilla | 10 | 20 | 1.000 | [1.00, 1.00] | 0.0351 | 17.1 | - | 0 | 0 |
| omp | 10 | 20 | 1.000 | [1.00, 1.00] | 0.1050 | 19.3 | - | 0 | 0 |
| ny-pi | 10 | 20 | 0.850 | [0.45, 0.95] | 0.0932 | 21.8 | - | 0 | 0 |

## Opus 5.5 (S4 e S5), por suíte

| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |
|---|---|---|---|---|---|---|---|
| cc-vanilla | 2.1.323 (Claude Code) | claude-opus-5-5 | - | 6d2e408ed390 | 2026-11-14T20:46:00+00:00 | 20.0 | False |
| pi-vanilla | 1.5.2 | claude-opus-5-5 | - | 6d2e408ed390 | 2026-11-14T20:42:44+00:00 | 20.0 | False |
| omp | 18.20.0 | claude-opus-5-5 | - | 6d2e408ed390 | 2026-11-14T21:34:39+00:00 | 11.0 | False |
| ny-pi | 1.5.2 | claude-opus-5-5 | 00cb354716d14d16 | 6d2e408ed390 | 2026-11-14T20:47:02+00:00 | 20.0 | False |

## s4

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 12 | 12 | 0.917 | [0.50, 1.00] | 0.1283 | 25.8 | - | 0 | 0 |
| pi-vanilla | 12 | 12 | 1.000 | [1.00, 1.00] | 0.0693 | 27.6 | - | 0 | 0 |
| omp | 12 | 12 | 1.000 | [1.00, 1.00] | 0.2831 | 37.9 | - | 0 | 0 |
| ny-pi | 12 | 12 | 0.833 | [0.42, 0.92] | 0.2567 | 49.6 | - | 0 | 0 |

## s5

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 10 | 10 | 0.900 | [0.40, 1.00] | 0.1729 | 38.6 | - | 0 | 0 |
| pi-vanilla | 10 | 10 | 1.000 | [1.00, 1.00] | 0.0828 | 28.2 | - | 0 | 0 |
| omp | 10 | 10 | 0.900 | [0.40, 1.00] | 0.2972 | 45.7 | - | 0 | 0 |
| ny-pi | 10 | 10 | 1.000 | [1.00, 1.00] | 0.2418 | 53.4 | - | 0 | 0 |

## Terminal-Bench 4.1, por braço

| arm | versão | modelo | overlay | git | início | teto US$ | not_verified |
|---|---|---|---|---|---|---|---|
| cc-vanilla | 2.1.323 (Claude Code) | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:36:53+00:00 | 40.0 | False |
| pi-vanilla | 1.5.2 | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:27:19+00:00 | 40.0 | False |
| omp | 18.20.0 | claude-sonnet-5-5 | - | 6d2e408ed390 | 2026-11-14T20:27:18+00:00 | 40.0 | False |
| ny-pi | 1.5.2 | claude-sonnet-5-5 | 00cb354716d14d16 | 6d2e408ed390 | 2026-11-14T21:17:16+00:00 | 40.0 | False |

## s6

| arm | tarefas | runs | acerto | IC95 | custo mediano US$ | wall p50 s | segurança | subagentes | erros |
|---|---|---|---|---|---|---|---|---|---|
| cc-vanilla | 6 | 6 | 0.167 | [0.00, 0.33] | 0.2757 | 184.8 | - | 0 | 0 |
| pi-vanilla | 6 | 6 | 0.167 | [0.00, 0.33] | 0.1602 | 114.3 | - | 0 | 0 |
| omp | 6 | 6 | 0.167 | [0.00, 0.33] | 0.2002 | 142.1 | - | 0 | 0 |
| ny-pi | 6 | 6 | 0.333 | [0.00, 0.67] | 0.2129 | 160.3 | - | 0 | 0 |

## Dados

- **Rodadas brutas:** `docs/bench/baseline-vanilla-2026-11/<sonnet|opus|tb41>/<braço>/{runs.jsonl,meta.json}`.
- **Agregados:** `docs/bench/BASELINE-VANILLA-2026-11.json`.
- **Baseline do gate de PR:** `docs/bench/baseline-main/` (ny-pi, Sonnet, as mesmas unidades do tier `pr`).
- **Evidências por execução:** ver `docs/bench/RUNBOOK.md`, seção "Evidências por execução".
