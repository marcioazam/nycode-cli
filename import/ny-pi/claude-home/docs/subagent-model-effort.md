# Subagentes: modelo e esforço na lista e no viewer (2026-11-14)

Pedido do usuário: "na listagem de sub agent e quando acessar um sub agent deve dizer qual modelo e effort está sendo usado".
Estado: concluído e verificado; revisão independente sem achados médios ou altos em aberto. Sem commit/deploy.

## Aceitação
- AC1: cada linha do painel/`/tasks` mostra `agent [modelo · esforço]` ANTES da tarefa; a tarefa e a atividade truncam primeiro; nenhuma linha passa da largura (20/40/80/160, com ANSI).
- AC2: o viewer mostra duas linhas rotuladas `Model:` (provedor/modelo completo) e `Effort:` (inclui `off`), com a origem: `configured` (argv do filho) ou `observed` (o filho confirmou).
- AC3: valor desconhecido aparece como `?` na lista e `unknown` no viewer. Nunca se assume `medium` nem o esforço do pai: sem `effort` no agente e sem evento, o esforço fica desconhecido.
- AC4: o valor configurado vem do argv real (`--model X[:nível]`, `--thinking nível`), logo cobre `modelAlias` e `CLAUDE_CODE_SUBAGENT_MODEL`, não só `agent.model`.
- AC5: o runtime vence o configurado: `provider`/`model`/`thinkingLevel` de `message_start`/`message_end` do assistente (fonte verificada: pi-ai 1.5.2 `AssistantMessage.provider|model|thinkingLevel`, `types.d.ts:387-393`; `thinkingLevel` é anexado ao resultado final da resposta em pi-agent-core `agent-loop.js:283`, então o `message_start` parcial pode não trazê-lo: nesse caso o esforço fica `unknown` até o `message_end`; o campo do `message_start` em runtime real não foi observado, não presumido) e `thinking_level_changed {level}` substituem o configurado e marcam `observed`.
- AC6: registros antigos (sem os campos) renderizam `[? · ?]`/`unknown` sem erro; foreground, background e resume gravam o mesmo (resume reinicia no configurado do novo argv); stats e navegação intactos.
- AC7 (HUD): o payload do status line traz `model.provider`; `model_select` limpa `rateLimits` antes de `scheduleRefresh()` (ver `hud-provider-usage.md`).

## Contrato do registro (RunRecord, campos opcionais novos)
`provider?`, `effort?`, `modelSeen?: true`, `effortSeen?: true`; `model?` já existia (configurado; vira o id físico ao observar).
Limites: strings ≤ 120 chars, sem controle; `effort` só `[a-z]{1,16}`.

## Desenho
- `fleet/tracker.ts`: `configuredRuntime(args)`, `onLine` trata `thinking_level_changed` e metadados do assistente.
- `run.ts` / `background.ts`: passam o argv resolvido ao `startTracking`.
- `fleet-ui/runtime-label.ts` (novo, puro): rótulos da lista (candidatos do mais largo ao mais curto) e linhas do viewer.
- `view-model.ts` (campos na linha), `panel.ts` (layout: meta fica na cabeça, antes da tarefa; prioridade: rótulo, tarefa, stats; ver Fix round 1), `viewer.ts` (linhas `Model:` e `Effort:` separadas, `CHROME_ROWS` 9: uma linha só truncava e escondia o esforço com modelo longo).
- Patches: `zzzzzzz-subagent-model-effort.patch` e `zzzzzzzz-statusline-provider.patch` (aditivos, depois do `zzzzzz-subagent-send`).
- Testes: `patches/pi-code/zzzzzzz-subagent-model-effort/{tracker,render,replay}.test.ts`, `zzzzzzzz-statusline-provider/provider.test.ts`.

## Checkpoint
- [x] Snapshot pré-fix: `/tmp/subagent-model-effort-before/extensions` (cópia da árvore instalada antes de qualquer edição).
- [x] Aceitação escrita antes do código.
- [x] Testes escritos antes do código (não executados na edição, por regra "verificar uma vez").
- [x] Código na árvore instalada e patches gerados com `diff -ruN` contra o snapshot.
- [x] Gate final: `/tmp/pi-hud-subagent-final-gate/run.04D7yJ/`; 208/208 testes TS e 64/64 HUD, zero falhas/skips.
- [x] Typecheck estrito: baseline 0, atual 0; cobertura por arquivo ≥80%, todas as linhas novas contadas cobertas.
- [x] Replay de 19 patches, equivalência à instalação e reversão ao pacote original; fontes inalteradas durante o gate.
- [x] Revisão independente final: três achados anteriores resolvidos; revisão manual dos testes sem asserções enfraquecidas.

## Limites
- O esforço "default" do filho só aparece depois de uma mensagem do assistente trazer `thinkingLevel`; antes é `unknown`.
- Fora de escopo: pins de agentes, settings globais, wrapper, fonte/testes do HUD.

## Replay
```
P=~/.pi/agent/claude-home/patches/pi-code; E=~/.pi/agent/npm/node_modules/pi-code/extensions
patch -R --dry-run -p1 -d $E < $P/zzzzzzz-subagent-model-effort.patch     # applied? (exit 0)
patch -R --dry-run -p1 -d $E < $P/zzzzzzzz-statusline-provider.patch
patch -p1 -d <copia-pristina> < $P/zzzzzzz-subagent-model-effort.patch      # aplicar
```

## Fix round 1 (após o 1º gate real)
- Viewer: duas linhas (`Model: …`, `Effort: …`), `CHROME_ROWS` 9. Testes: rótulo e valor (`off`/`high`) presentes a 20/40/80/160, também com modelo de 80 chars.
- Painel (`panel.ts`), ordem de degradação por candidato de rótulo (mais largo primeiro): (1) tarefa+atividade no mínimo, stats caem
  custo→tokens (comportamento sem rótulo; mantém o antigo `fleet-ui.test.ts` "descarta custo, depois tokens, depois atividade" a 48 colunas);
  (2) só a tarefa no mínimo, tokens sem custo; (3) só tempo, tarefa truncada; (4) só tempo; só então o rótulo sai (layout sem rótulo).
  Antes, o strict sem rótulo vencia o rótulo em 'last'/'bare' (bug de aritmética revisor) e, com rótulo, o custo ficava e a tarefa
  encolhia a 1 coluna (gate: `○ agent [? · ?] t … $1.23`). Ambos verificados: teste a 60 colunas (`[claude-sonnet-5-5 · high]` + `1m 0s` + tarefa
  truncada, sem tok/$) e varredura 20..170 colunas × modelos × tarefas (o esforço sempre aparece quando cabeça+menor candidato+tempo cabem).
  Nenhuma asserção antiga foi alterada.
- Fiação de spawn real: `fleet-spawn.test.ts` (fake-pi `ok` emite provider/model/thinkingLevel; foreground e background chegam ao registro,
  vencem o argv `--model cfg-model --thinking low`; filho que não informa nada deixa `effortSeen` indefinido). Sem provedor real, sem mudar o padrão do filho.
- Harness: `render.test.ts` usa `panel:false` (o painel esconde `done`); `replay.test.ts` já não lê `tracker.ts` após reverter a pilha inteira
  (o arquivo nasce em `subagent-panel.patch`: o original não o tem) e ganha um teste que reverte só os meus patches; `provider.test.ts` põe o `cwd`
  dentro do `tmp` do `fleetTestEnv` (dono único da limpeza).
- Patch regenerado contra `/tmp/subagent-model-effort-before/extensions` (`diff -u`, arquivo novo com timestamp época para o `patch -R` removê-lo);
  `zzzzzzzz-statusline-provider.patch` inalterado em conteúdo. Cópia da rodada 1: `/tmp/zzzzzzz-subagent-model-effort.patch.round1`.
- Cobertura TS final medida (`logs/coverage-check.txt`, `floor-changed-ts.txt`, `floor-statusline.txt`): 29 arquivos, zero falhas;
  tracker/view-model/panel/viewer/runtime-label 100%, run.ts 93,88%, background.ts 94,61%, status-line.ts 82,75%.
  Usa `FLEET_TEST_PKG` compartilhado e lcov, com 100% das linhas novas contadas cobertas. LSP dos arquivos principais sem diagnósticos
  registrados; o typecheck executado é a prova estática. Estrutura dos diretórios afetados sem achados; oito violações globais
  preexistentes fora do escopo, registradas em `hud-provider-usage.md`.
- Sem teste de provedor real ou avaliação paga. O campo de effort antes da primeira resposta real continua não observado:
  aparece desconhecido até confirmação; não se inventa o default. Não há Git neste workspace; sem commit ou prova de entrega Git.
