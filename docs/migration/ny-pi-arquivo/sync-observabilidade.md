# Sincronia e observabilidade: Plano, Agentes e Runs (auditoria, etapa 9 de `docs/perf-sota.md`)

Auditoria somente leitura (2026-11-19), AC16. Código lido: pi-code 1.7.0 instalado e patchado (`~/.pi/agent/npm/node_modules/pi-code/extensions`, abreviado `PC/`), patches em `claude-home/patches/pi-code/`, extensões `extensions/{plan-gate.ts,todo-sync,diagnostico}`, sessão `01a1f089`. Nada foi corrigido. Reproduções em `/tmp/sync-repro/*.test.ts` (efêmeras; rodar com `env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH node --experimental-strip-types --no-warnings --test <arquivo>`); cada teste de correção deve nascer no diretório do patch correspondente.

Objetivo do dono: sincronia total do estado do plano, agentes em tempo real e observabilidade exata entre agentes, plano e runs.

Sobre a semente S1: **descartada como defeito** (decisão do orquestrador: a mensagem das 23:48:09Z não tinha texto e o rastreador estava certo). Evidência de que o rastreador funciona com texto + `toolCall` na mesma mensagem: no primeiro plano da sessão (7 etapas) as entradas `plan-mode` avançam `1`, `1,2`, `1,2,3`… `1..6` (`jq` em `custom/plan-mode`, 21:30–22:01) e o `plan-complete` sai às 22:02:19. A pergunta de desenho que sobra está em D5 e em "Recomendação de fonte única".

## Mapa de estado

Legenda: `PC/` = pi-code instalado; `L` = leitura. Linhas citadas são do arquivo instalado (já patchado).

| Estado | Onde vive | Quem escreve | Quem lê | Evento de atualização |
|---|---|---|---|---|
| Plano: `enabled`, `executing`, `todos[{step,text,completed}]`, `savedTools` | variáveis do closure em `PC/plan-mode/index.ts:86,126-127` + entrada de sessão `custom/plan-mode` (`persistState`, `:323`) | tag `[DONE:n]` em **bloco `text`** do assistente (`turn_end`, `:539-548`; `rescanCompletion` `:387`), `plan_mode_complete` (`:444`), `/plan`, Ctrl+Shift+P | Plan section (`section.ts`), `before_agent_start` (`:499`), `plan-gate.ts` (só `enabled`, `:97`), done-view | `turn_end` → `updateStatus` → `planSection.update` → `requestRender` |
| Plano: marcas `skipped`, pausa, relógio por etapa | `PlanSection.marks` (`section.ts:60`), `PlanTimes` (`:68`, `table.ts:24`), só memória | teclas `s`/`r`/pausa da seção | tabela e rodapé da seção | `requestRender` direto; **não persiste** (D7) |
| Plano: "em espera / bloqueado / cancelado" | só texto do chat: `HOLD` (`done-view.ts:48`), `CANCELLED` (`done-view.ts:49`); `plan-gate.ts:37-39` tem regex próprias | modelo escreve `PLAN WAITING:` etc. | markdown transformer (chat); `plan-gate` (libera parada); `isCancelled` (`index.ts:61`) | nenhum: render do chat; a seção não sabe (D3) |
| Plano: gate de revisão | entradas `custom/plan-gate` (`plan-gate.ts:204-230`), derivado do ramo | `agent_before_settle` | só `plan-gate` | por parada do agente |
| Todo (`todo` tool) | `PC/todo.ts` + entrada `pi-code:todo` (`:464`), reaplicada em `session_start/tree/compact` (`:437-444`) | ferramenta `todo` | Plan section em modo `todo` (`index.ts:291-296`), `todo-sync` (só lembrete) | evento `pi-code:todos` (`todo.ts:392`) |
| Subagente (todas as faixas, qualquer profundidade, fg e bg) | fleet dir `os.tmpdir()/pi-code-fleet-<uid>/<pid>-<id>/<runId>.json` (`RunRecord`, `fleet/types.ts:46-91`; estados `running|done|failed|cancelled`) + `.transcript.jsonl` | **só o processo dono**: `Tracker` (`fleet/tracker.ts:150-305`, throttle 250 ms) | painel de agentes (`fleet-ui`), `statusWithFleet` (só depth 1, só `running`), `stop/send` | `fs.watch` + poll 1 s + debounce 100 ms (`fleet/source.ts:140-195`) |
| Subagente em segundo plano `bg-` | `Map` `runs` em `PC/subagent/background.ts` (estados `running|done|failed|cancelled`, `partial`), + o mesmo run no fleet | `startBackgroundRun` (`background.ts:288-416`) | `subagent {status}` (`formatStatus` `:155-163`), `/tasks`, **Run section** (`run/registry.ts:172`) | nenhum evento; leitores fazem poll |
| Subagente `fg-` (chamada paralela/chain/foreground; auto-destacado no TUI raiz) | só o fleet record; a chamada vive em `ForegroundCall` (`fleet/detach.ts`) | `run.ts:226` (id), `:355` (tracker, **depois do spawn**) | painel; `status` como "Moved to the background (Ctrl+B)" (`fleet/source.ts:242-248`) | idem fleet |
| Runs `run` tool / shells destacados | `RunRegistry.shells` (`run/registry.ts:65`), só memória, `globalThis` sobrevive a `/reload` | `run/shell.ts` (`child.on('exit')`, poll de log, poll de pid de 2 s) | Run section, `run` tool | `reg.emit()` → `section.sync()` |
| Linhas de agentes na Run section | derivadas de `allBackgroundRuns()` (`registry.ts:174`), com `startedAt/endedAt` = 1ª vez observado (`:176-179`) | — | Run section | `sync()` no `tool_result` de `subagent` (`run/index.ts:60`) e timer enquanto visível |
| Ciclo bus `pi-code:subagent` | barramento de eventos | `{phase:'start'|'stop', agentType, agentId}` (`subagent/index.ts:82,199,407`, `modes.ts:212,242`) | hooks (`hooks/index.ts:465`), `goal.ts` | só start/stop, sem estado nem ids de correlação |
| Traços/avisos | `~/.pi/agent/diag/{diag,traces}.jsonl` (`diagnostico`) | extensão `diagnostico` (span por `tool_execution_start`, `toolCallId` em `gen_ai.tool.call.id`, `index.ts:543-548`) | `/diag`, painel, detector `tool-travada` (`trilha.ts:186-190`) | eventos do pi |
| Progresso em `docs/<registro>.md` (`## Progresso`) | arquivo | workers marcam à mão | humano | **nenhum código lê ou escreve** |

Transições do subagente (item 1): iniciado = `startTracking` (`fleet/tracker.ts:125`, `running`); rodando = `onLine` (turnos, `activity`, tokens, custo); concluído/falhou/cancelado = `Tracker.finish` (`fleet/tracker.ts:200-211`: `cancelled` se houve marcador `.stop`, `cancelled` ou `aborted`; `done` se `exitCode==0`; senão `failed`); `maxTurns` = SIGTERM do pai, tratado como `done` (D10); órfão = `mapOrphan` devolve `failed/orphaned` quando o dono morreu (`fleet/store.ts:129-133`). Não existe estado "aguardando": o filho não tem UI. Em `/reload` o fleet dir, o registro `bg-` e a `RunRegistry` seguem (slots em `globalThis`); `plan-mode` reconstrói do ramo (`session_start`, `:574`); em `quit` o fleet dir é apagado (`subagent/index.ts:289-292`), então **nenhum histórico de agentes sobrevive à sessão**.

Tempo real (item 2): o painel lê o fleet por `fs.watch` + poll de 1 s; cada linha tem `activity` (≤120 car.: ferramenta em curso, senão última linha de texto), turnos, chamadas, tokens, custo e `quietMs`; atraso típico ≤ 350–1100 ms (throttle 250 ms + debounce 100 ms + poll). Aninhados (profundidade 2-3) aparecem no painel porque os filhos gravam no mesmo dir (`fleetChildEnv`); **não** aparecem em `status`. Em chamada auto-destacada a linha da ferramenta no chat fica estática (`onUpdate` cortado em `subagent/index.ts:152`); todo o tempo real está só no painel. Os `checkpoints` (`git-checkpoint.ts`) são snapshots de sessão, não progresso de agente.

## Defeitos comprovados

Grupos: **A** = estado do plano (etapa 10); **B** = visibilidade de agentes e runs (etapa 11). Os arquivos de A e B são disjuntos (ver "Ordem e disjunção" no fim desta seção).

### D1 (A, P) Cada `turn_end` regrava o plano inteiro, mesmo sem mudança (S2)
- Sintoma: sessão `01a1f089`: 111 entradas `custom/plan-mode`, 709 KB, só 14 conteúdos distintos (`jq -c 'select(.customType=="plan-mode")|.data|tostring' | sort -u | wc -l`); as 97 restantes são cópias, inclusive uma por tentativa com erro de rede (16 mensagens `error` na sessão).
- Evidência: `PC/plan-mode/index.ts:539-548`: `turn_end` chama `persistState()` incondicionalmente (`:547`); `persistState` (`:323-334`) sempre faz `pi.appendEntry`. O `turn_end` também dispara em turno `error`.
- Reprodução: `/tmp/sync-repro/plan.test.ts`: 3 `turn_end` sem tag → `novas 3 distintas 1`.
- Correção mínima: em `plan-mode/index.ts`, guardar `lastPersisted` (string JSON do payload) e pular `appendEntry` quando igual; depois da restauração em `session_start` (e do `session_tree`, D6) inicializar `lastPersisted` com o payload restaurado quando existe entrada, senão `''`. Patch **novo** `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-state.patch` (ver ordem).
- Teste (falha antes, passa depois): `zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-state/plan-state.test.ts`: 3 turnos idênticos → 0 entradas novas; marcar `[DONE:1]` → exatamente 1; alternar plan mode → 1 por mudança.
- Risco: `plan-gate.ts:97` lê o `enabled` da última entrada: só entradas idênticas são puladas, a semântica de "último vale" não muda. Retomada sem entrada equivalente no ramo (`/tree`) é coberta por D6.

### D2 (A, P) `plan-gate` e plan-mode discordam sobre o que é um marcador
- Sintoma: o modelo cita "PLAN CANCELLED" no meio de uma frase (ex.: explicando a regra) e o gate se desarma para sempre (`state:'cancelled'` → `decidePlanGate` devolve `none`, `plan-gate.ts:118`), enquanto o plan-mode (regex ancorada) segue executando. Idem `PLAN WAITING:` citado no texto libera a parada sem bloco "em espera" no chat.
- Evidência: `extensions/plan-gate.ts:37-39` (regex soltas, `:125-127` testam o último texto inteiro) vs `PC/plan-mode/done-view.ts:48-49` (`^\s*PLAN CANCELLED\.?\s*$`, `HOLD` ancorada por linha) e `index.ts:61`.
- Reprodução: `/tmp/sync-repro/gate.test.ts`: `allow marker_cancelled cancelled` e `allow marker_waiting` para frases que só citam o marcador.
- Correção mínima: em `extensions/plan-gate.ts`, trocar as três regex por versões iguais às do done-view, aplicadas linha a linha (`CANCELLED = /^\s*(?:PLAN CANCELLED|PLANO CANCELADO)\.?\s*$/im`; `BLOCKED/WAITING = /^\s*(?:PLAN BLOCKED|PLANO BLOQUEADO):/im` e `/^\s*(?:PLAN WAITING|PLANO AGUARDANDO):/im`). Sem importar do pi-code (extensão do repositório); um teste de paridade lê as regex do `done-view.ts` instalado e compara casos.
- Teste: `claude-home/bin/tests/plan-gate.test.ts` + 2 casos (citação no meio da frase não libera; marcador em linha própria libera) + 1 de paridade.
- Risco: modelo que escreve o marcador no fim de uma linha com outro texto passa a ser bloqueado; é o mesmo que o chat já mostra (sem bloco). Baixo.

### D3 (A, M) A Plan section não conhece "em espera" nem "bloqueado" e o bloco "retoma sozinho" não confere o run
- Sintoma: depois de `PLAN WAITING: bg-… ` o chat mostra "em espera · segundo plano · retoma sozinho, nada a fazer", mas a seção do plano segue com o relógio da etapa correndo e o rótulo `fazendo` (`section.ts:386`); com faixas `fg-` (auto-destacadas, o caso comum no TUI raiz) o id não é reconhecido; o bloco não muda quando o run termina ou falha.
- Evidência: `rg 'WAITING|BLOCKED' PC/plan-mode` só acha `done-view.ts` (transformer do chat); `section.ts`/`index.ts` não têm estado de espera; `done-view.ts:50` `BG_ID = /bg-[0-9a-f]+/` não casa `fg-`; o gate só olha texto (`plan-gate.ts:127`), nunca confere se há run vivo.
- Reprodução: caminho de código acima (nenhum símbolo de espera em `section.ts`); `/tmp/sync-repro/status.test.ts` mostra que as faixas auto-destacadas têm ids `fg-`.
- Correção mínima (no patch `…-plan-state`): (1) em `plan-mode/index.ts`, no `turn_end`/`agent_end` extrair `hold` do último texto com a mesma `HOLD` (exportar de `done-view.ts`) e limpar em `before_agent_start`; passar `hold` a `planSection.update`; (2) `section.ts`: com `hold`, rótulo `em espera`/`bloqueado` no lugar de `fazendo` e relógio pausado; (3) `done-view.ts:50`: `BG_ID = /(?:bg|fg)-[0-9a-f]+/`. Restaurar `hold` em `session_start` a partir da última mensagem do ramo.
- Teste: `plan-state.test.ts`: turno com `PLAN WAITING: bg-1` → `section` mostra `em espera`; novo prompt limpa; `fg-ab12cd34` vira `id` no bloco.
- Risco: o "retoma sozinho" continua sendo texto do modelo (não confere run vivo); conferir exigiria o fleet (feito em D13). Esforço M por tocar `section.ts` (tabela e rodapé).

### D4 (A, P) A lista `todo` fica invisível durante a execução do plano (S4, parte)
- Sintoma: com plano em execução o modelo mantém a lista `todo` (50 entradas nesta sessão) e o `todo-sync` o cobra a cada ~10 chamadas, mas o usuário só vê o plano; as duas listas divergem sem aviso.
- Evidência: `PC/plan-mode/index.ts:291-296`: `pi-code:todos` guarda `externalTodos` e retorna se `executionMode`; `updateStatus` (`:285`) passa `todoItems` quando executando. `extensions/todo-sync/index.ts:63-73` só injeta lembrete, não sincroniza nada.
- Reprodução: caminho de código (as duas linhas citadas).
- Correção mínima: no rodapé de info da seção (`section.ts`, onde ficam tempo/gasto) mostrar ` · todo d/t · <activeForm do item em andamento>` quando `externalTodos` não vazio e executando; sem novo widget. `plan-mode/index.ts` passa `externalTodos` resumidos como 3º argumento de `update`.
- Teste: `plan-state.test.ts`: emitir `pi-code:todos` com 1/3 concluídos durante execução → rodapé contém `todo 1/3`.
- Risco: largura do rodapé; truncar com `truncateToWidth` já usado.

### D5 (A, P) Três fontes de progresso sem ligação; sem recuperação quando a tag é esquecida (S4, parte; pergunta de desenho)
- Sintoma: as caixas `## Progresso` de `docs/perf-sota.md` têm 1–4 marcados enquanto as 111 entradas `plan-mode` têm `completed` vazio; o aviso de execução lista as 8 etapas.
- Evidência: nenhum código lê/escreve `## Progresso` (`rg` em `extensions/` e `claude-home/hooks`); o único escritor do rastreador é a tag em texto (`index.ts:544`, `DONE_RULE` `:41`); `plan-stalled` foi revogado (contrato 2026-11-15: nada além de fim, cancelamento do usuário ou conclusão encerra), então tag esquecida deixa o plano parado em k/N indefinidamente sem aviso (`agent_end` `:552-571`).
- Reprodução: `jq` na sessão (acima) + leitura do registro. A omissão da tag não foi observada (S1 descartada); o defeito é a ausência de qualquer recuperação.
- Correção mínima (mantém a tag como único escritor): (1) `extensions/plan-gate.ts`: quando bloquear (`block`, `:131-139`) acrescentar "Passos abertos no rastreador: n, m; escreva `[DONE:n]` para os concluídos" derivando de `data.todos` da última entrada `plan-mode` do ramo; (2) `DONE_RULE` (`plan-mode/index.ts:41`): "…e marque a caixa n em `## Progresso` do registro na mesma resposta"; teste `plan-done-rule.test.ts` atualizado.
- Teste: `plan-gate.test.ts`: ramo com `plan-mode` `todos` 3 abertos → mensagem do bloqueio lista `3` e `4`; `plan-done-rule.test.ts`: `DONE_RULE` contém `Progresso`.
- Risco: mais ~25 tokens por prompt de execução (DONE_RULE); o gate só fala quando já ia bloquear (zero turno extra). Alternativas avaliadas em "Recomendação de fonte única".

### D6 (A, P) `plan-mode` não reage a `session_tree`
- Sintoma: `/tree` ou rewind para um ponto sem o plano mantém `executionMode` e `todoItems` do outro ramo; o próximo `turn_end` grava esse plano no ramo novo e o aviso `[EXECUTING PLAN]` segue vindo de um plano que o ramo não tem.
- Evidência: pi emite `session_tree` (`pi-coding-agent/dist/core/agent-session.js:3512`); `todo.ts:443-444` reaplica em `session_tree` e `session_compact`; `rg 'session_tree|session_compact' PC/plan-mode` vazio; a restauração só existe em `session_start` (`index.ts:574-640`).
- Reprodução: `rg` acima. (Sem reprodução ao vivo: exige o pi real; o caminho é inequívoco.)
- Correção mínima: extrair o bloco de restauração de `session_start` para `restoreFromBranch(ctx)` e chamá-lo também em `session_tree` (mesmo patch `…-plan-state`).
- Teste: `plan-state.test.ts`: `session_start` com plano em execução, depois `session_tree` com ramo vazio → `before_agent_start` não injeta `[EXECUTING PLAN]`.
- Risco: baixo; mesma rotina já usada na retomada.

### D7 (A, M) Marcas de pulo, pausa e relógios do plano se perdem em `/reload` e retomada
- Sintoma: o usuário pula a etapa 3 ou pausa o plano (o agente recebe "não continue"); após `/reload` a seção volta a mostrar a etapa 3 como `a fazer` e o plano como rodando, e o tempo de cada etapa recomeça.
- Evidência: `section.ts:60` `marks = new Map()`, `:68` `times = new PlanTimes()`, `table.ts:24`; o payload de `persistState` (`index.ts:324-333`) só tem `enabled, todos, executing, savedTools`; `rg 'appendEntry' PC/plan-mode/section.ts PC/plan-mode/table.ts` vazio.
- Reprodução: caminho de código (campos só em memória; `PlanSection` é recriado por `new PlanSection()` a cada instância da extensão, `index.ts:87`).
- Correção mínima: acrescentar ao payload `marks: [[step,{status,note}]]` e `paused: boolean` (`PlanSection` expõe `exportMarks()`/`restore()`); relógios **não** persistem (custo alto, valor baixo): o rodapé passa a dizer "tempo desde a retomada". Com D1, o payload só é gravado quando muda.
- Teste: `plan-state.test.ts`: marca `skipped` na etapa 2 → `persistState` → nova instância + `session_start` → etapa 2 `skipped` e `paused` preservados.
- Risco: payload cresce com as notas de pulo (≤ 8 etapas, texto curto).

### D8 (B, M) `subagent {status}` descreve mal as faixas (S3)
- Sintoma: com 2 faixas rodando, a resposta é "No background runs in this session." seguida de "Moved to the background: fg-… (swarm-worker) running — moved to the background (Ctrl+B)". Contradição no texto, id `fg-`, "(Ctrl+B)" para um destaque automático, sem turnos, atividade, custo, tempo ou estado final; faixas aninhadas (depth ≥ 2) e concluídas não aparecem; `/new` ou `resume` avisa só dos `bg-` ("N background runs still active", `subagent/index.ts:296`).
- Evidência: `PC/subagent/registry-text.ts:89-91` (`backgroundStatusText()` + bloco de `fleetStatusLines()`), `fleet/source.ts:238-248` (`depth === 1 && running && background && ownerPid && !backgroundRun`; formato fixo sem `turns/activity/cost`), `background.ts:163` (mensagem "No background runs…").
- Reprodução: `/tmp/sync-repro/status.test.ts` (dir de fleet temporário com 2 `fg-` rodando, 1 aninhada, 1 `done`): saída = o texto acima, só as 2 `fg-`, nada de aninhada nem `done`. **Causa da faixa ausente em S3 não reproduzida**: com os dois registros presentes ambos aparecem; a hipótese é a janela entre `agentId` (`run.ts:226`) e `startTracking` (`run.ts:355`, após hooks `SubagentStart`, prompt temporário e `spawnChild`) mais faixas na fila de `mapWithConcurrencyLimit` (4 de cada vez no main, `nesting/index.ts:40`), que não têm registro algum.
- Correção mínima (patch **novo** `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync.patch`): (1) `fleet/source.ts` `fleetStatusLines()`: todas as faixas do fleet do processo (qualquer profundidade, `running` e as terminadas nos últimos 30 min), uma linha `id agente estado [depth] · Nt · $x · mm:ss · activity`, indentada por `depth`; (2) `registry-text.ts` `statusWithFleet()`: cabeçalho "No background runs" só quando as duas listas estão vazias, sem "(Ctrl+B)"; (3) `run.ts`: chamar `startTracking` logo após `agentId` (`:226`), com `activity: 'starting'`, e `setPid` depois; (4) `subagent/index.ts:296`: o aviso de `/new`/`resume` soma as faixas `fg-` vivas; (5) faixas na fila: `modes.ts` (parallel) registra em `ForegroundCall` `{total, started}` e `status` imprime "chamada X: 6 faixas, 4 iniciadas, 2 na fila".
- Teste: `subagent-panel/fleet.test.ts` (já cobre `statusWithFleet`): novo caso com o mesmo fleet de `status.test.ts` → 4 linhas, nenhuma "No background runs", nenhuma "Ctrl+B"; caso de faixa pré-spawn → linha `starting`.
- Risco: `stop` de faixa sem `pid` ainda; `stopRun` deve devolver `stopping` marcando `.stop`. Baixo-médio.

### D9 (B, M) A Run section não lista faixas `fg-` e inventa horários dos agentes
- Sintoma: durante uma chamada paralela auto-destacada o painel de agentes mostra as faixas, a seção Run não mostra nenhuma (nem abre o widget); para `bg-`, início e fim vêm da primeira vez que o registro foi lido, não do run (seção recolhida não consulta; o "terminou há X" e o `KEEP_MS` de 30 min contam desde a observação).
- Evidência: `PC/run/registry.ts:172-185` (`agents()` itera só `allBackgroundRuns()`; `agentSeen ... ?? { startedAt: now }` `:176`; `seen.endedAt = now` `:179`); `run/section.ts:100-104` (`sync` remove o widget se nada `running`); `run/index.ts:60` só chama `sync()` no `tool_result` de `subagent`; `section.ts:116-122` o timer só existe com o corpo visível.
- Reprodução: `/tmp/sync-repro/status.test.ts` 2º teste: `run rows 0 fleet running 1`.
- Correção mínima (no patch `…-fleet-sync`): `run/registry.ts` `agents()` lê `fleetSourceForUi().list()` (depth 1; `try/catch` se a fonte ainda não existe), junta por `id` com o run `bg-` de `background.ts` (que fornece `tail`, `cwd`, `turns`) e usa `startedAt/endedAt/state` do `RunRecord`; remove `agentSeen`. `run/section.ts` `start()`: assinar `fleetSourceForUi().onChange(() => this.sync())` (evento em vez de depender do `tool_result` + timer).
- Teste: `zzzzzzzzzzzzzzz-run-section/run-section.test.ts`: faixa `fg-` `running` no fleet → `snapshot()` a lista com `startedAt` do registro; ao `done`, `endedAt` igual ao do registro; `sync` chamado pelo `onChange`.
- Risco: rótulo `Run N` da nav passa a contar faixas (esperado). Ordem: `snapshot()` é chamado a cada render; `list()` lê arquivos (cache de 1 s do fleet source ou leitura única por `sync`).

### D10 (B, M) Run interrompido por `maxTurns` aparece como concluído (`done`)
- Sintoma: faixa cortada em `maxTurns` mostra `done` no painel e na Run section; só a mensagem de conclusão no chat diz "parcial".
- Evidência: `background.ts:365-405` (`cappedByMaxTurns` → `state='done'`, `partial=true`); `run.ts:427` (`finishExitCode(Boolean(currentResult.partial), code)` → exit 0); `fleet/types.ts:46-91` (`RunRecord` sem campo `partial`; `RunState` só 4 valores); `run/registry.ts:agentRecord` não lê `partial`.
- Reprodução: caminho de código (`finishExitCode` converte o parcial em exit 0; nada de `partial` em `fleet-ui/*` nem `run/*`: `rg partial` só acha o buffer de shell).
- Correção mínima (patch `…-fleet-sync`): `RunRecord.partial?: true`; `Tracker.finish({partial})` (`run.ts:427`, `background.ts:416`); `fleet-ui/view-model.ts` rótulo `parcial` ao lado de `done`; `run/registry.ts` `agentRecord` propaga e a view mostra `parcial`.
- Teste: `zzzzzzz-subagent-model-effort/tracker.test.ts`: `finish({exitCode:0, partial:true})` → record `partial:true`; `view-model`: linha com `parcial`.
- Risco: baixo; campo aditivo (readers antigos ignoram).

### D11 (B, M) Não existe id comum entre etapa do plano, chamada, run e traço
- Sintoma: não dá para dizer "a etapa 5 está com o agente X, que disparou o run Y": o `RunRecord` não guarda `toolCallId` nem etapa; o traço do filho não leva o id do run; e o fleet dir some no `quit`, então nenhum registro persistente liga agente ↔ traço.
- Evidência: `subagent/index.ts:339` `execute(_toolCallId, …)` descarta o id; `fleet/types.ts:46-91` sem `toolCallId`/`planStep`; evento `pi-code:subagent` só tem `{phase, agentType, agentId}` (`internal/subagent-events.ts:11-16`); `extensions/diagnostico/index.ts:416-421` o recurso OTel do filho é `service.name, pi.subagent, service.version, pi.session.id`, sem `PI_CODE_FLEET_RUN_ID` (só usado em `nomeDoFilho`, `:77-90`); `subagent/index.ts:289-292` `removeFleetDir()` no quit.
- Reprodução: leitura dos campos acima; `rg toolCallId PC/subagent` só acha `index.ts:339` (descartado).
- Correção mínima: **contrato novo, aditivo.** (a) `RunRecord` ganha `toolCallId?: string` e `planStep?: number`; (b) `subagent/index.ts` passa `toolCallId` por `ModeContext` → `runSingleAgent`/`startBackgroundRun` → `startTracking` (`modes.ts`, `run.ts`, `background.ts`, `fleet/tracker.ts`); (c) `planStep` = `step` publicado no barramento por plan-mode no canal `pi-code:plan-state` (payload `{executing:boolean, step?:number, done:number, total:number}`, `step` = primeira etapa aberta; publicado por A, D1-D3); o subagent guarda o último valor com `pi.events.on` e o grava ao iniciar; ausente = campo omitido; (d) o payload de `pi-code:subagent` ganha `toolCallId`, `planStep`, `state`, `exitCode`, `partial` (aditivo; `isSubagentPhaseEvent` ignora extras); (e) `extensions/diagnostico/index.ts`: ouvinte do canal grava `trilha.evento('pi.subagent start|stop', {…})` com esses atributos (persistente em `traces.jsonl`) e o recurso do filho ganha `pi.run.id = PI_CODE_FLEET_RUN_ID`.
- Teste: `tracker.test.ts`: record com `toolCallId`/`planStep`; `extensions/diagnostico/test/obs/correlacao.test.ts`: evento do canal vira span com `gen_ai.tool.call.id` e `pi.run.id`; filho com `PI_CODE_FLEET_RUN_ID=fg-1` → recurso `pi.run.id=fg-1`.
- Risco: `planStep` é heurístico (primeira etapa aberta no instante do spawn; em trabalho paralelo de etapas pode apontar a vizinha). Documentar no código. Esforço M-G (vários arquivos, mas sem lógica nova).

### D12 (B, P) `tool-travada` dispara para subagente longo legítimo (S5)
- Sintoma: "tool subagent rodando há 10 min" para uma chamada `subagent` em primeiro plano (`background:false`, ou aninhada/não interativa).
- Evidência: `extensions/diagnostico/trilha.ts:137` (`TOOLS_ESPERA_USUARIO` só tem `question`), `:186-190` (qualquer `execute_tool *` aberto acima de `toolTravadaMs`). Chamadas auto-destacadas fecham o span na hora, então o ruído vem dos foreground.
- Reprodução: `/tmp/sync-repro/diag.test.ts`: `[ 'tool subagent rodando há 11 min' ]`.
- Correção mínima: em `trilha.ts` renomear o conjunto para `TOOLS_SEM_ALERTA` e incluir `subagent` (o fleet tem `quietMs`/`activity` por faixa; avisar por "tempo total" não distingue travado de longo).
- Teste: `extensions/diagnostico/test/obs/detector.test.ts`: span `execute_tool subagent` de 11 min não gera aviso; `bash` de 11 min continua gerando (já existe para `question`).
- Risco: subagente realmente travado não gera aviso; a mitigação é o `quietMs` do painel (fora de escopo gerar alerta por silêncio do filho).

### D13 (A, M, depois de D8-D11) A seção do plano não mostra o agente da etapa (AC15)
- Sintoma: a etapa "fazendo" não diz que agente/run a executa nem o estado dele; o estado do agente só aparece no painel de agentes.
- Evidência: `section.ts` não lê o fleet (`rg fleet PC/plan-mode` vazio); sem `planStep` no registro (D11).
- Correção mínima: depois que B entregar `RunRecord.planStep`, `plan-mode/section.ts` assina `fleetSourceForUi().onChange(requestRender)` (try/catch quando a fonte não existe) e acrescenta à linha da etapa `· <agente> <estado>` das faixas com `planStep === step` e `running`. Importação só de leitura (`../subagent/fleet/source.ts`); sem planStep o resultado é o de hoje.
- Teste: `plan-state.test.ts`: fleet falso com faixa `planStep:2 running` → linha da etapa 2 contém o agente; ao `done`, some no redesenho seguinte.
- Risco: depende do formato de D11; por isso a ordem abaixo.

### D14 (A, P) A tag `[DONE:n]` escrita numa mensagem que termina em chamada de ferramenta não é registrada
- Sintoma: sessão `01a1f089`: o modelo escreveu `[DONE:1] [DONE:2] …` antes de chamadas de ferramenta e as 6 etapas só foram registradas quando a tag foi repetida na resposta final.
- Evidência: `~/.pi/agent/sessions/--home-<user>--/2026-11-18T21-22-11-296Z_01a1f089-e4df-76f4-b609-54723950a5bb.jsonl`, mensagens assistant de `2026-11-19T00:07:43.430Z` e `2026-11-19T00:40:01.777Z` (stop `toolUse`): o texto anterior às chamadas chegou do provedor (`anthropic-messages`, `claude-fable-5-2`) como um SEGUNDO bloco `thinking` assinado pela API (assinatura `CAQS…` com `narration`), resumido e sem a tag literal ("Onda 2 voltou com as etapas 1, 2, 3, 4 e 6 concluídas…" no lugar de "[DONE:1] [DONE:2] …"); nenhum bloco `text`. Em 7 de ~260 mensagens `toolUse` da sessão o texto veio como `text`. `turn_end` → `markCompletedSteps(getTextContent(...))` lê só `text`. A tag não é recuperável do resumo.
- Correção mínima (decisão da sessão principal): `DONE_RULE` (`plan-mode/index.ts`) diz que a tag só conta na resposta final do turno (mensagem sem chamada de ferramenta); etapa concluída no meio do trabalho repete a tag na resposta final; mantém o trecho de `## Progresso` (D5) e fica < 60 palavras. `plan-gate.ts` (aviso de passos abertos) usa a mesma frase. Ler bloco `thinking` segue rejeitado (falso positivo certo, ver "Recomendação de fonte única"). `claude-home/CLAUDE.md` (linha "mark steps `[DONE:n]`") não repete a regra antiga; não editado.
- Teste: `zzzz-plan-done-rule/plan-done-rule.test.ts` (mensagem inicial e contexto contêm "final reply of the turn (the message without a tool call)" e "repeat the tag in the final reply"; regra < 60 palavras); falhou antes da mudança.
- Risco: o modelo que ignorar a regra continua perdendo a tag; o aviso do `plan-gate` lista os passos abertos.

### D15 (B, M) Faixa auto-destacada perde o resultado quando o `/reload` acontece durante a chamada
- Sintoma: depois de `/reload` com `subagent {tasks:[2]}` em curso as faixas seguem vivas, mas a sessão principal recebe `Background subagent call finished (started in the background): Subagent call failed: This extension ctx is stale after session replacement or reload…` assim que a primeira faixa termina; o resultado das duas se perde.
- Evidência: `subagent/index.ts` `execute` monta `mode.onPhase` com o `pi` capturado (`pi.events.emit`); `subagent/run.ts` chama `onPhase('stop')` no `finally` de `runSingleAgent`, depois do reload: o `pi` velho lança, a faixa rejeita e `Promise.all` derruba `out.detached` inteira (`runDetachableForeground` entrega o erro no lugar do resultado). A entrega em si (`results.deliver`) já usava a instância atual. Os demais acessos a `ctx`/`pi` do `execute` acontecem antes do spawn.
- Correção mínima (patch `…-fleet-sync`): `index.ts` envia o evento pelo `results.deliver((current) => …)` (instância atual; sem instância, espera o próximo `session_start`) dentro de try/catch; `run.ts` chama o sink por `phase()`, que engole a exceção (observador não troca o resultado nem derruba as irmãs).
- Teste: `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync/reload.test.ts`: 2 faixas, `pi`/`ctx` com getters que lançam o erro "stale" depois de um reload simulado, nova instância, as duas terminam → texto contém `feito:p1` e `feito:p2`, sem "stale" (vermelho antes: texto era só `Subagent call failed: …stale…`); mais um caso de `onPhase` que lança direto no `runSingleAgent` (vermelho sem o `phase()`).
- Risco: o evento `stop` de uma faixa que termina após o reload chega à sessão nova (hooks `SubagentStop` a recebem lá); o `start` é emitido antes.

### Ordem e disjunção
- Grupo A (worker da etapa 10; D14 também), arquivos: `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-state.patch` e seu diretório de teste (muda só `PC/plan-mode/{index,section,done-view}.ts`), `extensions/plan-gate.ts`, `claude-home/bin/tests/plan-gate.test.ts`, `claude-home/patches/pi-code/zzzz-plan-done-rule/plan-done-rule.test.ts`. D1–D7 e D13.
- Grupo B (worker da etapa 11), arquivos: `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync.patch` e seu diretório de teste (muda só `PC/subagent/{index,modes,run,background,registry-text}.ts`, `PC/subagent/fleet/{source,tracker,types,detach}.ts`, `PC/subagent/fleet-ui/view-model.ts`, `PC/run/{registry,section,view}.ts`), `extensions/diagnostico/{trilha.ts,index.ts}` e `test/obs/{detector,correlacao}.test.ts`, `claude-home/patches/pi-code/subagent-panel/fleet.test.ts`, `zzzzzzzzzzzzzzz-run-section/run-section.test.ts`, `zzzzzzz-subagent-model-effort/tracker.test.ts`. D8–D12.
- Conjuntos disjuntos. Cada worker gera seu patch sobre uma **cópia** da árvore instalada (`cp -r PC /tmp/<x>`, editar a cópia, `diff -u` com `-p1` relativo a `extensions/`), nunca editando a árvore viva, para não colidir; os nomes dos patches ordenam depois de `…-plan-sota-and-fleet.patch` (o `bin/pi` aplica `ls` ordenado, `bin/pi:230`).
- Dependência única: D13 (A) lê `planStep` produzido por D11 (B). Ordem: A e B em paralelo; D13 por último, no fim da etapa 10, depois que B terminar. O canal `pi-code:plan-state` é publicado por A (D1-D3) e lido por B só de forma opcional (ausente = campo omitido), então não há ciclo.
- Gate: `bash scripts/ci/run-static.sh`, os testes novos de cada patch e `claude-home/bin/tests/plan-gate.test.ts`, `extensions/diagnostico/test`, `claude-home/patches/pi-code/subagent-panel/*.test.ts`, `claude-home/bin/tests/interactive-display/*.test.ts`, mais `bin/pi` aplicando a pilha (sem aviso "does not apply").

## Recomendação de fonte única

Desenho mínimo para AC12–AC15, sem store novo:
- **Agentes e runs de subagente:** a fonte única é o `RunRecord` do fleet (todas as profundidades, fg e bg, um escritor por run, evento por `fs.watch`). `background.ts` fica só com controle (cancelar, retomar, resultado); deixa de ser fonte de estado exibido. Leitores: painel (já lê), `status` (D8), Run section (D9), seção do plano (D13), diagnóstico persistente (D11). Campos aditivos: `partial`, `toolCallId`, `planStep`.
- **Plano:** `todoItems` do plan-mode, persistido na entrada `plan-mode` sem duplicatas (D1) e restaurado em `session_start` e `session_tree` (D6), é a única verdade do progresso. Único escritor de conclusão: a tag `[DONE:n]` em bloco `text`. A ferramenta `todo` continua lista ad hoc (visível durante a execução, D4). O `## Progresso` do registro é visão derivada que o worker marca junto com a tag (D5). O `plan-gate` cobra o que falta no próprio bloqueio (D5) e usa as mesmas regex de marcador (D2).
- **Correlação:** `toolCallId` (já é o `gen_ai.tool.call.id` do diagnóstico) + `runId` + `planStep`, gravados no `RunRecord` e no traço persistente (D11).

Alternativa mais forte rejeitada: canal estruturado para concluir etapa (ferramenta `plan_step_done`, ou o `todo` tool como canal do plano, com ids = nº da etapa). Elimina a dependência de texto livre, mas: (a) exige mudar o hábito do modelo e o prompt de execução, o chat renderiza `[DONE:n]` (done-view) e os testes (`plan-done-rule`) assumem a tag; (b) o `todo` tem ids próprios (`nextId`) e o plan-mode não consegue semear nem fechar itens de outra extensão sem mudar `todo.ts` (patch invasivo); (c) não há evidência de tag esquecida (S1 descartada), enquanto o custo de manter a tag é zero. A mitigação barata (D5) cobre o risco com uma linha no bloqueio que já existe. Reavaliar se aparecer medição de tag esquecida. Também rejeitados: ler blocos `thinking` como canal (a sessão tem um bloco de raciocínio, id `f2b45590`, que cita literalmente `[DONE:1] [DONE:3] [DONE:4]` ao diagnosticar: falso positivo certo) e aviso de fim de turno sem tag (ruído: a maioria dos turnos não conclui etapa).

Outra alternativa rejeitada: um ledger único por sessão (um JSON novo sob o diretório do agente) com plano, agentes e runs. Teria um escritor a mais, duas durações de vida diferentes (o fleet é por processo; a sessão sobrevive a `/resume`) e semântica de retomada para decidir; o fleet e a entrada de sessão já cobrem escrita única, atomicidade e `/reload`.

## Não verificado

- Por que a segunda faixa não apareceu no `status` de S3 (hipótese: janela pré-`spawn` / faixa na fila; D8 corrige as duas, mas a ocorrência não foi reproduzida; o pi real não foi rodado).
- Se `ensureFleetDir()` cria dir novo em `/new`/`resume` (`store.ts:36-48` reaproveita `slot[DIR_SLOT]` por processo; o efeito sobre faixas de sessões anteriores não foi exercitado).
- Pid reciclado: o poll de vida dos shells detectados usa `kill(pid,0)` (`run/shell.ts:48`); run "ainda rodando" com pid reutilizado é plausível, sem repro.
- Comportamento ao vivo de `session_tree` (D6 é por leitura de código; o pi real não foi iniciado).
- Se `turn_end` dispara em cada tentativa com erro de rede (D1 assume o evento por turno; os 16 `error` da sessão e as 97 cópias são compatíveis, sem prova um-para-um).
- Origem do "Task total" do progresso OSC 9;4 (`extensions/avisos/progresso.ts`): outra superfície de progresso, não mapeada.
- Latência real do painel (≤ ~1 s por leitura de código; sem medição).

## Fora de escopo

- Término do plano por `plan-gate` `completed` (revisão completa): hoje o plan-mode não sabe (nada lê as entradas `plan-gate`), então etapas sem tag seguem em "executando". É o contrato do dono de 2026-11-15 ("nada mais encerra o plano"); mudar pede decisão do dono.
- Notificação por faixa: a chamada auto-destacada entrega **uma** mensagem no fim de todas as faixas (`subagent/index.ts:162`); a falha de uma faixa só chega quando a última termina. Melhoria, não defeito de estado (o painel mostra o estado correto).
- Rótulo da nav `Agentes N` / `Run N`: mostra running, ou o total quando nada roda (`fleet-ui/index.ts:114`, `run/section.ts:81`): número ambíguo; ideia: `running/total`.
- Alerta por silêncio do filho (`quietMs`) em vez de tempo total.
- Persistir relógios por etapa e histórico de agentes após o `quit` (o fleet é apagado).
- Escrita automática de `## Progresso` por código (hoje só a regra de texto em D5).
- A linha de chat da chamada destacada fica estática por desenho; poderia ganhar contador por faixa.
