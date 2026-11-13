# Avaliação externa: Terminal-Bench 2.0 via Harbor, piloto (2026-11-13)

Objetivo: comparar o harness do pi com o Claude Code num benchmark público, gastando só cota da assinatura (pedido do
usuário). Piloto diagnóstico, não veredito: 10 tarefas e k1, então só uma diferença de mais de ~40 pp seria visível.

## Montagem
- Harbor 0.25.0 (`uvx --from harbor`), dataset `terminal-bench@2.0` (89 tarefas), modelo `anthropic/claude-opus-5-5`
  nos dois braços, OAuth da assinatura via env em tempo de execução. Nenhum token foi gravado em disco ou no bundle.
- Braços:
  - `pi-harness`: agente próprio em `bin/evals/harbor/pi_harness_agent.py`. Leva `~/.pi/agent` mais o wrapper para
    `~` no container, sem sessões, credenciais e backups (`bundle.sh` confere isso).
  - `claude-code`: o agente embutido do Harbor, Claude Code sem harness.
  - `pi-vanilla`: o pi embutido do Harbor, 1.5.2, sem harness; usado só no teste de recusas.
- Tarefas: amostra de 10 com semente 20261113 (`random.sample`, sem `fix-git`, que foi o smoke). Lista em
  `/tmp/tb2-pick.txt`: bn-fit-modify, break-filter-js-from-html, chess-best-move, compile-compcert, crack-7z-hash,
  extract-elf, merge-diff-arc-agi-task, polyglot-c-py, pytorch-model-recovery, torch-tensor-parallelism.
- Jobs em `~/.local/state/harbor-jobs/`: `tb2-pilot-pi`, `tb2-pilot-cc`, `tb2-rerun-pi`, `tb2-rerun-piv`.

## Resultado (reward 1 = passou; custo = estimativa a preço de lista informada pelo agente)

| tarefa | pi-harness | claude-code |
|---|---|---|
| bn-fit-modify | 1 ($0,09, 35 s) | 1 ($0,15, 34 s) |
| break-filter-js-from-html | recusa do provedor (2/2) | 1 ($0,45) |
| chess-best-move | 1 ($0,10) | 1 ($0,14) |
| compile-compcert | 0, timeout de 2400 s (build `-j24` morto por falta de memória, depois `-j4`) | 1 ($0,23, 1931 s) |
| crack-7z-hash | recusa do provedor (2/2) | 1 ($0,35) |
| extract-elf | 1 ($0,13) | 1 ($0,12) |
| merge-diff-arc-agi-task | 1 ($0,12) | 1 ($0,13) |
| polyglot-c-py | 0 | 0 |
| pytorch-model-recovery | 1 no rerun ($0,29); a 1ª falhou por bug do adaptador | 1 ($0,14) |
| torch-tensor-parallelism | 1 ($0,39, 110 s) | 1 ($0,20, 43 s) |

- Bruto: pi 5/10 (US$ 1,33) e CC 9/10 (US$ 2,00).
- Nas 8 tarefas sem recusa, com o bug do adaptador corrigido: pi 6/8 (US$ 1,45) e CC 7/8 (US$ 1,21). A única
  diferença é compile-compcert, numa amostra só.
- **Recusas:** "Cyber safeguards flagged this message" vem da API. O pi sem harness (`pi-vanilla`) também é barrado
  nas duas tarefas, com 2,5k tokens de entrada, só a instrução. Então a causa não é o preâmbulo do harness: o filtro
  trata o pi de forma diferente do cliente Claude Code. Não há conserto no harness que não seja tentar contornar um
  controle de segurança, o que está fora de cogitação. O caminho legítimo é o Cyber Verification Program que a
  mensagem cita, e cabe ao usuário decidir.
- **Bug do adaptador** (corrigido): uma instrução que começa com "-" virava opção da CLI do pi ("Error: Unknown
  option"). Agora o adaptador põe `--` antes da instrução. O pi embutido do Harbor tem o mesmo problema; isso não
  foi reportado.

## Leitura
- Em acerto, empate dentro do ruído nas tarefas que o pi pode rodar. Em custo, o pi saiu 1,2× mais caro nessas 8.
  Isso inverte o resultado das evals internas (pi com 41–48% do custo do CC). Causa provável: o preâmbulo fixo de
  ~31k tokens pesa mais em tarefas curtas de terminal, como no smoke `fix-git` (270k contra 116k tokens de entrada).
- Antes de qualquer conclusão: k ≥ 3 nas 89 tarefas, ou pelo menos 30, nos três braços, para separar harness de pi.
  Custo estimado: ~US$ 60–90 de cota.

## Gasto
Cerca de US$ 4,6 a preço de lista, em cota da assinatura: smoke US$ 0,39, piloto US$ 3,33, reruns US$ 0,48.
