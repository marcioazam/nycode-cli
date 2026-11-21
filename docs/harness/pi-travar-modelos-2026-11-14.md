# /travar-modelos: a sessão só roda os modelos e esforços escolhidos (2026-11-14)

Pedido do dono: um comando que obrigue, na sessão atual, o pi a rodar somente os modelos e efforts selecionados; vale
para o chat principal, subagentes, swarm, agentes em segundo plano, `run` e plano ("tudo, literal"); testar com Claude de
ponta a ponta.

## Aceite

1. `/travar-modelos` (sem argumento) abre o seletor de modelos e esforços (o `SetupComponent` do `/subagents-setup`);
   `/travar-modelos provedor/id:low,medium outro/id:high` trava direto; `show` mostra; `off` destrava.
2. Com a trava, nenhuma chamada de modelo do processo sai com modelo ou esforço fora da lista: chat principal,
   compactação e resumos, avaliador do `/goal`, `/btw`, advisor, modo plano.
3. Todo processo `pi` filho herda a trava: subagentes em primeiro e segundo plano, lotes paralelos (swarm), times,
   aninhados, e um `pi` lançado por `bash` ou `run`.
4. Pedido fora da lista é trocado pelo permitido mais próximo (não falha), e a troca fica registrada no diagnóstico.
5. O chat principal muda na hora para um par permitido; trocar de modelo ou esforço para fora da lista é desfeito com aviso.
6. A trava vale para o processo do pi (a sessão em uso) e some ao sair; nada é gravado em `settings.json`.
7. Sem trava, nenhum comportamento muda.

## Desenho

Ponto único de passagem: `ctx.modelRegistry.runtime` é a instância de `ModelRuntime`; `ModelRegistry.stream/complete/
streamSimple/completeSimple` delegam a ela, `complete` chama `stream` e `completeSimple` chama `streamSimple`
(`core/model-registry.js:71-78`, `core/model-runtime.js:498-532`), e o laço do agente chama `modelRuntime.streamSimple`
(`core/sdk.js:272`). A extensão embrulha `stream` e `streamSimple` dessa instância. `before_provider_request` não serve:
só cobre o laço do agente e engole exceções (`core/extensions/runner.js:1074-1100`).

- `streamSimple(model, context, options)`: esforço = `options.reasoning ?? 'off'`. Fora da lista: troca o modelo pelo
  permitido (o do chat principal se permitido, senão o primeiro da trava) e o esforço pelo maior permitido ≤ pedido
  (senão o menor permitido).
- `stream(model, context, options)` (opções cruas do provedor): só o modelo é conferido; fora da lista, a chamada é
  recusada com erro claro (trocar o modelo com opções de outro provedor não é seguro).
- Herança: a trava vive em `process.env.PI_MODEL_LOCK` (JSON `{"version":1,"models":{"provedor/id":["low"]}}`, o formato
  da política do `/subagents-setup`). Os filhos recebem `{...process.env}` (`subagent/run.ts:346`,
  `subagent/background.ts:336`; `bash` e `run` herdam o ambiente). No filho a extensão carrega a trava do ambiente,
  mesmo sem UI e com `PI_CODE_SUBAGENT=1`, ajusta o próprio modelo no `session_start` e embrulha o mesmo ponto.
- Fuga pelo shell: com a trava ligada, `tool_call` de `bash`/`run` que mencione `PI_MODEL_LOCK` é bloqueado.

## Limites conhecidos

- Programas que não são o pi (`claude -p`, `codex`, `curl` para uma API) não passam pela trava.
- Um modelo virtual é conferido pelo id virtual e de novo pelo modelo roteado.
- `PI_MODEL_LOCK` inválido: aviso único e a trava fica desligada? Não: falha fechada. JSON inválido bloqueia toda chamada
  de modelo com erro claro, porque o pedido é de obrigação literal.

## Custo e qualidade

Custo: uma comparação de strings por chamada de modelo; zero byte sempre carregado. Qualidade: garantia de custo e de
modelo por sessão. Rollback: `/travar-modelos off`, ou remover `extensions/travar-modelos` do `publish.list`.

## Checkpoint

- [x] Extensão + testes unitários (19/19)
- [x] E2E com Claude (principal, troca manual, subagente, segundo plano, lote paralelo, `run`, plano)
- [x] `publish.list` + link + catálogo de comandos

## Evidência (2026-11-14)

Medido no fio: sonda temporária embrulhando `fetch`, lendo `model` e o esforço ativo do corpo enviado a
`/v1/messages` (o esforço ativo vai na última mensagem `system` com `output_config.effort`; o `output_config` de topo é
sempre `low` nesses modelos, `pi-ai/dist/api/anthropic-messages.js:1175-1178`).

Modo `-p`:

| Trava | Pedido | Saiu no fio |
|---|---|---|
| nenhuma | sonnet-5-5 · high | sonnet-5-5 · high |
| `haiku-5-5:low` (ambiente) | sonnet-5-5 · high | haiku-5-5 · low |
| `sonnet-5-5:medium` (ambiente) | sonnet-5-5 · xhigh | sonnet-5-5 · medium |
| JSON inválido | sonnet-5-5 | nenhuma requisição; erro `PI_MODEL_LOCK inválido` |

TUI em tmux (`~/.local/bin/pi --no-session --model anthropic/claude-sonnet-5-5 --thinking high`), depois de
`/travar-modelos anthropic/claude-haiku-5-5:low`: toda requisição saiu `claude-haiku-5-5 · low` em

- chat principal (antes da trava: `sonnet · high`);
- depois de `/model claude-sonnet-5-5` (desfeito, aviso `Trava de modelos: … não é permitido nesta sessão; voltei para …`);
- subagente `general-purpose` (pin Sonnet) em primeiro plano, em segundo plano e lote paralelo (`code-reviewer` +
  `swarm-worker`, dois processos filhos);
- `run` com `pi -p --model anthropic/claude-sonnet-5-5 --thinking high` (processo filho comum);
- modo plano.

`env -u PI_MODEL_LOCK true` pelo `bash` foi bloqueado (registro no `diag.jsonl`). Depois de `/travar-modelos off` e
`/model claude-sonnet-5-5`, a requisição voltou a sair `sonnet`.

Não exercitado: o seletor sem argumentos na TUI (só o caminho com argumentos), modelos de outros provedores, modelo
virtual.
