# Subagent send: coordenador redireciona subagente vivo (2026-11-13)

Pesquisa: docs/research/2026-11-13-pi-agents-teams-sota.md (seção Delta). Plano: ~/.pi/agent/plans/2026-11-13-01a1d61d.md

Tier: T3 (sinais: concorrência entre processos via inbox/ack, contrato da ferramenta `subagent` lido pelo modelo, rótulo de autoridade, eval com gasto)

## Resumo
- Objetivo: o coordenador (modelo) redireciona um subagente de fundo vivo sem matá-lo, via `subagent {send: <id>, task: <texto>}`. Depois comparamos com cancelar e recomeçar, e com o harness sem a feature.
- Fora de escopo: modo time (`team`) segue como está; steer em chamada de primeiro plano (o modelo fica bloqueado); interromper ferramenta no meio; Claude Code; deploy.
- Estimativa: 11 tarefas, ~6 runs de worker (Sonnet), 1 gate, 1–2 rodadas de plan-reviewer; gasto de modelo ≤ US$15 (bench ~US$3, eval ~US$8, folga).
- Registro na execução: ~/.pi/agent/claude-home/docs/pi-subagent-send-2026-11-13.md (Progresso, Surpresas, Log de decisões, Resultados).
- Autorização: pedido do usuário "crie uma execução SOTA disso e compare depois" + respostas: param `send`, ligado só se no_worse, teto US$15, rótulo do coordenador. claude-home não é repositório git: não há commit/PR; entrega = patch instalado + registro.

## Decisões e suposições
- D1: param `send` no `subagent`, com o texto em `task`, reaproveitando `sendToRun` (fleet/source.ts:73). Rejeitadas: ferramenta nova `subagent_send` (+1 ferramenta sempre no prompt) e "só via /team" (fica preso ao opt-in).
- D2: o texto entregue leva rótulo derivado da profundidade do remetente: `[message from lead (main session), not the user]` em depth 0, `[message from parent <agente> (<id>), not the user]` em depth ≥1. O mesmo rótulo vale também no caminho `resumed` (regra única). É instrução do pai, nunca aprovação do usuário. Rejeitado: entregar como mensagem do usuário (autoridade repassada sem rótulo).
- D3: entrega confirmada. O filho grava a ack `consumed` só quando um turno começa depois do steer. A mensagem steered que nunca vira turno, ou que chega depois do `agent_end`, recebe ack `too-late` num dreno final. O aviso de não-entregue conta tudo que não estiver `consumed`. Rejeitado: confiar na ack `steered` atual (inbox.ts:21-25 marca antes de processar).
- D4: anti-corrida no remetente. Depois do append, `sendFromLead` relê o registro. Se o run já não estiver `running` e a mensagem não estiver `consumed`, cai para resume (depth 1 de fundo) ou retorna `not-delivered`. Nunca devolve `queued` falso.
- D5: limites. Texto não vazio e ≤ 4000 chars. ≤ 20 envios por run, contados pelas linhas de `<id>.inbox.jsonl` (sobrevive a reinício). ≤ 60 envios por processo remetente. Só runs do próprio processo (`ownerPid === process.pid`, como `stopOwnRun`). Resume só para depth 1 de fundo; depth > 1 recebe `queued` ou `not-running`, sem resume.
- D6: chave `PI_CODE_SUBAGENT_SEND`. O schema e a descrição incluem `send` só quando ligada, e `sendFromLead` também checa a chave (desligada → resposta "send is disabled", sem erro). Padrão `0` até a tarefa 8 decidir. Histórico antigo com `send` não quebra.
- D7: código só em arquivos existentes (params.ts, index.ts, registry-text.ts, fleet/source.ts, fleet/inbox.ts, fleet/store.ts, fleet/types.ts). Nenhum arquivo novo na raiz de subagent/ nem em fleet/ (6 de 7). Patch novo `zzzzzz-subagent-send.patch` (último no glob) e teste em `patches/pi-code/zzzzzz-subagent-send/send.test.ts`.
- D8: "no_worse" operacional. (a) Adoção: o modelo usa `send` em ≥ 4/6 runs dos casos-alvo e eles passam. (b) Bench: STEER não perde para RESTART em acerto (≥ igual em 3 runs) e custa ≤ RESTART. (c) Regressão: nenhum caso da suíte passa→falha de forma reproduzida (o caso que falhar no braço on roda de novo k=2 nos dois braços). Diferença de custo agregado dentro de ±10% conta como ruído e não reprova. Resultado inconclusivo → padrão segue `0`, registrado.
- A1 (~85%, base: API de extensão do pi usada em inbox.ts e team/index.ts): os eventos `turn_start` e `agent_end` estão disponíveis no filho para as acks `consumed`/`too-late`. O worker confirma na doc de extensões do pi antes de codar; se faltar, para e reporta (PLAN BLOCKED).
- A2 (~90%, base: rodada anterior em pi-agents-ui-teams-sota checkpoint 8): `run_pi.py` aceita env por braço e o modelo da eval é o mesmo da rodada 6 (Opus 5.5), com outras sessões do pi paradas durante a eval.

## Glossário
- steer: mensagem inserida no próximo limite de turno de um run vivo (pi `sendUserMessage(..., {deliverAs:'steer'})`).
- consumed: o filho começou um turno depois de receber o steer.
- STEER / RESTART: braços do bench; corrigir via `send` contra `cancel` + novo run com brief corrigido.

## Aceitação
- AC1: WHEN o modelo chama `subagent {send:id, task}` para um run de fundo próprio em execução THE SYSTEM SHALL anexar a mensagem rotulada (D2) na inbox e retornar `queued`, dizendo que a entrega ocorre no próximo limite de turno.
- AC2: WHEN um run de fundo depth 1 já terminou THE SYSTEM SHALL retomá-lo com o texto rotulado e retornar `resumed`.
- AC3: WHEN o filho começa um turno depois de um steer THE SYSTEM SHALL gravar a ack `consumed` daquela mensagem.
- AC4: IF o run termina com mensagens não `consumed` THEN THE SYSTEM SHALL incluir na notificação de conclusão "N message(s) sent with send were not delivered; resend with resume", e `status` SHALL mostrar a mesma contagem.
- AC5: IF o run sai entre a checagem `running` e o append THEN THE SYSTEM SHALL retornar `resumed` (depth 1 de fundo) ou `not-delivered`, nunca `queued`.
- AC6: IF o texto está vazio ou passa de 4000 chars, o id é desconhecido, o run não é do remetente, ou passa de 20 envios por run ou 60 por processo THEN THE SYSTEM SHALL recusar com motivo explícito, sem escrever na inbox.
- AC7: IF `PI_CODE_SUBAGENT_SEND` está desligada THEN THE SYSTEM SHALL omitir `send` do schema e da descrição e responder "send is disabled" a uma chamada com `send`.
- AC8: WHEN o humano envia pelo painel THE SYSTEM SHALL manter o comportamento atual (sem rótulo, mesmas acks).
- AC9: WHEN o bench e a eval rodam THE SYSTEM SHALL registrar, por braço: acerto, custo, tempo de parede, latência de entrega (ack − envio), chamadas de ferramenta após o envio e adoção, dentro de US$15.
- AC10: WHEN o gate roda THE SYSTEM SHALL passar todos os passos de `~/.cache/pi-fleet-work/gate.sh`, incluindo os novos (testes e cobertura do patch novo, variante red, roundtrip, upgrade, structure).

## Riscos e rollback
- Ack `steered` antes do processamento esconde perda: D3 + teste com mensagem chegando depois do `agent_end` (tarefa 2).
- Corrida registro × saída do filho: D4 + teste de injeção (tarefa 3).
- Canal de prompt injection (texto do modelo vira mensagem de usuário no filho): rótulo D2, limite de 4000 chars, só runs próprios; documentado no registro.
- Eval no ruído: D8 separa adoção, bench e regressão; inconclusivo mantém `0`.
- Sessão concorrente editando o harness contamina a eval (aconteceu na rodada anterior): checar drift do settings.json antes e depois; se mudar, a eval é descartada e fica registrada.
- Porta de mão única: nenhuma. Gasto de modelo é o único irreversível, com teto de US$15 checado antes de cada lote.
- Rollback: `PI_CODE_SUBAGENT_SEND=0` (desliga na hora). Remoção completa: `patch -R -p1 -d ~/.pi/agent/npm/node_modules/pi-code/extensions < zzzzzz-subagent-send.patch`, apagar o patch, o diretório de teste e as linhas novas do gate.sh, e rodar o gate (roundtrip igual ao instalado). Artefatos em `~/.cache/pi-fleet-work/bench-send/` e `*.inbox.jsonl` velhos são inofensivos e podem ser apagados.

## Fases

### Fase 1: implementação (gate: diff revisado, lsp_diagnostics limpo nos arquivos tocados)
1. Criar registro /docs da execução
   - agente: main · arquivos: ~/.pi/agent/claude-home/docs/pi-subagent-send-2026-11-13.md
   - ação: materializar este plano (D/A/AC, riscos, seções vivas) e linkar a pesquisa delta em docs/research/2026-11-13-pi-agents-teams-sota.md
   - after: (nenhum) · AC: AC9
   - check: `rg -c "AC10" <registro>` · pronto: registro com todas as seções
2. Ack consumed e dreno too-late no filho
   - agente: swarm-worker (sonnet) · arquivos: extensions/subagent/fleet/{inbox,store,types}.ts, patches/pi-code/zzzzzz-subagent-send/send.test.ts
   - ler antes: fleet/inbox.ts inteiro, fleet/store.ts (readInbox/appendAck), doc de extensões do pi (eventos turn_start/agent_end) para A1
   - ação: ack `consumed` no primeiro turn_start depois do steer; dreno no agent_end/shutdown grava `too-late` para o que não foi consumed; helper `undeliveredCount(dir,id)`
   - after: 1 · AC: AC3, AC4, AC8
   - check: `node --experimental-strip-types --test patches/pi-code/zzzzzz-subagent-send/send.test.ts` (roda no gate; aqui só lsp_diagnostics) · pronto: testes vermelhos escritos antes (msg depois do agent_end, painel inalterado)
   - passos: teste vermelho; implementar; registrar a evidência red no registro
3. Param send e sendFromLead no remetente
   - agente: swarm-worker (sonnet) · arquivos: extensions/subagent/{params,index,registry-text}.ts, fleet/source.ts, send.test.ts (mesmo dono, depois da 2)
   - ler antes: fleet/source.ts:40-140, index.ts:60-90 e :169 (notifyBackgroundCompletion), registry-text.ts:14, params.ts:39-40
   - ação: D1, D2, D4–D7. Branch `send` em backgroundRegistryResult; `sendResultText`; aviso de não-entregue na conclusão e no status; descrição da ferramenta (só fundo)
   - after: 2 · AC: AC1, AC2, AC4, AC5, AC6, AC7
   - check: lsp_diagnostics nos arquivos; `wc -l` ≤ 800 · pronto: testes de cada AC, incluindo corrida (registro muda entre leitura e append), depth > 1, limites, chave 0/1, histórico antigo
4. Gerar patch e plugar no gate
   - agente: swarm-worker (sonnet) · arquivos: patches/pi-code/zzzzzz-subagent-send.patch, ~/.cache/pi-fleet-work/{gate.sh,red-green.sh}
   - ler antes: gate.sh inteiro, como os patches anteriores foram gerados (`diff -ruN` contra a árvore anterior, datas não-epoch)
   - ação: gerar o patch sobre a pilha atual; adicionar o diretório de teste ao passo fleet-tests, o patch ao coverage-check, e uma variante red (sem a ack consumed → teste falha)
   - after: 3 · AC: AC10
   - check: `patch -R --dry-run` do patch novo na árvore instalada · pronto: patch reversível e gate.sh referenciando os arquivos novos
5. Documentar send no swarm-orchestration
   - agente: main · arquivos: ~/.pi/agent/claude-home/skills/swarm-orchestration/SKILL.md
   - ação: 1–2 linhas: corrigir worker de fundo com `send` em vez de cancelar e recomeçar; o rótulo não é autoridade do usuário; só quando a chave estiver ligada
   - after: 3 · AC: AC1
   - check: `python3 ~/.pi/agent/claude-home/bin/check-instructions` (ou o check-instructions do gate-extra) · pronto: 0 problemas (optional)

### Fase 2: comparação (gate: tabela de resultados no registro, gasto ≤ US$15)
6. Bench STEER vs RESTART
   - agente: swarm-worker (sonnet) · arquivos: ~/.cache/pi-fleet-work/bench-send/* (fora da árvore)
   - ação: fixture com repositório de teste e 2 tipos de tarefa (primeira ferramenta curta / primeira ferramenta longa ~30 s). O worker de fundo recebe uma restrição errada; depois da 1ª chamada de ferramenta, o braço STEER manda a correção via `sendFromLead` e o RESTART faz cancel + novo run. k=3 por braço e tipo, Sonnet fixo. Métricas do AC9 e check do fixture
   - after: 4 · AC: AC9
   - check: `jq` sobre os resultados; teto US$4 conferido antes de cada lote · pronto: tabela por braço no registro
7. Eval pareada pelo-em-ovo send 0 vs 1
   - agente: swarm-worker (sonnet) · arquivos: ~/.claude/evals/cases/outcome.jsonl (+2 casos-alvo), resultados em ~/.local/state/pelo-em-ovo/results/
   - ler antes: skills/pelo-em-ovo/SKILL.md, scripts/run_pi.py, checkpoint 8 de docs/pi-agents-ui-teams-sota-2026-11-13.md (optional)
   - ação: 2 casos-alvo (começar worker de fundo e depois acrescentar ou corrigir instrução) k=3 só no braço on; 8 casos da rodada 6 k=1 nos dois braços, simultâneos, Opus 5.5, jobs 1; drift do settings.json checado antes e depois; rerun k=2 dos casos passa→falha
   - after: 4 · AC: AC9
   - check: relatórios do run_pi.py; teto US$11 · pronto: adoção, acerto e custo por braço no registro
8. Decidir padrão da chave pela regra D8
   - agente: main · arquivos: fleet/source.ts ou params.ts (padrão da chave), zzzzzz-subagent-send.patch, registro
   - ação: aplicar D8 a 6+7; ligar o padrão (`1`) só se passar; senão manter `0` e registrar o porquê; regenerar o patch se mudar
   - after: 6, 7 · AC: AC7, AC9
   - check: `rg PI_CODE_SUBAGENT_SEND` mostra um único ponto de padrão · pronto: decisão com evidência no registro

### Fase final: verificação
9. Gate único (gate-runner)
   - agente: gate-runner (haiku) · arquivos: nenhum
   - ação: `bash ~/.cache/pi-fleet-work/gate.sh` e `gate-extra.sh` na árvore final; colar exit por passo no registro; falha → fix no dono da tarefa → rerun dos passos que falharam → gate final
   - after: 8 · AC: AC10
   - check: `== GATE pass` nos dois · pronto: rc 0, sha256 do patch registrado
10. Revisão da execução (plan-reviewer)
   - agente: plan-reviewer · ação: rever o diff, o gate e o registro contra AC1–AC10; lacunas voltam aos workers; repetir até `PLAN_REVIEW: complete` (máx. 2 rodadas de fix)
   - after: 9 · AC: AC1, AC10
   - check: veredito `complete`
11. Capturar aprendizado no knowledge vault
   - agente: main · arquivos: nota em Resources/Patterns via obsidian-cli
   - ação: só o aprendizado verificado (steer × restart medido, ack consumed), sem logs crus
   - after: 10 · AC: AC9
   - check: helper com hash do obsidian-cli ok

## Checklist
- [x] Todo AC tem tarefa e check; toda tarefa cita AC [Coverage]
- [x] Sem contradição aberta: a regra do rótulo vale para queued e resumed (D2) [Conflict]
- [x] A1 e A2 têm % e base; A1 é validada na tarefa 2 antes de codar [Assumption]
- [x] Caminhos de falha (vazio, grande, desconhecido, não-dono, cota, corrida, chave off, tarde demais) têm IF/THEN [Gap]
- [x] Arquivos sobrepostos serializados: 2→3→4 com o mesmo dono do send.test.ts; 6 e 7 em paralelo (arquivos disjuntos) [Readiness]
- [x] Estrutura: nenhum arquivo novo em subagent/ nem em fleet/; ≤ 800 linhas checado na 3 [Readiness]
- [x] Pré-mortem: perda silenciosa (D3), corrida (D4), eval no ruído ou contaminada (D8 + checagem de drift), com mitigações em tarefas [Pre-mortem]
- [x] Verificação independente: gate-runner + plan-reviewer, em contexto separado dos workers [Readiness]
- [x] Revisão T3 em contexto novo feita (reliability-reviewer): 1 crítico e 5 maiores incorporados como D3–D8 e AC4–AC6 [Review]
## Progresso
- [DONE:1] registro criado.
- [DONE:2-4] swarm-worker: fleet/{inbox,store,types,source}.ts, params.ts, index.ts, registry-text.ts; teste `patches/pi-code/zzzzzz-subagent-send/send.test.ts` (20 testes); patch `zzzzzz-subagent-send.patch` (sha256 c2c96abf…2a00, 7 arquivos); gate.sh e red-green.sh (variante send-consumed) atualizados. Smoke do teste novo antes de gastar na comparação: 20/20 (desvio consciente da regra "verificar só no fim", para não pagar eval sobre código quebrado).
- [DONE:5] swarm-orchestration: 3 linhas sobre `send`; check-instructions 0 problemas.
- [DONE:7] eval (ver Surpresas e Resultados).
- [DONE:8] padrão ligado; patch regenerado (sha256 453ae795…).
- [DONE:9] gate (gate-runner, env de subagente limpo): gate.sh `GATE pass` (fleet-tests 174/174, cobertura files=28 failing=0 com toda linha + do patch executada, typecheck 0 novos, structure ok, 13 variantes red exit 1 incl. send-consumed, roundtrip e upgrade 0); gate-extra.sh `GATE pass` (check-instructions, check-agents, hooks, /tmp 221=221). Patch sha256 453ae795aacd96f85d3d95ae387dcf1ea2636fef5bd30994fa0c6a281b712378.
- [DONE:10] plan-reviewer: `PLAN_REVIEW: complete` (só lacunas baixas: OFF com env herdado e custo do RESTART possivelmente subcontado, as duas já registradas; a eval mede adoção, acerto e custo, e latência, parede e chamadas pós-envio vêm só do bench).
- [DONE:11] knowledge vault: seção acrescentada em Resources/Patterns/pi-agent-fleet-panel-2026-11.md (sha256 a2837a87…, 13.633 B).
- [DONE:6] bench STEER × RESTART (`~/.cache/pi-fleet-work/bench-send/summary.md`), Sonnet 5.5, k=3 por braço×tipo, 12/12 pass, 0 falha de protocolo, US$~2,7.

## Surpresas
- Eval 1ª rodada (worker): `send` respondeu `Unknown run` em 7/7 runs. Causa raiz (verificada): o worker que lançou `run_pi.py` herdava `PI_CODE_SUBAGENT`/`PI_CODE_SUBAGENT_DEPTH` (depth ≥ 1), então as sessões da eval se achavam subagentes, não criavam a frota (index.ts:242 exige depth 0) e `sendFromLead` não achava o registro. Repro no sandbox bwrap a partir de depth 0: `queued` e inbox gravada. O bench limpou `PI_CODE_*` e funcionou. Não é defeito do `send`; é do lançamento da eval (`run_pi.py` não limpa o env de subagente). Achado colateral: a eval do modo time (checkpoint 8 de pi-agents-ui-teams-sota) também foi rodada por worker e pode ter o mesmo viés ("o modelo não chamou `team`"). Fora do escopo; reportado.

## Log de decisões
- 2026-11-13, D8 aplicada → **padrão ligado** (`PI_CODE_SUBAGENT_SEND` ≠ `0`). Contrato antigo superado: "headless no nível 0 não cria frota" (teste `subagent-panel/fleet-entry.test.ts`) vale agora só com `PI_CODE_SUBAGENT_SEND=0`; o teste fixa a chave em 0 e o caminho ligado é coberto por `send.test.ts`. Motivo: o `send` precisa da frota em `pi -p` (evals, scripts). Custo: um diretório 0700 em /tmp por sessão headless, apagado na saída.

## Resultados
Bench STEER × RESTART (Sonnet 5.5, k=3 por célula, `~/.cache/pi-fleet-work/bench-send/summary.md`):

| braço | tipo | pass | custo médio | parede média | latência de entrega |
|---|---|---|---|---|---|
| STEER | curto | 3/3 | $0,189 | 21 s | 2,5 s |
| RESTART | curto | 3/3 | $0,187 | 21 s | — |
| STEER | longo (`sleep 30`) | 3/3 | $0,170 | 51 s | 32,1 s |
| RESTART | longo | 3/3 | $0,182 | 58 s | — |

Limites: n pequeno, fixture trivial, o custo do worker cancelado no RESTART pode estar subcontado.

Eval pareada (Opus 5.5, `~/.local/state/pelo-em-ovo/results/`):
- Alvo, ON a partir do depth 0 (`send-on-tgt-d0-20261113T161110`, k=3): 6/6 pass, `send` chamado e `queued` em 6/6, sem resume nem cancel; mediana $0,19 por caso. OFF (`send-off-tgt2-20261113T155813`, k=1): 2/2 pass via resume/cancel, mediana $0,26 por caso.
- Regressão, 8 casos de outcome k=1: ON depth 0 (`send-on-out-d0-20261113T161112`) 8/8, $2,21; OFF (`send-off-out-20261113T154453` + `send-off-out2-20261113T160019`) 8/8, $2,32 → 0,95x, sem passa→falha.
- Ressalva: os braços OFF rodaram com o env de subagente herdado (depth ≥ 1). Com a chave desligada, isso só muda o nível de aninhamento disponível, e nenhum dos casos aninha. A rodada OFF não foi refeita por causa do orçamento.
- D8: (a) adoção 6/6 ≥ 4/6 ✓; (b) STEER ≥ RESTART em acerto e custo dentro de ±10% ✓; (c) sem regressão ✓ → ligado.
- Gasto: bench ~US$2,7 + eval do worker ~US$7,0 + reexecução em depth 0 ~US$3,4 ≈ US$13,1 de 15.
