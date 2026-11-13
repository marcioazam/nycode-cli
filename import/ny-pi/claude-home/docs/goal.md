# /goal no pi (pi-code 1.7.0 + patch local)

`/goal <condição>` mantém a sessão trabalhando até um avaliador separado confirmar a condição.
Base: [docs do Claude Code](https://code.claude.com/docs/en/goal.md) (lido em 2026-11-11, inclui o
comportamento da v2.1.269). O pi-code implementa a paridade; o patch
`claude-home/patches/pi-code/goal.patch` corrige um bug e vai além dela.

## O bug corrigido: "Goal evaluator error: unreadable verdict: ."

O Opus/Sonnet 5.5 e o Fable 5 têm `thinkingLevelMap.off = null`: não desligam o thinking. Sem
nível pedido, o pi-ai cai em thinking adaptativo com effort **high**, que divide o `maxTokens`
(512) com a resposta. Em transcript grande o thinking consome tudo, e a chamada termina com
`stopReason: "length"` e texto vazio. Reproduzido com chamadas diretas ao `completeSimple`.

Correção em `internal/model-complete.ts` (vale para todo `completeText`: avaliador do /goal,
prompt hooks, título de sessão, prompt do WebFetch): `minimalReasoning(model)` pede thinking
off quando o modelo aceita, senão o menor nível aceito (`low` no Opus 5.5). Resultado medido:
0 tokens de reasoning, JSON completo.

## Comportamento atual

| Aspecto | Claude Code | pi (com patch) |
|:-|:-|:-|
| Avaliador | modelo pequeno (Haiku); `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `PI_GOAL_MODEL` > `ANTHROPIC_DEFAULT_HAIKU_MODEL` > Haiku mais novo do provedor da sessão (hoje `claude-haiku-5-5`) > modelo da sessão |
| Thinking do avaliador | desligado | off, ou o menor nível quando o modelo não desliga |
| Veredito ilegível/vazio | erro de hook, turno termina | até 3 chamadas: corte por tamanho → orçamento de 4096; Haiku inacessível (404/auth) → modelo da sessão; resto → backoff de 2 s e 4 s. Depois: "Goal paused: the evaluator failed 3 times (...)" |
| Formato do veredito | JSON schema | ferramenta `goal_verdict` forçada (`tool_choice`) com schema estrito quando o avaliador é Anthropic com thinking desligável (Haiku 5.5); se o provedor rejeitar, cai para texto. Texto: objeto balanceado (respeita strings), fence, 2º objeto, `"ok": "true"`, prosa yes/no |
| Cláusula de turno/tempo | o agente relata, o avaliador lê | o harness injeta "turn N since the goal was set, running for X" no prompt do avaliador |
| Kickoff | só a diretiva | diretiva + "o avaliador só lê a conversa: rode as checagens e termine cada turno mapeando cada parte da condição à evidência" |
| Turno falho transitório (overload, 5xx, rede, timeout) | 3 retries e depois pausa (interativo) | igual: 15/30/60 s, "Goal still active ... retrying in Ns (k/3)", depois "Goal paused (..., after 3 automatic retries)" |
| Rate limit, limite de uso, hook | pausa | pausa ("Goal paused (rate limit)") |
| Erro irrecuperável (auth, crédito, overflow, modelo) | limpa o goal | igual (upstream) |
| `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` | desliga check-ins e retries | igual |
| Status `/goal` | condição, tempo, turnos, tokens, último motivo | + `Evaluator: provider/id`; o veredito final mostra `Evaluator (provider/id): ...` |
| UI | indicador `◎ /goal active (5m)`, linhas de transcrição `goal_status` (✓ achieved / ✗ failed / ○ not yet met), painel `/goal` | igual: `registerMessageRenderer('goal')` com `details.kind` (expande com o atalho de expandir), painel `ctx.ui.custom` no TUI, sem toast duplicado de "Goal set"; sem pulso |
| Timeout do avaliador | 30 s (prompt hook) | 90 s (transcript de até ~500k tokens) |

Mantidos do upstream: o limite de 4.000 caracteres, os aliases de clear, o block cap sem uso de
ferramenta (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, 8), o adiamento enquanto há subagent rodando e os
check-ins, o restore no resume e o modo `-p`.

## Manutenção

- Outro patch no mesmo diretório: `subagent-nesting.patch` (aninhamento até profundidade 3 com orçamento por árvore;
  roster só em quem ainda delega; teste `subagent-nesting.test.ts`; `pi-multi-agent-2026-11-11.md`).
- `statusline-multiline.patch`: statusLine com 2+ linhas vira widget acima do rodapé (teste
  `statusline-multiline.test.ts`; `pi-plugins-port.md`).
- `rewind-tree.patch` (`git-checkpoint.ts`): `/tree` pergunta "Restore code to that point?" quando o destino tem
  checkpoint, e `/rewind` ganha "Summarize from here" (teste `rewind-tree.test.ts`; `pi-ui-sota.md`).
- `todo-collapse.patch` (`todo.ts`): `ctrl+shift+t` alterna o widget de todos entre lista e uma linha (teste
  `todo-collapse.test.ts`; `pi-ui-sota.md`).
- `notify-focus.patch` (`notify.ts`): usa o evento `pi-ui:terminal-focus` quando existe; sem ele, a heurística de
  ausência (teste `notify-focus.test.ts`; `pi-ui-sota.md`).
- `subagent-panel.patch` (`subagent/`, sobre o `subagent-nesting.patch`): painel de agentes abaixo do editor
  (1º-3º grau), viewer com steer, `x x`, `Ctrl+B`, `/tasks` (testes `subagent-panel/*.test.ts`, gate `~/.cache/pi-fleet-work/gate.sh` com piso de cobertura e cobertura das linhas do patch;
  `pi-agent-fleet-2026-11-12.md`).
- Arquivos: `goal.ts`, `internal/goal-evaluator.ts`, `internal/goal-ui.ts` (renderização pura: linhas de transcrição, painel, indicador; novo, só existe no patch), `internal/model-complete.ts` em
  `~/.pi/agent/npm/node_modules/pi-code/extensions/`. Os originais do upstream 1.7.0 ficam em
  `patches/pi-code/orig/`.
- O wrapper `~/.local/bin/pi` reaplica cada `patches/pi-code/*.patch` que ainda não esteja aplicado
  (aplicado = o reverso casa), por exemplo depois de `pi update`. Se um não aplicar limpo, avisa no
  stderr e fica de fora; o /goal continua com o trust liberado pelo sed antigo. Antes do loop, se a pilha
  inteira desfaz limpa em ordem reversa numa cópia temporária, nada é feito: patches sobrepostos
  (`subagent-panel` sobre `subagent-nesting`) falham no reverso individual mesmo aplicados (2026-11-12).
- Para refazer o patch numa versão nova:
  1. Copie os 3 arquivos novos para `orig/`.
  2. Reaplique as mudanças.
  3. Gere `diff -ruN a b > goal.patch`, com `a/` = orig e `b/` = patched, caminhos relativos a `extensions/`.
- Testes (copiam o pacote para /tmp, porque o Node não tira tipos dentro de node_modules):
  ```
  node --experimental-strip-types --test ~/.pi/agent/claude-home/patches/pi-code/goal.test.ts \
    ~/.pi/agent/claude-home/patches/pi-code/goal-lifecycle.test.ts
  ```
  Os testes cobrem 17 casos: parse, classificador, reasoning mínimo, veredito por ferramenta forçada, retries do avaliador, retry e
  pausa de turno, cancelamento por prompt, modo headless e override do modelo.

> Atalhos: trocados em 2026-11-13 para não usar Alt — ver `hotkeys-no-alt-2026-11-13.md`.
