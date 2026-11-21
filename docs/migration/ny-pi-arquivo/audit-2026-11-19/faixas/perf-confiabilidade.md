# Faixa perf-confiabilidade (relatório bruto do subagente, 2026-11-19)

**Status: complete (somente leitura).** Nenhum arquivo do repositório foi alterado. Medições só locais, sem modelo nem rede, saídas em `/tmp`. Carga durante a medição: `load average` 7,1–10,1 (24 threads); todos os tempos são média ± σ sob essa carga. O repositório não tem índice codegraph, então a cobertura é degradada (`rg`/leitura direta). Não rodei o pi real, a suíte de testes nem o benchmark. Não injetei nenhuma falha: os achados de confiabilidade abaixo vêm de leitura de código e estão marcados como hipótese, exceto onde a linha diz "reproduzido". Não repeti o que `docs/perf-sota.md` e `docs/sync-observabilidade.md` já registram como corrigido (por exemplo `horaDe` e os defeitos D1–D15).

## Medições

| Item | Resultado |
|---|---|
| `python3 guard.py`, Bash e Read | 26,5 ± 1,0 ms e 25,4 ± 1,3 ms |
| `python3 -S -c pass` (piso do interpretador) | 4,0 ± 0,4 ms |
| `import json,os,sys,re,shlex` | 15,0 ± 2,5 ms |
| `import … tempfile` | 20,2 ± 3,1 ms |
| `import … tempfile,traceback` | 31,3 ± 3,6 ms |
| guard com `tempfile` e `traceback` tardios (cópia em `/tmp/gl`) | 14,9 ± 0,5 ms contra 26,2 ± 1,5 ms (−43 %, 1,8× mais rápido) |
| `hook-dispatch.sh` PostToolUse, payload pequeno | 4,1 ± 0,2 ms |
| `hook-dispatch.sh` SessionStart | 14,7 ± 0,9 ms |
| `hook-dispatch.sh` PostToolUse com `tool_response` de 1 MB e 5 MB | 77,6 ± 2,5 ms e 400,6 ± 15,8 ms |
| `impeccable_gate.sh hook` (launcher substituído por `/bin/true`) | 4,9 ± 0,3 ms |
| `graph_context.py` sem índice | 32,0 ± 1,8 ms (com índice a docstring informa ~270 ms de `codegraph status`, cache de 60 s; não medido aqui) |
| `bash -n` em `bin/pi`, `supervisor.sh`, `hook-dispatch.sh` | OK |
| `pi_patch_stack_applied` do wrapper, replicado em `/tmp` (copia 2 MB e 159 arquivos, aplica 65 patches em reverso) | 60,1 ± 6,8 ms por lançamento |
| Greps de marcadores sobre `bundle/chunks` (85 arquivos, 9,5 MB), replicados | 283 ± 99 ms, faixa 125–404 ms (muito ruidoso sob carga) |
| `guard.py` com heredoc real de 100 KB e de 400 KB | 44 ms e 94 ms (linear, sem problema) |
| `guard.py` com 1.500 heredocs sem terminador (20 KB) | 608 ms |
| Importação das 33 extensões (`node --experimental-strip-types`) | extensão mais cara: claude-compat 35 ms, auto-resume 30 ms, ui-visual 20 ms, ui 15 ms, diagnostico 12 ms, avisos 10 ms; as demais ficam abaixo de 7 ms |

A importação das extensões usou o carregador do Node, não o do pi, e inclui o aquecimento do próprio carregador. Trate-a como limite superior e como prova de que não há trabalho síncrono pesado no topo dos módulos.

## Achados

Gravidade: A = alta, M = média, B = baixa. Em "como verificar", "reproduzido" indica que eu executei a reprodução; "hipótese" indica que só li o código.

| # | SEV | cat | arquivo:linha | cenário (condição → efeito; custo) | correção mínima | como verificar |
|---|---|---|---|---|---|---|
| 1 | M | perf | `claude-home/hooks/guard.py:51-52,437,500,511` | Todo Bash/Edit/Write/Read importa `tempfile` e `traceback` no topo. Só servem a `/tmp` (linha 437) e ao caminho de erro. → **~11 ms por chamada de ferramenta, medido (26,2 → 14,9 ms)**. | Importar `tempfile` dentro da função da linha 437 e `traceback` dentro dos `except`. | `hyperfine -N --input g1.json 'python3 guard.py'` antes e depois; `python3 -m unittest test_guard`. |
| 2 | M | perf | `claude-home/hooks/dispatch/hook-dispatch.sh:24-25,214` | PostToolUse faz `jq tostring` do `tool_response` inteiro e depois `grep -Eqi` com alternação grande. → **78 ms com 1 MB e 400 ms com 5 MB**, em toda chamada de ferramenta MCP que devolve páginas grandes (hipótese: o pi talvez trunque antes do hook). | Varrer só os primeiros e últimos 64 KB (`.[:65536]` em jq). Isso reduz a cobertura da varredura de injeção, o que é decisão do dono. | Repetir `hyperfine` com `/tmp/big_m5.json`; `test_dispatch.py`. |
| 3 | M | perf | `bin/pi:206-224` | Todo lançamento do wrapper copia o diretório de extensões do pi-code e aplica 65 patches em reverso, só para confirmar que o patch já está aplicado. → **~60 ms medido por lançamento**. | Guardar um carimbo (versão do pi-code + mtime do diretório de patches) e pular a prova quando ele não mudou. | Cronometrar `sh /tmp/stack.sh` e o wrapper com carimbo (`PI_WRAPPER_TEST` não cobre; medir em cópia). |
| 4 | M | perf | `bin/pi:303-378` | Cerca de 12 verificações `grep`/`cmp` sobre 85 chunks (9,5 MB) a cada lançamento, uma por patch do core. → **125–404 ms medido (283 ± 99 ms)**, mais sob cache frio. | Mesmo carimbo do #3, chaveado por `current-version` + mtime de `dist/`; se bater, pular tudo. | Repetir `/tmp/chk.sh`; o carimbo deve ser invalidado ao trocar a versão. |
| 5 | M | confiab. | `bench/run.py:253-258` | `--resume` faz `json.loads` em cada linha de `runs.jsonl` sem `try`. Se o processo morreu escrevendo a última linha, o resume (feito para esse caso) quebra com `JSONDecodeError`. **Reproduzido** em `/tmp/runs.jsonl` truncado: `JSONDecodeError`. | Ignorar linhas que não decodificam (`try/except`) e registrar quantas foram descartadas. | Teste com arquivo truncado. |
| 6 | M | confiab. | `bench/run.py:279-280` | Resume reescreve `runs.jsonl` por `write_text` direto, e `_kept_runs` descarta runs com erro, inclusive as que tiveram `cost_usd` > 0. → morte entre truncar e gravar perde todas as runs válidas pagas. O gasto das runs com erro some do `spent` e do `meta.json`, e o teto de orçamento é furado. (hipótese, lido no código) | Gravar em `.tmp` + `os.replace`, e somar o custo de todas as runs anteriores, com ou sem erro, em `spent`. | Teste: rodada com uma run de erro e custo > 0, resume, comparar `meta.cost_usd`. |
| 7 | M | confiab. | `bench/runners.py:536-556` | `subprocess.run(timeout=…)` mata só o filho direto. Os netos (bash das ferramentas, subagentes, `harbor`) seguem vivos e gastando modelo depois do `timeout`. A run é registrada como timeout com custo parcial. (hipótese; falha não injetada) | `Popen(start_new_session=True)` + `os.killpg` no timeout, como `gd_common.run_file` já faz. | Caso que dorme em subshell; `pgrep` depois do timeout. |
| 8 | M | confiab. | `bench/runners.py:139,148,375` | `run_s1` e `run_harbor` chamam `subprocess.run` sem timeout. Um filho pendurado trava a rodada para sempre. Em `run_harbor` o orçamento só é conferido entre blocos de 4 tarefas (`:360-361`), então um bloco pode ultrapassar o saldo, pois `harbor_cmd` não recebe o teto. | Timeout total por etapa (`timeout=`) e passar o saldo restante ao `harbor`, se ele aceitar. | Teste com stub que dorme. |
| 9 | M | confiab. | `bench/run.py:411-415,441-447` | `_extend` roda com `check=False` e sem timeout, e o veredito é recalculado com `extended=True` mesmo que a extensão tenha falhado e não produzido `runs.ext.jsonl`. Falha silenciosa: um INCONCLUSIVE "estendido" sem dados novos. | Verificar o `returncode` e a existência de `runs.ext.jsonl`; se faltar, manter `extended=False` e avisar. | Passar `extend_cmd='false'` e checar o resumo. |
| 10 | M | confiab. | `claude-home/hooks/claims/`, `claude-home/bin/hud/claude-hud-pi-transcript.mjs:132-173` | Sem lock: dois status lines concorrentes (refresh de 60 s + por mensagem) leem o mesmo `offset`, ambos fazem `appendFileSync` do mesmo trecho e depois gravam o estado. Também há duplicação se morrer entre o append (`:171`) e o `writeFileSync` do estado (`:173`). → linhas de transcript e todos duplicados. (hipótese) | Gravar o estado antes do append, ou travar com `flock`/arquivo `.lock`. | Dois processos `syncTranscript` em paralelo sobre o mesmo arquivo; contar linhas. |
| 11 | B | confiab. | `claude-home/plugins/claude-hud/pi-transcripts/` (escrito por `claude-hud-pi-transcript.mjs:84`) | Sem rotação nem poda: **3.352 arquivos, 80 MB** hoje, maior cópia 10,5 MB; nada no repositório os apaga (`rg` só acha a exclusão do bundle). | Apagar traduções sem sessão-fonte ou com mais de 14 dias na primeira sincronização. | `find … -mtime +14` depois da poda. |
| 12 | M | confiab. | `claude-home/skills/atualizador/scripts/gd_common.py:135-160` | `Ctx.run` usa `subprocess.run(timeout)`, que mata só o filho. Um `git commit` com hook (600 s, `gd_git.py:344`) ou `git push` (300 s) que estoure o prazo deixa o hook órfão rodando enquanto o `flock` do repositório é solto. Uma reexecução comita ou empurra em paralelo. (hipótese) | Reusar o padrão de `run_file`: `start_new_session=True` + `killpg`. | Teste: hook que dorme + timeout curto; o órfão não pode sobreviver. |
| 13 | B | confiab. | `claude-home/skills/atualizador/scripts/gd_merge.py:140-150` | Um `gh pr merge` que estoura o prazo (rc 124) vira `gh_fail`. Mas o merge pode ter acontecido no servidor. A reexecução é segura: o início de `merge()` devolve se `state == "MERGED"`, e há `--match-head-commit`. **Efeito colateral idempotente, sem defeito**; só a mensagem de erro não distingue "timeout" de "recusado". | Distinguir rc 124 na mensagem (`outcome_unknown, re-run`). | Teste com `gh` stub que retorna 124. |
| 14 | M | perf | `extensions/auto-resume/index.ts:34,312-336` | `DELAYS_MS` fixos (30 s, 90 s, 3, 5, 10 min) e sem jitter. Cada subagente filho (`PI_CODE_SUBAGENT`) também retoma. N lanças que falham juntas (queda 503 de 13/11) voltam todas no mesmo instante, em vez de espalhadas. O limite de 5 tentativas bate com `settings` retry. | Somar jitter de ±20 % em `delayMs`. | `index.test.ts` com `now` e `wait` injetados. |
| 15 | B | confiab. | `extensions/diagnostico/registro.ts:45-47`, `exportar.ts:104-106` | A rotação faz `statSync` e depois `renameSync` para `.1` sem coordenação entre processos. Dois pi veem `> maxBytes` ao mesmo tempo: o segundo renomeia o arquivo novo e pequeno sobre o `.1`, apagando 1 MB de histórico. Só existe 1 geração (`diag.jsonl.1`, 1,0 MB; `traces.jsonl.1`, 5,3 MB). (hipótese) | Renomear só se o `.1` for mais antigo, ou usar `.1`/`.2` com nome datado. | Teste de duas instâncias concorrentes. |
| 16 | B | confiab. | `extensions/diagnostico/index.ts:240,490`; `bin/pi:136` | `inbox-$$.tsv` é criado por lançamento (34 arquivos, 9,4 MB em `~/.pi/agent/diag`). A poda de 7 dias só roda em sessão interativa (`if (!ui) return` antes de `:490`). Lançamentos `pi -p` e de benchmark nunca podam. Os maiores arquivos têm 142 KB e 185–259 linhas, quase tudo repetições de `tool:bash` dos subagentes. | Podar também no caminho headless, ou o wrapper apagar `inbox-*.tsv` > 7 dias. | Contar arquivos depois de 30 lançamentos headless. |
| 17 | B | confiab. | `extensions/plan-gate.ts:219-232` | Com plano aprovado, cada `agent_before_settle` grava uma entrada `custom` `plan-gate` mesmo em `allowed` (`user_interrupt`, `plan_mode`, `marker_waiting`). A sessão cresce uma entrada por parada. Depois de `completed`, para (`:140`). | Não gravar se `state` e `why` forem iguais à última entrada. | Contar entradas `plan-gate` numa sessão longa em plan mode. |
| 18 | B | perf | `extensions/plan-gate.ts:98-123`, `completion-gate.ts:78-98`, `auto-resume/index.ts:152-170` | Três extensões percorrem o ramo inteiro em cada `agent_before_settle`: O(entradas) cada. Com sessões de 2.000–5.000 entradas é ordem de ms. **Não medido**, e nada a corrigir agora. | Nenhuma por ora. | Perfil de uma sessão longa, se houver queixa. |
| 19 | B | confiab. | `claude-home/bin/puxar/puxar.py:379-384` | O arquivo temporário `.<alvo>.tmp` tem nome fixo e não é removido se a escrita falhar. Duas execuções simultâneas para a mesma sessão pisam no mesmo temporário. | `tempfile.NamedTemporaryFile(dir=…, delete=False)` e `unlink` em `except`. | Teste que força `OSError` no meio da escrita. |
| 20 | B | confiab. | `claude-home/hooks/guard.py:347` (`HEREDOC_RE`) | Quadrático com heredocs sem terminador: 1.500 delas em 20 KB custam **608 ms** (heredoc real de 100 KB custa 44 ms). Só comando adversarial chega perto do timeout de 5 s do hook. | Limitar o tamanho varrido pelo regex. | Reproduzir o payload gerado de 1.500 heredocs. |
| 21 | B | perf | `bench/run.py:196-215` | `bundle.sh` roda de novo para cada etapa Harbor, mesmo com o mesmo `short` do stage. Custo não medido. | Guardar o `short` já empacotado e pular se igual. | Contar execuções de `bundle.sh` numa rodada com 2 etapas Harbor. |
| 22 | B | confiab. | `bench/runners.py:60-64` | `is_infra` trata como infra toda run com erro e `cost_usd` vazio, e um `timeout` legítimo sem evento `result` entra nessa regra. Cinco assim seguidos (`INFRA_STREAK`) abortam a etapa como "infra suspeita". | Contar `timeout` como falha de tarefa, não de infra. | Teste com 5 runs `error="timeout"` e `cost_usd=None`. |
| 23 | B | perf | `bench/runners.py:520-576` | Os casos S4/S5 rodam em série, cada um com `mkdtemp`, `copytree`, `git init/add/commit`; o S1 usa `jobs=2` fixo. O custo dominante é o modelo, então o ganho é só de tempo de parede. Sem repetição desnecessária encontrada; a extensão do gate já reaproveita as repetições existentes. | Opcional: executor com 2 workers nos casos. | Comparar tempo de parede de 4 casos. |

## Hipóteses rejeitadas

- **Checkpoints sem poda** (`~/.pi/agent/checkpoints`, 384 MB, 1.880 diretórios): o pi-code poda por retenção de 30 dias (`git-checkpoint.ts:68,124,288`) e nada tem mais de 14 dias. Não é achado nosso.
- **Leitura de arquivos a cada chamada no `hook-dispatch`**: só SessionStart faz `find`/`git`/`df`, 14,7 ms; PostToolUse faz um único `jq`, 4,1 ms. Rejeitada para o caminho quente.
- **Retry sem limite no `auto-resume`**: há teto (5 retomadas, 3 esperas de limite, `LIMIT_MAX_AHEAD_MS`), a espera é abortável, e `session_shutdown` cancela. Rejeitada.
- **Supervisor `/restart`**: tem `PI_RESTART_MAX` limitado de 1 a 100, `trap` de limpeza e leitura estrita do pedido (dono, modo 0600, uma linha). Sem defeito encontrado. Um `kill -9` do wrapper deixa o diretório `pi-lifecycle.*` em `$XDG_RUNTIME_DIR`, o que é cosmético.
- **Locks e timeouts de `git-deliver`**: `flock` não bloqueante falha visivelmente (`BLOCKED locked`), todo `Ctx.run` tem timeout, e o merge é idempotente (ver #13).
- **`session-transport`**: gravação atômica (tmp + `os.replace`), `flock` com espera limitada e timeouts de boot e controle. Sem achado.

## Top 8 ganhos de performance

Ordenados por (ganho × frequência) ÷ risco.

1. **#1: import tardio de `tempfile`/`traceback` no `guard.py`.** −11 ms medido (26,2 → 14,9 ms, −43 %), em cada chamada Bash/Edit/Write/Read. Sem mudança de semântica, `/tmp` continua livre. Risco mínimo. Observação: `docs/perf-sota.md` A5 deixou o guard fora por ser decisão de segurança do dono; esta mudança só move imports, e os testes de `test_guard.py` cobrem o comportamento.
2. **#4: carimbo de "patches do core já aplicados"** no `bin/pi`. Estimativa **125–400 ms por lançamento** (medido 283 ± 99 ms sob carga 10), uma vez por sessão interativa. Risco baixo se a invalidação usar a versão e o mtime.
3. **#3: carimbo da pilha de patches do pi-code.** −60 ms medido por lançamento. Mesmo carimbo do item 2, uma só mudança (~345 ms somados com o #4, estimativa).
4. **#2: limitar a varredura de injeção no PostToolUse a 64 KB iniciais e finais.** −70 ms com 1 MB e −390 ms com 5 MB medidos, em chamadas MCP que devolvem páginas grandes (raras). Muda a cobertura da varredura, então vale decisão do dono.
5. **#14: jitter no `auto-resume`.** Não reduz ms; evita rajada simultânea de N subagentes contra o provedor depois de uma queda. Baixo risco, ganho de resiliência.
6. **#8: passar o saldo ao `harbor` e pôr timeout por etapa.** Evita estouro de orçamento e travas indefinidas, sem custo de tempo. Médio risco por depender do que o `harbor` aceita.
7. **#12 e #7: `killpg` ao estourar o prazo** (`git-deliver` e bench). Evita trabalho órfão e gasto de modelo depois do timeout. Padrão já existe no próprio `gd_common.run_file`; baixo risco.
8. **#21: não reempacotar `bundle.sh` por etapa Harbor.** Ganho de segundos por etapa (não medido), risco baixo.

## Não verificado

- **Injeção de falha:** não rodei nenhuma. Os achados 6, 7, 10, 12, 15 e o 2 (tamanho real das respostas MCP) dependem disso.
- **Carregamento real das extensões:** só o carregador do Node, não o do pi. Os números de importação são limite superior.
- **`statusline.mjs` completo:** não executei, porque o caminho lê `auth.json` e faz requisição de rede de uso. Custo por refresh (Node ~11 ms + `git status`, 6 ms medido neste repositório) é estimativa.
- **`graph_context.py` com índice:** os ~270 ms do `codegraph status` vêm da docstring, não medidos aqui.
- **Comportamento de hook que estoura timeout** (guard 5 s): aberto ou fechado depende do pi-code, que não verifiquei.
