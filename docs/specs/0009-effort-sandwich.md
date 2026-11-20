# 0009: esforço no plano (C7)

Estado: opt-in (`PI_EFFORT_SANDWICH=1`), `high` só no 1º turno. Ganha acerto nas tarefas difíceis, mas o gate do PR
reprovou o custo nas fáceis (abaixo), então fica desligado por padrão.

## Objetivo

A LangChain, no Terminal-Bench 2.0, subiu o raciocínio no planejamento e o baixou no meio da execução. Hipótese:
`high` no turno em que o modelo lê a tarefa e planeja melhora o acerto de um `pi -p` em nível menor, sem o custo de
`high` na sessão inteira.

## Contrato

Na sessão headless de topo (sem UI e `PI_CODE_SUBAGENT_DEPTH` ausente ou 0, o `isTopLevelHeadless` de
`packages/coding-agent/src/extensions/headless-lean`), o hook `turn_start` de `packages/coding-agent/src/extensions/effort-sandwich`:

1. guarda `pi.getThinkingLevel()` no primeiro turno;
2. nos turnos 0 a N-1 chama `pi.setThinkingLevel('high')` (N = `PI_EFFORT_SANDWICH_TURNS`, inteiro positivo, padrão 1);
3. a partir do turno N volta ao nível guardado;
4. se o nível inicial já for `high`, `xhigh` ou `max`, não chama `setThinkingLevel`.

Sem `PI_EFFORT_SANDWICH=1` nenhum handler é registrado. TUI, RPC e subagentes não mudam. O pi envia o nível como
marcador de esforço na conversa (o `output_config` do topo fica fixo para o cache); conferido no payload pela API falsa
de `bench/contract`. As duas chaves são aceitas na configuração de ambiente do nycode (no ny-pi: `local.env` lido por `bin/pi`; destino: `settings-defaults.ts`, K4).

## Medição (Terminal-Bench 2.0, 13 tarefas que a main não satura, k=3, conta do plano, Sonnet 5.5, nível medium)

| Variante | Acerto | Diferença pareada (IC90, P) | Custo | US$/acerto | Veredito |
|---|---|---|---|---|---|
| controle (medium constante) | 7/39 | | US$4,32 | 0,617 | |
| high nos turnos 0–1 | 12/39 | +12,8 pp [+2,6; +23,1], 0,96 | US$8,34 | 1,13× | rejeitado (custo > 1,10×) |
| high a partir do turno 4 | 7/39 | +0,0 pp [−10,3; +12,8], 0,41 | US$4,77 | — | rejeitado (sem ganho) |
| **high só no turno 0** | **13/39** | **+15,4 pp [+0,0; +33,3], 0,93** | US$6,61 | **0,82×** | passa no A/B |

Regra pré-registrada: adotar se P(à frente) ≥ 0,80 e US$/acerto ≤ 1,10×. O braço de 1 turno e o de turno 4 rodaram
depois do controle (mesmo dia e máquina, não intercalados). As tarefas foram escolhidas por a main falhar nelas; o
gate do PR mede o custo e os turnos nas tarefas fáceis.

Gate `bench-pr` do PR #60 (42 tarefas fáceis, ligado por padrão, head `895d114`): acerto sem perda (IC99 [+0,0;
+19,2] e [+0,8; +21,9] pp), turnos 1,00×, mas custo mediano pareado **1,095× e 1,160×** contra o limite de 1,10×; as
duas rodadas ficaram NOT_VERIFIED por `AgentSetupTimeoutError` (apt lento do Ubuntu na preparação). Conclusão: o custo
extra do 1º turno não se paga em tarefa fácil; ligar por padrão exigiria trocar o critério de custo do gate por US$/acerto,
decisão do dono, não deste PR.

## Limites conhecidos

- O ganho vem de poucas tarefas (install-windows 3/3 × 0/3, mteb-leaderboard 3/3 × 1/3, video-processing 2/3 × 0/3);
  o limite inferior do IC90 é 0. Confirmar na próxima re-medição do Terminal-Bench.
- Mais esforço no início faz o modelo trabalhar mais a sessão inteira (custo por tarefa 1,53× nessas tarefas).
- A mudança de nível é gravada no histórico da sessão e restaurada ao retomá-la.

## Reverter

Tirar `PI_EFFORT_SANDWICH=1` da configuração de ambiente, ou apagar `packages/coding-agent/src/extensions/effort-sandwich/`, a linha em
`docs/specs/0005-core-scope.md` e as chaves em `settings-defaults.ts` (no ny-pi: também as duas linhas em `publish.list` e as chaves em `bin/pi`).
