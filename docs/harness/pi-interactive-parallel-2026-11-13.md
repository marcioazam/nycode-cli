# Principal editável durante subagentes: async por padrão + enviar-agora (2026-11-13)

Status: implementação local instalada; gate integrado pendente após os ajustes visuais pedidos durante a execução. Testes em `bin/tests/interactive-input/`. Fonte canônica: `<repo>/claude-home`; os caminhos correspondentes em `~/.pi/agent/claude-home` são symlinks individuais.

## Objetivo
Com subagentes rodando, o usuário continua editando/operando o pi principal. (1) Delegações single/parallel/chain da
sessão raiz interativa são assíncronas por padrão (painel `/tasks` já existe). (2) `Ctrl+Enter` e, portável,
`Ctrl+X Ctrl+S` abortam a tool/bash ativa e submetem o rascunho; filhos em background sobrevivem.
Fonte: https://code.claude.com/docs/en/interactive-mode.md (Enter enfileira; Ctrl+Enter envia agora). Escopo: cancelar
bash/tool, não a variante recente de bash em background do Claude.

## Atual / esperado / inalterado
| | Atual (pi-code 1.7.0, core 1.5.2) | Esperado | Inalterado |
|---|---|---|---|
| Roteamento | `wantsBackground` (modes.ts:89) só com `background:true` ou frontmatter; raiz+UI usa `runDetachableForeground` (index.ts:132/378) | raiz interativa (`ctx.mode==='tui' && subagentDepth()===0`; `hasUI` é true também em RPC, por isso não serve) sem flag → background (single, parallel, chain) | `background:false` explícito = foreground detachável; aninhado/headless = como hoje; `{status}`, cap `MAX_BACKGROUND_RUNS` |
| Enter com stream | `onSubmit` enfileira steer (interactive-mode.js ~2648) | igual | Enter |
| Ctrl+Enter / Ctrl+X Ctrl+S | inexistente | aborta turno ativo (tool/bash) e submete rascunho | `!bash` nativo tem abort próprio |
| Abort do principal | `raceDetach` aborta só filhos não-detached | idem; filhos background/detached sobrevivem | Ctrl+B |

## Aceitação observável
1. Raiz TUI, sem flag: single retorna na hora o id de run; parallel/chain retornam na hora um reconhecimento (AUTO_DETACHED_TEXT) e a conclusão chega depois como mensagem 'started in the background'; o editor segue livre.
2. `background:false` → foreground detachável; `mode!=='tui'` (RPC/print), `depth>0` → idêntico ao atual. Duas chamadas simultâneas: o auto-detach de uma nunca move a irmã que espera explicitamente; sinal já abortado não é revivido pelo auto-detach.
3. Abort do turno depois do detach/background não aborta o filho; antes do detach, aborta e não deixa Ctrl+B reviver.
4. Ctrl+Enter e Ctrl+X Ctrl+S (citação nativa: "Sends your queued messages, and your draft with them, right away"; Enter enfileira): com rascunho e/ou fila, cancela a tool/bash ativa, espera ficar ocioso (limite), e submete fila+rascunho (steer, follow-up, rascunho; `\n\n`) uma única vez; ocioso: submete direto; **sem rascunho e sem fila: no-op** (não aborta; Esc já existe); só fila: envia a fila. Escolha do usuário: cancelar tool/bash, não o auto-background recente do Claude.
5. Runtime usa o `await session.abort()` nativo do core (Promise) e `abortBash()` + espera de `isBashRunning=false`; o `ctx.abort():void` de extensão não é usado.
6. Falha de entrega não perde o rascunho (volta ao editor).

## Interfaces que os testes miram (contrato nativo, evidência: interactive-mode.js ~2135/2143, runtime.mjs)
Pasta `bin/tests/interactive-input/` (6 arquivos de código, limite 7):
| Arquivo | Alvo | Observação |
|---|---|---|
| `async-default-routing.test.ts` | `wantsBackground(params, agents, defaultBackground=false)`, `raceDetach(signal, work, autoDetach=false)` | cópia isolada de `extensions/`; sinal já abortado não é revivido; irmã explícita não é movida |
| `root-routing-integration.test.ts` | `subagent.execute` real (pi falso + filho falso, `fleetTestEnv` de `patches/pi-code/subagent-panel/setup.ts`) | raiz = `ctx.mode==='tui' && subagentDepth()===0`; RPC (`hasUI` true), print e depth>0 ficam em foreground; mais os testes de teto compartilhado |
| `detach-capacity.test.ts` | `fleet/detach.ts`: `MAX_AUTO_DETACHED_BATCHES=8`, `reserveAutoBatchSlot(activeBackground=0)` → release idempotente ou `undefined`, `activeAutoBatchSlots()` | `raceDetach` não impõe teto sozinho; estado em símbolo global |
| `send-now-runtime.test.ts` | `runtime.mjs`: `installSendNow(host, matchesKey)`, `sendNow(host, waitMs=10000)`, `CHORD_MS=500` | host falso só com a forma nativa: `addExtensionTerminalInputListener`, `clearAllQueues`, `session.isIdle`/`isBashRunning`/`abort():Promise`/`abortBash()`, `editor.{getText,getExpandedText,setText,addToHistory,handleInput}`, `renderer.getFocusedComponent`, `showError`; timers do chord com `mock.timers` |
| `send-now-apply.test.ts` | `patches/pi-core/send-now/apply.mjs` em dist falso | idempotência, tudo-ou-nada, versão 1.5.2, chunk do bundle obrigatório, runtime renovado, revert, CLI exit 2 |
| `native-cli-e2e.test.ts` | pi real em tmux + provider HTTP falso local | `PI_E2E_BIN` (padrão `~/.local/bin/pi`); sem rede externa nem modelo pago |

Contrato do runtime (verificado contra a fonte nativa):
- Falha de cancelamento (`abort()` rejeita, `abortBash()` lança, timeout `waitMs`) **não é engolida**, mesmo com `isIdle` true: sem submit, `showError`, capturado (fila + rascunho) volta ao editor antes do que foi digitado depois.
- Ctrl+X é consumido temporariamente para reconhecer o acorde antes do stash nativo (Ctrl+S). Sem Ctrl+S em `CHORD_MS`, o Ctrl+X nu é entregue ao editor (`handleInput`) uma vez (cópia nativa atrasada); outra tecla antes disso devolve o Ctrl+X na hora e a tecla segue; foco fora do editor, remover ou reinstalar descartam o acorde. Force-send nunca copia como efeito colateral.
- Troca de sessão **ou** de editor durante o abort (**F2, supersede a decisão "só editor original"**): nada é entregue (sem submit) e o rascunho atual não é escrito (sem `setText`); o capturado vai **uma vez** a `host.editor.addToHistory` do editor ATUAL (alcançável por ↑) com aviso explícito. Evidência: o histórico do editor substituído é inacessível depois de `setCustomEditorComponent` (interactive-mode.js ~2337-2380 copia só o texto). É recuperação opcional segura, não injeção no prompt/sessão. A frase "restaurar no editor" vale apenas para falha sem troca.
- **F1** (revisão independente): `host.clearAllQueues()` → `agent.clearAllQueues()` apaga TAMBÉM mensagens custom (ex.: conclusão `subagent-background`), pois só devolve texto humano. Contrato: sem texto humano (rascunho vazio e nenhuma fila humana) é no-op total (não limpa, não aborta); com texto, as mensagens `role!=='user'` das duas filas são reenfileiradas, na mesma fila e ordem, logo após o clear (sem await), antes do abort; envio falho as mantém; forma de fila inesperada (core ≠ 1.5.2) falha fechada sem mutar e com erro acionável. Testes usam o `Agent` real do core para não esconder isso; E2E com extensão isolada que emite `CUSTOM_COMPLETION_TOKEN`.
- Seleção de runtime para vermelho limpo: `PI_SEND_NOW_RUNTIME=<runtime antigo>` em `send-now-runtime.test.ts` (fixture, sem detecção de teste na produção).
- Teto: `reserveAutoBatchSlot` antes de cada lote automático; liberado na conclusão real (não no ack imediato); abort do turno não libera; `background:false` é o desvio manual; singles em background e lotes somam no mesmo teto de 8, com admissão cedo e logo antes de `startBackgroundRun`.

## Contrato antigo → novo (testes obsoletos, regra "spec > testes")
| Antes (1ª rodada de testes) | Agora | Motivo |
|---|---|---|
| `host.ui.addInputListener`, `session.isStreaming`, `session.clearAllQueues`, `session.waitForIdle`, `sendNow(host,{timeoutMs})` | `host.addExtensionTerminalInputListener`, `session.isIdle`, `host.clearAllQueues`, polling de `isIdle` com limite, `sendNow(host, waitMs)` | forma real do InteractiveMode 1.5.2; o runtime não é moldado a mocks |
| Ctrl+X nunca consumido | Ctrl+X consumido por `CHORD_MS` | sem isso o Ctrl+S nativo (stash) dispara antes do acorde |
| Troca de sessão restaurava o texto no editor | 1ª revisão: só histórico do original; **final (F2)**: histórico do editor ATUAL + aviso, sem setText/submit | histórico do editor substituído é inacessível; evita injeção no prompt/sessão |
| clearAllQueues tratado como seguro | F1: preservar mensagens custom, no-op sem texto humano | o core apaga as custom ao limpar |
| Vermelho por import ausente | vermelho por comportamento (E2E sem o patch / installer revertido) | TDD global: import ausente não é vermelho válido |
| `hasUI` como raiz | `ctx.mode==='tui'` | `hasUI` é true em RPC |
Asserções de comportamento foram mantidas ou reforçadas; nenhuma afrouxada.

## Risco e rollback (ciclo completo)
Risco médio-alto (concorrência/cancelamento): resultados assíncronos chegam via `results.deliver` com `triggerTurn`, podendo disparar turnos inesperados; abort perdido deixa tool presa; submit duplicado. Mitigação: testes acima, cap existente de runs, restauração do rascunho. Rollback: reverter o patch (patches/pi-code) e reaplicar o pacote 1.7.0; sem migração de dados. Flag de saída recomendada: `background:false` por chamada.

## Custo esperado (harness-economy)
- Sem dependência nova e sem modelo novo. O atalho nativo não faz chamada de API além do prompt comum que ele submete.
- A conclusão assíncrona (`triggerTurn`) pode custar um turno extra do principal em relação a esperar o resultado com await; é o preço de manter o prompt livre.
- Limites existentes mantidos: 8 jobs em background e 4 workers por lote; o teto de 8 lotes auto-desanexados soma com os singles.
- Nenhuma afirmação de custo ou velocidade foi medida.

## Exceção explícita ao `background:false`
`background:false` mantém foreground **salvo** o frontmatter `background: true` do agente (single): ele continua forçando background, como já era (`wantsBackground`, modes.ts). Inalterado.

## Contrato dos backups do core (supersede `*.send-now.orig` ao lado do arquivo)
- O original de cada arquivo tocado fica em `dist/.pi-harness-backups/send-now/<caminho relativo ao dist>` (`backupPath(dist, file)` em `apply.mjs`), nunca em `bundle/chunks` nem em `modes/`. Motivo (causa raiz): `cache-warm-identity.test.ts` varre `bundle/chunks/*`, e o `chunk-*.js.send-now.orig` ao lado duplicava o marcador e quebrava o `node --check` (`ERR_UNKNOWN_FILE_EXTENSION`). O teste antigo não muda.
- `apply()`/`revert()` migram o backup antigo: novo ausente → move; os dois e idênticos → remove só o antigo; diferentes → falha antes de gravar. Âncoras todo-ou-nada e pin 1.5.2 inalterados; `revert` restaura do novo local.

## Rollback (comandos)
1. Core: `node patches/pi-core/send-now/apply.mjs <dist> --revert` (restaura os backups em `dist/.pi-harness-backups/send-now/<caminho relativo>` do `interactive-mode.js` e do chunk do bundle); remover o bloco do wrapper `bin/pi` que reaplica o patch e as cópias `send-now-runtime.mjs`.
2. pi-code: reverter `patches/pi-code/zzzzzzz-interactive-parallel.patch` (`patch -R` sobre `extensions/subagent`) e reinstalar o pacote 1.7.0 limpo.
Sem migração de dados; `background:false` por chamada segue como saída sem rollback.

## Sequência de evidência (verdade do processo)
Um primeiro rascunho de `runtime.mjs`/`apply.mjs` foi escrito **antes** destes testes e foi corrigido depois; os testes vieram antes da produção só nas partes de roteamento, teto, F1 e F2. As correções finais do main (`sendNow(host, waitMs)`, histórico do editor atual, preservação de custom) vieram **depois** dos testes que as exigem. Vermelho/verde válidos são os do gate final, por comportamento; este registro não os substitui.

## Checkpoint
- [x] Paralelismo raiz TUI (single/parallel/chain), foreground explícito e teto compartilhado instalados.
- [x] Enviar-agora instalado no bundle CLI e no SDK; F1 preserva mensagens custom, F2 recupera rascunho sem entrega à sessão errada. Editor sem histórico recebe recuperação somente no aviso local (`showError` não persiste nem envia ao modelo).
- [x] Vermelhos observados: predicado assíncrono `false != true`; Ctrl+Enter no core sem patch não cancela o Bash; 5 regressões F1/F2 contra runtime antigo; editor sem histórico rejeitava com `TypeError`.
- [x] Rodada anterior (`/tmp/pi-interactive-gate-7b20/logs2`): runtime+apply 40/40, rotas 9/9, teto 6/6, execução real do subagent 21/21, CLI nativo 7/7, pi-code raiz 112/112. Cobertura: runtime 94,97%, apply 100%. São resultados com proveniência anterior, não o gate final do estado atual.
- [x] Falhas diagnosticadas: backups `.orig` confundiam o scanner de chunks (migrados para pasta própria); replay buscava os patches canônicos (novos arquivos migrados para o repo, symlinks instalados). Os testes antigos não foram afrouxados. Ainda requerem verde no gate final.
- [x] Fixture do teto corrigida: a limpeza usa o marcador nativo `requestStop` antes de matar seus próprios PIDs, evitando classificar a limpeza como crash e disparar respawn; conta nomes exatos de lotes sem confundir singles.
- [x] `Ctrl+Shift+U`: o mapa efetivo do Kitty 0.45.0 executava `kitten unicode_input`. `~/.config/kitty/kitty.conf` agora tem `map ctrl+shift+u` sem ação; o parser nativo confirma ação final vazia. Recarregada somente a instância `KITTY_PID=27306` via SIGUSR1 após confirmar `comm=kitty`. `Ctrl+U` e `Alt+↑` não foram remapeados. Novo E2E de retirar/editar/recolocar a fila ainda pendente.
- [ ] Novos pedidos visuais e painel Plan: ver `docs/pi-interactive-display-2026-11-13.md`; implementação por lane separada, depois gate integrado final, revisão independente e aceitação.
- [ ] Rodar testes de wrapper, scanner de segurança/diff e estrutura canônica; typecheck/LSP permanece indisponível sem TypeScript. Commit/push/deploy não foram solicitados nem executados neste trabalho local.

## Gates previstos (o recibo final abaixo substituirá placeholders; reruns somente após falhas/inputs alterados)
- Vermelho de comportamento: `PI_E2E_BIN=<core sem o patch ou installer revertido> node --experimental-strip-types --test bin/tests/interactive-input/native-cli-e2e.test.ts` deve falhar nos 3 testes de envio-agora (tool cancelada / rascunho chega); `send-now-runtime`/`detach-capacity`/rotas com a correção de produção revertida.
- Verde: `node --experimental-strip-types --test bin/tests/interactive-input/*.test.ts` com tudo aplicado; depois `patches/pi-code/**/*.test.ts bin/tests/*.test.ts`; `<gate de estrutura>`; `<gate do repositório>`; cobertura de linha ≥80% de `runtime.mjs`, `apply.mjs`, `detach.ts`, `modes.ts`, `index.ts`.
