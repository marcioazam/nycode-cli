# Onda 9: pi-noite (Tokyo Night minimalista)

Plano aprovado em 2026-11-14 (plan mode), materializado de `~/.pi/agent/plans/2026-11-14-01a1daaa.md`.

Tier: T2 (sinais: objetivo vago "SOTA minimalista", tema + extensão ui-visual + kitty, pesquisa externa)

## Resumo
- Objetivo: deixar o pi com visual minimalista Tokyo Night: ativar o tema `pi-noite`, reduzir o realce de código a 4 cores, caixa de sucesso neutra, raciocínio sem amarelo, e fonte JetBrains Mono sem remendo no kitty.
- Fora de escopo: tema claro novo; mudar `pi-escuro`, `pi-claro`, `tokyo-night` (só o tom das linhas de diff muda neles, ver riscos); trocar de família de fonte; commit/push/PR (ficam para pedido do dono, junto com as mudanças anteriores desta conversa).
- Estimativa: 8 tarefas, 2 workers em sequência + sessão principal, 1 rodada de correção, ordem de 1–3 USD.
- Registro na execução: `~/code/pi-harness/docs/designs/onda9-noite/README.md` (Progresso, Surpresas, Log de decisões, Resultados).

## Decisões e suposições
- D1 (dono): ativar `pi-noite` só no escuro: `"theme": "pi-claro/pi-noite"` em `~/.pi/agent/settings.json`. Rejeitado: criar par claro; não ativar.
- D2 (dono): sintaxe estilo Alabaster com 4 cores no `pi-noite`: `syntaxString`=`ok` (verde), `syntaxNumber`=`magenta`, `syntaxFunction`=`accent` (azul), `syntaxType`=`cyan` (fica ciano porque o mesmo token pinta a bolinha "executando"); `syntaxKeyword` e `syntaxVariable`=`text`; `syntaxComment`=`muted`; `syntaxOperator` e `syntaxPunctuation`=`dim`. Base: tonsky.me/blog/syntax-highlighting ("absolute minimum of colors", não colorir palavras-chave, pontuação apagada, comentário visível). Rejeitado: 6 cores; tipos na cor do texto.
- D3 (dono): sucesso neutro no `pi-noite`: `toolSuccessBg`=`surface` (`#262734`). Ciano (executando) e vermelho (erro) continuam. Base: Apple HIG Color, "reserve it for elements that truly benefit from emphasis, such as status indicators" e "Avoid relying solely on color" (o ✓ já indica).
- D4 (forçada por D3): as linhas de diff deixam de usar `toolSuccessBg`/`toolErrorBg`. Fundo da linha = `mixRgb(cor de toolDiffAdded|toolDiffRemoved, fundo base da caixa, TINT)`, base = `getBgAnsi(o.base ?? 'customMessageBg')`. `TINT` = o maior entre 0,10 / 0,08 / 0,06 com que os 4 temas coloridos passam no teste de contraste novo (tarefa 3). O número da linha (gutter) nas linhas mudadas passa de `dim` para `muted`. A ênfase de palavra continua 30% da cor sobre o novo fundo.
- D5 (dono): raciocínio só em azul no `pi-noite`: `thinkingOff`=`dim`; `thinkingMinimal`, `thinkingLow`=`muted`; `thinkingMedium`=`text`; `thinkingHigh`, `thinkingXhigh`, `thinkingMax`=`accent`.
- D6 (dono): kitty com `font_family JetBrains Mono` (release v2.304, sem remendo). Base: FAQ do kitty, "don't do that as patching destroys fonts… kitty has a builtin NERD font". As fontes remendadas ficam instaladas (servem de reserva para os ícones).
- A1 (~90%, base: escolha "só ativar"; o example é o padrão publicado): `settings.json.example` continua `pi-claro/pi-escuro`.
- A2 (~90%, base: cálculo à mão 4,58:1, o teste existente decide): com sucesso neutro, o fundo derivado do aviso (▲) no `pi-noite` vira um neutro arroxeado (~`#322b34`). Se o teste "fundo derivado do aviso" falhar, `toolSuccessBg` do `pi-noite` vira `#222430` (bg + 5% do texto; medido: dim 5,13:1).
- A3 ⚠ (~75%, licença não lida na pesquisa): JetBrains Mono é OFL 1.1; validada na tarefa 5 (ler `OFL.txt` do pacote antes de instalar).

## Glossário
- Fundo base da caixa: o fundo neutro em que o diff é desenhado (`customMessageBg` no edit concluído).
- Cor com croma: verde, magenta, azul ou ciano; `text`, `muted` e `dim` são cinzas azulados e não contam.

## Aceitação
- AC1: WHEN o pi inicia em terminal de fundo escuro THE SYSTEM SHALL carregar o tema `pi-noite`.
- AC2: WHEN um bloco de código é realçado no `pi-noite` THE SYSTEM SHALL usar só verde, magenta, azul e ciano como cores com croma, com palavras-chave em `text`, comentários em `muted` e pontuação em `dim`.
- AC3: WHEN uma tool termina sem erro no `pi-noite` THE SYSTEM SHALL pintar a caixa com o mesmo fundo de `customMessageBg` (`#262734`).
- AC4: WHEN um diff é desenhado num tema com cor de 24 bits THE SYSTEM SHALL pintar cada linha adicionada ou removida com a mistura `TINT` da cor do diff sobre o fundo base, sem ler `toolSuccessBg` nem `toolErrorBg`, e o número da linha em `muted`.
- AC5: IF o tema não expõe `getFgAnsi`/`getBgAnsi` THEN THE SYSTEM SHALL manter os fundos nomeados `toolSuccessBg`/`toolErrorBg` nas linhas de diff.
- AC6: WHEN o nível de raciocínio é exibido no `pi-noite` THE SYSTEM SHALL usar apenas `dim`, `muted`, `text` e `accent`.
- AC7: WHEN o teste de contraste roda THE SYSTEM SHALL manter ≥ 4,5:1 em todo par de texto de todo tema colorido, incluindo `text` e `muted` sobre os dois fundos derivados do diff, e ≥ 3:1 para a barra `▎`.
- AC8: WHEN o kitty abre uma janela nova THE SYSTEM SHALL usar `JetBrains Mono` sem remendo, com os ícones Nerd Font do pi visíveis.
- AC9: IF o download da fonte falha ou o pacote não traz `OFL.txt` THEN THE SYSTEM SHALL deixar `kitty.conf` intacto e relatar o motivo.

## Riscos e rollback
- Diff muda de tom em todos os temas (D4): o teste de contraste novo cobre os 4 temas; rollback = `git checkout extensions/ui-visual/diff.ts` e os testes.
- `TINT` baixo demais deixa o diff apagado: a regra escolhe o maior valor que passa; se só 0,06 passar, registrar em Surpresas e mostrar captura ao dono.
- Ícones somem com a fonte nova: as fontes remendadas continuam instaladas; rollback = restaurar `kitty.conf.bak-fonte`.
- Tema: rollback = `"theme": "pi-claro/pi-escuro"` no settings.json. Nenhum passo é de mão única.
- Verificação independente: gate-runner roda os testes; plan-reviewer confere o diff; o dono confere o visual (AC1, AC8).

## Fases

### Fase 1: registro (gate: arquivo existe)
1. Criar registro docs/designs/onda9-noite
   - agente: sessão principal · arquivos: `docs/designs/onda9-noite/README.md`
   - ação: materializar este plano (decisões D1–D6, AC, fontes da pesquisa com URL e data 2026-11-14: tokyonight v4.14.1, HIG color/dark-mode, tonsky, FAQ do kitty, kitty 0.50.0, JetBrains Mono v2.304); marcar em `docs/designs/onda7-tokens/README.md` que a seção `pi-noite` foi superada por este registro.
   - after: (nenhum) · AC: AC1
   - check: `rg -c "D4" ~/code/pi-harness/docs/designs/onda9-noite/README.md` · pronto: registro com as 4 seções vivas

### Fase 2: tema e diff (gate: testes de ui-visual verdes)
2. Ajustar tokens do pi-noite
   - agente: swarm-worker · arquivos: `themes/pi-noite.json`, `extensions/ui-visual/test/theme-contrast.test.ts`
   - ler antes: `themes/pi-noite.json`; `theme-contrast.test.ts:25-60`
   - ação: aplicar D2, D3, D5 nos `colors`; no teste, incluir `pi-noite` na lista de nomes exigidos e um teste "pi-noite: sintaxe com 4 cores, raciocínio sem warn, sucesso = customMessageBg" que resolve os tokens e confere os valores de D2/D3/D5.
   - after: 1 · AC: AC2, AC3, AC6
   - check: `cd ~/code/pi-harness/extensions/ui-visual && node --experimental-strip-types --test test/theme-contrast.test.ts` · pronto: teste novo verde; se "fundo derivado do aviso" falhar, aplicar A2
   - passos: escrever o teste (vermelho); editar o tema; verde
3. Derivar o fundo das linhas de diff
   - agente: swarm-worker · arquivos: `extensions/ui-visual/diff.ts`, `test/diff.test.ts`, `test/tools.test.ts`, `test/theme-contrast.test.ts`
   - ler antes: `diff.ts:218-270` (strongWrapper e o map final); `diff.test.ts:14-95`; `tools.test.ts:480-506`
   - ação: D4. Um helper local `rowTint(add)` devolve a sequência `48;2;…` ou `undefined`; com `undefined`, o código atual (fundo nomeado) continua (AC5). `strongWrapper` mistura sobre o tint e volta para ele. Gutter `muted` só em linhas `add`/`del`. Exportar `TINT`. No teste de contraste: para cada tema colorido, `text` e `muted` ≥ 4,5 e a cor da barra ≥ 3 sobre os dois tints; fixar `TINT` pela regra de D4.
   - after: 2 · AC: AC4, AC5, AC7
   - check: `cd ~/code/pi-harness/extensions/ui-visual && node --experimental-strip-types --test test/*.test.ts` · pronto: 0 falhas; testes antigos que esperavam `toolSuccessBg` na linha de diff com tema truecolor atualizados com a justificativa D4 no registro
   - passos: testes vermelhos (tint derivado, fallback nomeado, gutter muted); implementar; verde

### Fase 3: ativação local (gate: conferência do dono)
4. Ativar pi-noite no settings.json
   - agente: sessão principal · arquivos: `~/.pi/agent/settings.json`
   - ação: trocar `"theme"` para `"pi-claro/pi-noite"`.
   - after: 3 · AC: AC1
   - check: `jq -r .theme ~/.pi/agent/settings.json` imprime `pi-claro/pi-noite` · pronto: dono vê o tema após `/reload`
5. Instalar JetBrains Mono e ajustar kitty
   - agente: sessão principal · arquivos: `~/.local/share/fonts/JetBrainsMono/`, `~/.config/kitty/kitty.conf`
   - ação: `gh release download v2.304 -R JetBrains/JetBrainsMono -p '*.zip' -D /tmp/jbm`; conferir `OFL.txt` no pacote (A3); copiar `fonts/ttf/*.ttf` para `~/.local/share/fonts/JetBrainsMono/`; `fc-cache -f`; copiar `kitty.conf` para `kitty.conf.bak-fonte`; trocar a linha 5 para `font_family      JetBrains Mono`. Se o download ou a licença falhar: parar sem tocar no kitty.conf (AC9).
   - after: (nenhum) · AC: AC8, AC9
   - check: `fc-match "JetBrains Mono" family` imprime `JetBrains Mono` e `rg -n "^font_family +JetBrains Mono$" ~/.config/kitty/kitty.conf` acha 1 linha · pronto: dono abre janela nova do kitty e confirma letras e ícones

### Fase final: verificação
6. Gate único (gate-runner)
   - agente: gate-runner · AC: AC2, AC3, AC4, AC5, AC6, AC7
   - after: 3, 4, 5
   - check: gate do repositório + `node --experimental-strip-types --test extensions/ui-visual/test/*.test.ts extensions/hook-msgs/index.test.ts` + `node --test claude-home/bin/hud/tests/*.test.mjs` + `python3 ~/.pi/agent/claude-home/bin/structure/structure.py --project-root ~/code/pi-harness --json` · pronto: tudo verde no head exato; falha volta ao worker (máx. 2 rodadas)
7. Revisão do plano (plan-reviewer)
   - agente: plan-reviewer · after: 6 · AC: AC1, AC8
   - check: veredito `PLAN_REVIEW: complete` · pronto: lacunas corrigidas e revisadas de novo
8. Fechar registro e relatar pendências
   - agente: sessão principal · arquivos: `docs/designs/onda9-noite/README.md`
   - ação: preencher Resultados (TINT escolhido, contrastes medidos, o que o dono precisa conferir a olho); relatar que nada foi commitado.
   - after: 7 · AC: AC7
   - check: `rg -c "Resultados" ~/code/pi-harness/docs/designs/onda9-noite/README.md` · pronto: relatório final entregue

## Checklist
- [x] Todo AC tem tarefa e check; toda tarefa tem AC [Coverage]
- [x] Contradição "fundos tingidos de volta" × "minimalista" resolvida pelo dono (D3) [Conflict]
- [x] Toda A# tem % e base; A3 ⚠ validada na tarefa 5 [Assumption]
- [x] Arquivos sobrepostos em série: `theme-contrast.test.ts` em 2 → 3 [Spec §Fases]
- [x] Limites de estrutura: nenhum arquivo novo em `extensions/ui-visual` (7 arquivos de código hoje) [Spec §Fase 2]
## Fontes da pesquisa (acesso 2026-11-14)
- Tokyo Night: `folke/tokyonight.nvim` v4.14.1 (2025-10-23), `lua/tokyonight/colors/storm.lua` e `night.lua` (raw do GitHub): bg `#1a1b26`, fg `#c0caf5`, blue `#7aa2f7`, cyan `#7dcfff`, green `#9ece6a`, red `#f7768e`, yellow `#e0af68`, magenta `#bb9af7`.
- Apple HIG Color e Dark Mode (developer.apple.com/design/human-interface-guidelines/color, /dark-mode): "reserve it for elements that truly benefit from emphasis, such as status indicators or primary actions"; "Avoid relying solely on color…"; contraste "no lower than 4.5:1".
- Realce mínimo: https://tonsky.me/blog/syntax-highlighting/ (ensaio, não estudo): mínimo de cores, não colorir palavras-chave, pontuação apagada, comentário visível.
- kitty: FAQ (https://sw.kovidgoyal.net/kitty/faq/): "don't do that as patching destroys fonts… kitty has a builtin NERD font"; kitty estável 0.50.0 (2026-11-03).
- JetBrains Mono v2.304 (github.com/JetBrains/JetBrainsMono/releases/tag/v2.304). Licença validada na tarefa 5.
- Não verificado: contagem de cores de outros temas; versões e licenças das demais fontes; página Typography do HIG.

## Progresso
- [x] 1 registro · [x] 2 tokens · [x] 3 diff · [x] 4 ativar · [x] 5 fonte · [x] 6 gate · [x] 7 revisão · [x] 8 fechar

## Surpresas
- 2026-11-14: o rastreador do plano (pi-code `plan-mode/index.ts`) contou turnos interrompidos pelo dono como "sem progresso" e encerrou a execução com a etiqueta `[plan-complete]`. Correção fora do plano, a pedido do dono: `claude-home/patches/pi-code/zzzzzzzzzzzzzzz-plan-stalled.patch` (turno com `stopReason: 'aborted'` não soma nem zera a contagem; encerramento por falta de progresso sai como `plan-stalled`; `plan-complete` só quando todas as etapas terminam). Teste: `zzzzzzzzzzzzzzz-plan-stalled/plan-stalled.test.ts` (vermelho 2/3 antes, 3/3 depois). Custo: zero por turno (uma comparação no `agent_end`).

## Log de decisões
- 2026-11-14: D1–D6 decididas pelo dono em plan mode (ver acima).

## Resultados
- Tarefa 2: `pi-noite` com D2/D3/D5; contingência A2 não usada (fundo derivado do aviso passa). `theme-contrast.test.ts` 9/9 antes da tarefa 3.
- Tarefa 3: `TINT = 0.10` (maior candidato; passou em todos os temas). Mínimos medidos sobre os tints (text / muted / barra): pi-claro 12,64 / 7,52 / 4,04; pi-escuro 10,59 / 5,22 / 4,31; pi-noite 7,39 / 5,65 / 4,78; tokyo-night 7,29 / 5,57 / 4,73. Asserções antigas alteradas em `diff.test.ts` (4, contrato D4: gutter `muted` em add/del; fundo da linha e retorno da ênfase = tint em vez de `toolSuccessBg`). `tools.test.ts` intocado (tema de 256 cores cai no fallback AC5).
- Tarefa 4: `~/.pi/agent/settings.json` → `pi-claro/pi-noite`.
- Tarefa 5: JetBrains Mono v2.304 (OFL 1.1 conferida no `OFL.txt` do pacote, A3 validada) em `~/.local/share/fonts/JetBrainsMono/`; `kitty.conf` linha 5 = `font_family      JetBrains Mono`; backup `kitty.conf.bak-fonte`; kitty local 0.45.0.
- Tarefa 6 (gate, HEAD f5a29a7 + árvore suja): ui-visual 89/0 (1 skip pré-existente), hook-msgs 5/0, hud 75/0, patches plan-* 30/0, contraste.mjs ok, temas JSON válidos, `bash -n bin/pi` ok, `test_install.sh` 14/0 (caso de rede não executado). Vermelhos não causados por esta onda: `structure` (`extensions/ui-visual/test` 8 arquivos e `docs/designs/onda7-tokens` 10, ambos de trabalho anterior não rastreado; esta onda não criou arquivo), `check-refs` (26 referências ausentes em outros módulos), `check-leaks` (gitleaks sem detalhe; 21 caminhos pessoais em outros arquivos; nenhum nos arquivos desta onda).
- 2026-11-14, pedido do dono após a revisão ("diff das linhas levemente mais perceptível"): `TINT` 0,10 → 0,14. Teto medido pelo teste de contraste: 0,16 passa, 0,18 falha; a asserção de `diff.test.ts` passou de `≤ 0.1` para `≤ 0.16`. ui-visual 89/0 depois da mudança.
- Tarefa 7: plan-reviewer devolveu `PLAN_REVIEW: complete` (reexecutou ui-visual: 89/0, 1 skip). Nada commitado.
- A conferir a olho pelo dono: tema após `/reload` (AC1); letras e ícones em janela nova do kitty (AC8).

## Lacunas do checklist
- [ ] Lacuna: ícones com a fonte nova e aparência do tema só são verificáveis a olho pelo dono (AC1, AC8) [Gap]
- [ ] Lacuna: contagem de cores de outros temas (Rosé Pine, Vesper etc.) e versões das outras fontes ficaram sem verificação na pesquisa; não afetam as decisões tomadas [Gap]
## Onda 9b: sinais do chat (2026-11-14, pedidos do dono após o plano)
Decisão delegada pelo dono ("decida o que é melhor e aplique a tudo"); prévias em `/tmp/variantes-ui.mjs` e `/tmp/fila-variantes.mjs`.
- Fila "Na fila": variante C (trilho `▎` accent, próximo item em `text`, demais `muted`, sem fundo). `extensions/up-dequeue/index.ts`.
- Subagente em segundo plano: variante B (linha `⇄ subagente` + primeira frase do relatório; ctrl+o abre o resto). Renderer de `subagent-background` em `extensions/hook-msgs/index.ts`.
- Pergunta (`question`): variante B (uma opção por linha, `●` escolhida, `○` demais). `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzz-question-view.patch`.
- Aviso pós-/reload: linha `✓ ⟳ recarregado …` no padrão da compactação; rótulo `compactar` → `compactado`. `claude-home/patches/pi-core/avisos/`.
- Tags `[DONE:n]`: exibidas como `✓ etapa n/total · título` (só exibição, via `registerMarkdownTransformer`). `claude-home/patches/pi-code/zzzzzzzzzzzzzzzz-plan-done-view.patch`.
- Custo: nenhum token a mais por turno (só renderização). Rollback: reverter cada patch (`patch -R`, `avisos/apply.mjs --revert`) e as edições das duas extensões.
- Evidência (árvore suja, HEAD f5a29a7): fila + hook-msgs 18/0; avisos 74/0; patches question/plan 51/0; ui-visual 89/0 (1 skip); pilha de patches pi-code reverte limpa; `bash -n bin/pi` ok.
- Aberto: `bin/pi` não reaplica o patch de avisos numa instalação já patchada com a versão anterior (aqui foi reaplicado à mão). Gate completo do repositório adiado para antes do commit.
- 2026-11-14, fundo do aviso (▲): era a média de `toolSuccessBg`/`toolErrorBg` + 4% do amarelo; com o sucesso neutro (D3) puxava para o vermelho. Passa a ser 20% da cor `warning` sobre `customMessageBg`, reescalado para o brilho desse fundo (`WARN_TINT`, `warnBgRgb(base, warn)` em `extensions/ui-visual/icons.ts`). pi-noite: `#2c2725`; pi-escuro: `#312c16`. Asserções alteradas: `icons.test.ts` (valor fixo `[43,40,27]` → "amarelado sobre o fundo neutro") e a chamada em `theme-contrast.test.ts`.
- 2026-11-14, aviso de memória (variante C, escolha do dono): `Memory: N memories loaded` → `◆ memória  N notas · contagem por tipo · /memory` (`claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzz-memory-notice.patch`, função `memoryNotice`; teste ao lado 4/4, vermelho 0/4 antes). Tipo vem do frontmatter `type`; nota sem tipo conta como "sem tipo". Custo: lê até 400 bytes de cada nota uma vez por sessão.
- 2026-11-14, aviso "[Extension issues] 'ctrl+o' is built-in shortcut for app.tree.filter.cycleForward": o transcript (claude-compat) usa Ctrl+O e o filtro da árvore do pi também. `CLAUDE_KEYBINDINGS` passa a mover `app.tree.filter.cycleForward` para `alt+shift+o` (`extensions/claude-compat/shortcuts.ts`, teste em `test/shortcuts.test.ts`); `~/.pi/agent/keybindings.json` atualizado (backup `.bak-tree-filter`).

### Hora da execução em todas as linhas (2026-11-14)
Pedido do dono: como a linha `recarregado`, toda tool e todo sinal mostra à direita a hora em que rodou.
- Tools (`extensions/ui-visual/tools.ts`): `HH:MM` do TÉRMINO em `dim` no fim da 1ª linha, alinhada à largura; enquanto roda não há hora (correção do dono, 2026-11-14: antes era a hora do início). Ao vivo vem de `tool_execution_end`; no histórico, do timestamp do resultado na sessão (lido uma vez por chamada). Vale para as 8 tools redesenhadas e para as demais (ícone). Abaixo de 30 colunas, ou sem 2 colunas de folga, a hora some.
- Hooks, gate de conclusão e subagente (`extensions/hook-msgs/index.ts`) e gate do plano (`extensions/plan-gate.ts`): `HH:MM` do timestamp da mensagem, antes de `ao parar`/`ctrl+o`.
- Já tinham: `recarregado`, `compactado`.
- Fora: mensagens do usuário e do assistente, blocos de erro/`interrompido` e aviso de memória (desenhados pelo core ou sem timestamp no gancho).
- Testes: ui-visual 92/0 (3 novos), hook-msgs 11/0 (1 novo), plan-gate (1 novo). Nenhuma asserção antiga alterada.

### Onda 9c: padrão de estado em tudo (2026-11-14)
Pedido do dono, após prévia (`/tmp/estado-variantes.mjs`, sugestões aprovadas com "execute as sugestões").
- **D3 superada**: sucesso volta a ter fundo verde e erro fundo vermelho no pi-noite: `toolSuccessBg` `#29302a`, `toolErrorBg` `#3b2934` (matiz do estado a 20% sobre `surface`, escurecido até `dim` manter 4,5:1). O edit continua com caixa neutra (`customMessageBg`): o verde fica para as linhas adicionadas.
- **Bolinha animada**: `pulseFrame`/`PULSE_MS` em `extensions/ui-visual/icons.ts`; um timer único em `tools.ts` redesenha as tools entre `tool_execution_start` e `_end`.
- **Estado nas demais tools** (`withIcon` em `tools.ts`): bolinha, ✓, ✕ ou ▲ antes do ícone, e hora à direita. O `subagent` pinta a própria caixa (`renderShell: 'self'`) pelo resultado: todos ok = verde, nenhum ok = vermelho, misto = aviso, rodando = pendente.
- **Aviso de subagente em segundo plano** (`extensions/hook-msgs/index.ts`): lote `Parallel: a/b succeeded` vira `paralelo · a de b concluídos [· n falhou]` com estado agregado; runs mistos passam de ✕ para ▲.
- **Hora separada do atalho**: a hora fica sozinha no canto do cabeçalho; o atalho (`ctrl+o abre`/`fecha`) vai para o canto da linha de prévia ou, sem prévia, cola no texto. Vale para hook, gate, subagente, gate do plano e `compactado`.
- **Etapas do plano** (`zzzzzzzzzzzzzzzzzzz-plan-done-block.patch`): `✓ etapa 6 de 8 · título`, barra de progresso na última linha do bloco, `→ a seguir: etapa 7 · título` ou `plano concluído`; sem plano conhecido, uma linha só (`✓ etapas 6, 7 e 8 concluídas`). Os títulos voltam após `/reload` a partir do último plano gravado na sessão (causa do "etapa 6 concluída" visto pelo dono).
- **Pergunta** (`zzzzzzzzzzzzzzzzzzzz-question-dialog.patch`): a chamada não desenha nada no chat (o diálogo já mostra a pergunta; antes aparecia duas vezes); o bloco entra com a resposta. Diálogo: `? título  escolha uma · 2 de 3`, pergunta e descrição da opção em foco quebram em linhas, as outras descrições ficam em uma linha apagada, `(Recomendado)` vira etiqueta.
- Asserções antigas alteradas (comportamento pedido mudou): `theme-contrast.test.ts` (sucesso = neutro → verde), `tools.test.ts` (ícone sem estado → com estado, 3 linhas), `hook-msgs/index.test.ts` (atalho no cabeçalho → na prévia, 5 linhas; run misto ✕ → ▲), `avisos-core/runtime.test.ts` (`hora · ctrl+o` → hora sozinha, 3 linhas), `question-view.test.ts` (chamada pendente desenhava a lista → vazia), `plan-done-view.test.ts` (`6/8 · título` → `6 de 8 · título` + barra, 4 linhas), `onda5/question.test.ts` (prelúdio que tira o patch posterior da cópia).
- Pesquisa de cores (acesso 2026-11-14, incompleta): Tokyo Night `night.lua` `bg = "#1a1b26"` (lido); mistura de ~25% para o diff é inferência por cálculo; Primer ~15% só em trecho de busca; WCAG 1.4.1 e 1.4.11 lidos (cor nunca é o único sinal: por isso ícone + fundo). Sem fonte para "fundo de status vs. diff".
- Testes: ui-visual 94/0 (1 skip), extensões + avisos + plan-gate 137/0, patches 33/0, contraste ok, pilha de patches reverte limpa (47 patches). Não visto na TUI real.
- Pendente de escolha do dono: tool `todo` em linha única (`/tmp/todo-variantes.mjs`).
- **`compactado` sem estado** (dono, 2026-11-14): não é resultado de execução (sempre "compactado"), então perdeu o ✓ e o fundo verde; fica `⟲ compactado …` em caixa neutra (`customMessageBg`). 3 asserções de `avisos-core/runtime.test.ts` alteradas.
- **`todo` em uma linha (variante B)** e **tool sem renderCall (`run`)** (dono, 2026-11-14), em `extensions/ui-visual/tools.ts`: `✓ ☰ todo  iniciada #1  texto … 1 de 7 feitas  HH:MM`, o resultado não repete (lista e erro seguem nativos); `run` e qualquer tool sem desenho próprio ganham `estado ícone nome  ação alvo · 300s` e a hora do término. Asserções alteradas em `tools.test.ts`: base sem renderCall voltava intacta → ganha a linha; o caso "só renderCall" passou a usar `memory` no lugar de `todo`.
- **`memory` sem estado** (dono, 2026-11-14): consulta, não execução com resultado; `SEM_ESTADO` em `tools.ts` tira o ícone de estado e o fundo (caixa própria sem cor), mantendo ícone, hora e corpo. Erro continua com ✕ e fundo vermelho. O caso genérico "só renderCall" do teste passou a usar `mcp__x`.
- **`run` variante B** (dono escolheu, 2026-11-14; prévia `/tmp/run-variantes.mjs`), em `extensions/ui-visual/tools.ts` (`runCorpo`): cabeçalho `run  aguardou 30s gw-lean`, linha de fatos `│ estado · duração · id · log ~/…`, saída recuada só quando existe (5 últimas linhas fechado, tudo com ctrl+o). Estado e fundo pelo run: rodando = execução, exit 0 = verde, exit ≠ 0 = vermelho, parado = aviso. Lê o texto de `pi-code run/tool.ts` (`line`/`summary`); se o formato mudar, cai no texto cru (list, stop e erro já saem assim). Asserção alterada: largura da linha do `run` 70 → 68 (caixa própria). Fora do escopo: a mensagem `run-finished` (aviso do await) segue com o desenho padrão.
- **`subagent` variante B** (dono escolheu, 2026-11-14; prévia `/tmp/subagente-variantes.mjs`), em `extensions/ui-visual/tools.ts` (`subAlvo`, `subCorpo`): cabeçalho `subagente  <agente | paralelo · N agentes | cadeia · N etapas>`, linha de fatos (estado em cor, segundo plano, id, turnos), tarefa (rodando) ou 1ª linha do resultado por agente, quem falhou primeiro; aberto mostra fatos + desenho nativo. Segundo plano fica "rodando" na caixa da chamada (o término chega pelo aviso). Sem duração: o resultado do pi-code não a traz. Asserções alteradas em `tools.test.ts`: cabeçalho `parallel` → `subagente`; o caso genérico de lastComponent passou a usar `mcp__x`.
- **Aviso `run-finished`** (dono, 2026-11-14), em `extensions/hook-msgs/index.ts`: saía cru (`[run-finished]` + texto); agora `estado ▶ run  terminou <nome>` + hora, linha de fatos (`exit 0 · 02:30 · id · log ~/…`) e saída recuada com colunas preservadas (5 últimas; ctrl+o mostra as 20 que o aviso traz). Estado pelo run: done verde, failed vermelho, stopped aviso.
- **Sem estado / cancelada** (dono, 2026-11-14): `recarregado` perdeu o ✓ e o fundo (linha sem caixa); `compactado` segue sem ✓ e com fundo neutro; pergunta cancelada ganhou fundo de aviso (`question` com caixa própria em `tools.ts`) e linha `▲ cancelada · sem resposta` (patch `question-dialog` regenerado). Asserções alteradas: `avisos-core/runtime.test.ts` (recarregado: ✓ e fundo verde → sem ambos, 3 linhas), `question-view.test.ts` (`cancelada` → `▲ cancelada · sem resposta`). Os avisos do core só mudam ao reabrir o pi (o /reload não recarrega o core).
- **Diálogo de pergunta: pesquisa e prévia** (acesso 2026-11-14; `perplexity-scout` + `web-scout`): verificado em fonte primária: Codex `request_user_input` numera as opções e a tecla numérica escolhe, recomendada primeiro com "(Recommended)", notas em Tab (github.com/openai/codex/pull/10025, /pull/9472); Inquirer `select` mostra a `description` só do item em foco, abaixo da lista (README do pacote); Gemini CLI mostra o `header` como chip (geminicli.com/docs/tools/ask-user); Claude Code `AskUserQuestion`: 2-4 opções com label + description, header ≤12, Other (code.claude.com/docs/en/agent-sdk/user-input); NN/g: sempre oferecer seleção padrão; WCAG 1.4.1. Não verificado: layout real das TUIs do Claude Code, Gemini e opencode; quando o clack mostra `hint`; huh. Prévia `/tmp/pergunta-variantes.mjs` (A numerada, B lista + painel, C cartões), aguardando escolha.
- **Diálogo de pergunta, variante B** (dono escolheu, 2026-11-14; prints `/tmp/pergunta-{A..E}.png`), no patch `zzzzzzzzzzzzzzzzzzzz-question-dialog.patch` (regenerado): lista numerada com rótulo + resumo (1ª frase da descrição) em coluna, `★ recomendada` à direita, painel `─── opção ───` com a descrição inteira só da opção em foco e altura fixa (a da maior descrição), tipo (`escolha uma`) à direita do cabeçalho, rodapé `1-N escolhe · ↑↓ move · ⏎ confirma · esc cancela`. Tecla 1-9: escolha única confirma na hora (em "Outra resposta" abre o texto); múltipla marca/desmarca. Sem descrições: sem resumo e sem painel. `optionLine` removida (sem uso). Testes do patch reescritos para o novo desenho (cabeçalho com posição `2 de 3` → tipo à direita; descrição sob cada opção → painel).
- **Ícones (dono, 2026-11-14)**: memória = cérebro `U+EE9C` (`icons.ts` `memory`, e `memoryGlyph(env)` no aviso de início, patch `memory-notice` regenerado; sem Nerd Font segue `◆`); pensando = lâmpada `U+F0336` (`think`). Asserções alteradas: `icons.test.ts` (`memory` `\ueaa5` → `\uee9c`, `think` `\u{f09d1}` → `\u{f0336}`); `memory-notice.test.ts` passa `env` vazio nos casos antigos.
- **`memory` com fundo neutro** (`customMessageBg`, como edit/compactado; antes sem fundo). Asserção alterada em `tools.test.ts` (sem `[customMessageBg]` → começa com ele).
- **Sessão já compactada**: `Session compacted N times` → `▲ compactada N vezes  cada compactação perde detalhe do contexto[ · /new recomeça limpo]` (≥3), `linhaCompactada`/`compactada` em `avisos/runtime.mjs` + âncora em `apply.mjs`; core reaplicado.
- **PLAN WAITING/BLOCKED/CANCELLED**: prévia `/tmp/plano-espera-variantes.mjs` (`/tmp/plano-espera.png`), aguardando escolha A/B/C.
- **Pergunta cancelada: ▲ ao lado do ícone** (dono, 2026-11-14): cabeçalho `▲ ? título  pergunta`, última linha `cancelada · sem resposta` sem ícone (`questionBlock`, patch `question-dialog` regenerado). Asserção alterada em `question-view.test.ts` (`▲ cancelada` → `cancelada` + cabeçalho começa com `▲`).
- **PLAN WAITING/BLOCKED/CANCELLED, variante B** (dono): patch novo `zzzzzzzzzzzzzzzzzzzzz-plan-espera.patch` (21 z; `plan-mode/done-view.ts` `HOLD`/`CANCELLED`/`hold()`, `index.ts` cores; original em `/tmp/pe-orig/plan-mode/`), em `publish.list` + symlink; teste em `plan-done-view.test.ts`. Só exibição, via o mesmo `registerMarkdownTransformer`; por isso sem fundo de caixa, sem pulso e sem hora (limite do markdown). Pilha de 48 patches reverte limpa.
- **Ícone da pergunta**: prévia `/tmp/pergunta-icone.png` (A círculo `U+EB32`, B balão `U+F0E5`, C balão com reticências `U+F27B`), aguardando escolha.
- **Ícone da pergunta = dois balões `U+EAC7`** (dono escolheu pela folha `/tmp/icones-q.png`): `icons.ts` `question` e `questionGlyph(env)` em `question.ts` (bloco do chat e cabeçalho do diálogo; sem Nerd Font `?`). Asserção alterada: `icons.test.ts` `\ueb32` → `\ueac7`; testes de question fixam `PI_ASCII_ICONS=1`.
- **Bloco da pergunta no chat, variante A** (dono escolheu; prévia `/tmp/pergunta-bloco.png`): cabeçalho `✓|▲ ícone título  resposta` + hora do término (hora em `tools.ts`), pergunta embaixo com `│` e ` · ctrl+o abre`; opções (`●`/`○`) só ao abrir; "Outra resposta" não usada some; tempo esgotado sem resposta = aviso (`tempo esgotado · seguiu sem resposta`, substitui o texto em inglês). `questionBlock(v, theme, expanded, hint)` em `question.ts` (patch `question-dialog` regenerado). Testes de `question-view.test.ts` do bloco reescritos para o novo desenho (lista sempre visível → resposta no cabeçalho); `tools.test.ts` ganhou hora e tempo esgotado.
- **Subagente em segundo plano = "enviado" (variante A, dono)**: `subCorpo` marca `uiNeutro`; caixa com `customMessageBg`, sem glifo de estado, fatos `enviado para segundo plano · bg-… · o resultado chega em aviso próprio`. Supera "segundo plano fica rodando". Asserções alteradas em `tools.test.ts` (3 linhas do caso de segundo plano).
- **`memory`: corpo recuado com `│`** (alinhado ao cabeçalho; linhas vazias iniciais removidas). Asserção alterada em `tools.test.ts`.
- **Fundo neutro em `recarregado` e no aviso de memória do início** (dono): `recarregado` passa `customMessageBg` ao `Text`; aviso de memória sai do pi-code com `U+2063` na frente (`memory.ts`, patch `memory-notice` regenerado) e o core desenha a caixa (`caixaNeutra` em `avisos/runtime.mjs`, âncora `showExtensionNotify` em `apply.mjs`; core reaplicado). Asserção alterada em `avisos-core/runtime.test.ts` (recarregado: sem fundo → `customMessageBg`).
- **Rótulo do raciocínio recolhido**: `raciocinando…` → `raciocínio · clique abre` (`working.ts`; o rótulo fica no histórico de um bloco já terminado). Asserção alterada em `working.test.ts`.
- **Setinha `❯` nas mensagens do usuário** (dono, 2026-11-14): `marcaUsuario` em `icons.ts`, registrada em `ui-visual/index.ts` com `registerMarkdownTransformer(..., { messageTypes: ["user"] })`. Só exibição; mensagem que começa com bloco Markdown leva a marca em linha própria. Linhas seguintes não ganham recuo (limite do transformador; recuo exigiria patch no core).
- **Hora na pergunta (correção)**: o `Text` do pi preenche a linha até a largura e a hora nunca cabia; `tools.ts` tira o preenchimento antes de alinhar. Teste ajustado para linha preenchida.
- **Hora no aviso de memória** (`caixaNeutra`: hora sozinha à direita).
- **Hora nas mensagens do usuário**: `marcaUsuario(md, fg, env, hora, w)`; timestamp da sessão ou, ao vivo, o do primeiro desenho (`index.ts`, mapa `vistas`, teto 200). Não cabe na 1ª linha → linha própria no fim.
- **`❯` na caixa de entrada** (`extensions/ui/editor.ts`): respiro esquerdo sobe para 3 colunas e a 1ª linha visível leva `❯`; `EditorUi.accent`. Falha pré-existente: `ui/test/vim/editor-vim.test.ts` não copia `claude-compat/permissions/slot.ts`.
- **Plano em espera com fundo neutro, variante A** (dono; prévia `/tmp/plano-espera2.png`): patch `plan-espera` (21 z) regenerado, 150 linhas. `renderDoneTags(..., streaming, width)`; `DonePaint.bold/box`; caixa `customMessageBg` desenhada pelo próprio transformador (o Markdown do pi preserva espaços e SGR, cada linha sai na largura útil; sem patch no core). `◷` no lugar de `●`, título em negrito, `etapa N de T` + barra à direita (cai a barra, depois a etapa, se faltar espaço), motivo quebrado por palavra e literal (trecho de código: o Markdown do pi interpreta também `$…$` e `\[…\]`, o que encurtaria a linha), ação `retoma sozinho, nada a fazer`. Cancelado na mesma caixa. Sem largura/fundo: mesmas linhas sem caixa.
  - Asserções alteradas em `plan-done-view.test.ts` ("espera: …"): `●` → `◷`, título em negrito, texto da ação (`o resultado chega sozinho` → `retoma sozinho`), `precisa de você` em warn; stubs de tema ganharam `bg`/`bold`. Motivo: variante A substitui a B.
  - Limites: sem hora e sem pulso (transformador não tem estado nem timestamp ao vivo); largura conta 1 coluna por caractere (CJK/emoji desalinham).
  - Rollback: regenerar o patch a partir da versão anterior no git ou `patch -R`.
- **Título da pergunta fixo** (dono, 2026-11-14: "pq o nome é Forma?"): bloco do chat e diálogo mostram `pergunta` em negrito e a etiqueta do modelo (`header`) depois, apagada (`pergunta · Forma`). Patch `question-dialog` regenerado. Asserções alteradas: `question-view.test.ts` (5× `*Tipos*` → `*pergunta*` + `· Tipos`) e `question-dialog.test.ts` (3× `Abordagem` → `pergunta · Abordagem`); motivo: a etiqueta sozinha parecia um nome solto.
- **Avisos de hook/gate: atalho sob a hora + clique abre e fecha** (dono, 2026-11-14; print do `gate`): em `extensions/hook-msgs/index.ts` o atalho saiu da cabeça e vai sozinho para a linha de baixo, no canto direito (blocos sem prévia; com prévia já ficava no canto da última linha). `render` virou invólucro de `montar` com `handleMouse`: clique esquerdo inverte só aquele bloco (remonta com `expanded` invertido); bloco sem detalhe não consome o clique. `extensions/plan-gate.ts`: `handleMouse` no componente. Tools, pergunta, skill, compactação e raciocínio já abriam por clique no core. Clique só existe no modo de tela cheia do pi (o padrão).
  - Asserções alteradas em `hook-msgs/index.test.ts`: bloco fechado de hook e gate 3 → 4 linhas e cabeça sem `· ctrl+o abre`; subagente aberto (`l[2]` passa a ser o atalho, id em `l[3]`); relatório vazio 3 → 4 linhas. Motivo: o atalho mudou de lugar.
  - Custo: blocos sem prévia ficam uma linha mais altos. Rollback: `git checkout extensions/hook-msgs extensions/plan-gate.ts` (leva junto as mudanças anteriores não commitadas desses arquivos; preferir reverter o trecho).
- **Pergunta: fundo na opção recomendada, variante A** (dono; prévia `/tmp/rec.png`): no diálogo, a linha da recomendada leva `toolSuccessBg` na largura inteira, com ou sem foco (`question.ts`, patch `question-dialog` regenerado); tema sem `bg` ou pergunta sem recomendada: nada muda. Teste novo em `question-dialog.test.ts`; nenhuma asserção antiga alterada.
- **Prompt fixo com setinha dobrada e hora cortada** (bug causado pela setinha/hora nas mensagens do usuário, visto no print do dono): `extensions/sticky-prompt/sticky.ts` `stickyLine` tira a setinha e a hora finais do texto antes de desenhar. Teste novo em `sticky.test.ts`.
- **Bloco de espera sem plano não fala em "plano"** (dono, 2026-11-14: a sessão principal só esperava dois subagentes, um deles o agente `Plan`, e o bloco dizia "plano em espera"): `renderDoneTags(..., width, owned)`; `owned` = há etapa pendente na sessão principal (ou, vindo de `index.ts`, `planModeEnabled || executionMode || todoItems.length > 0`). Sem plano: `◷ em espera` / `▲ bloqueado` / `■ cancelado`, sem `◈` e sem etapa. Patch `plan-espera` regenerado. Asserção alterada em `plan-done-view.test.ts`: caso `steps` indefinido passou de `plano em espera` para `em espera`; motivo: o plano não pertence à sessão principal. Plano de subagente nunca aparece ali (o transformador lê só as etapas da sessão principal).
- **`▲ compactada N vezes`: descrição na linha de baixo** com `│` (dono: "separar aviso da descrição"); 3 asserções de `linhaCompactada` alteradas em `avisos-core/runtime.test.ts`; core reaplicado.
- **Aviso de hook/gate fechado: texto centrado na altura** (dono: "centralizar ao centro"): com hora e atalho e sem prévia, o bloco tem 3 linhas (hora, texto, atalho) sem respiro extra; aberto ou sem hora segue como antes. Asserções do teste "gate: atalho sob a hora" alteradas (4 → 3 linhas, hora na linha 0). Interpretação do assistente: centrar na vertical.
- **Cursor fino piscando** (dono, 2026-11-14): `"showHardwareCursor": true` em `~/.pi/agent/settings.json`; o pi passa a usar o cursor do terminal (kitty já tem `cursor_shape beam` e pisca a 0,5 s) em vez do bloco desenhado. Rollback: remover a chave.
- **Título · tarefa nas tools** (dono, 2026-11-14): `bash · cd /tmp` (bolinha em `dim`) em `tools.ts` (`SEP`; `VERB_WIDTH` removido: o alvo deixa de ficar em coluna fixa). Vale para as tools nativas, a linha genérica, `todo`, `run` e `subagente`. Asserções alteradas em `tools.test.ts`: 36 linhas com `verbo␣␣alvo` → `verbo · alvo`. Pré-existente: `tools.test.ts` tem 812 linhas (limite 800).
- **Espera do limite de uso travava esc, ctrl+c e enviar-agora** (bug visto pelo dono): em `agent_before_settle` o run já terminou, `ctx.signal` é `undefined` e `session.abort()` só marca uma flag e fica esperando. `extensions/auto-resume/index.ts` `cancelavel(ctx)`: sinal próprio acordado por `ctx.signal`, esc/ctrl+c (`onTerminalInput`), mensagem na fila (`hasPendingMessages`, a cada 250 ms) e `globalThis.__piAutoResumeCancel`, chamado pelo enviar-agora (`patches/pi-core/send-now/runtime.mjs`, core reaplicado). Testes novos (vermelho visto) em `auto-resume/index.test.ts` e `interactive-input/send-now-runtime.test.ts`. Não reproduzido numa espera real.
- **"Modelos travados nesta sessão" em caixa de aviso** (dono): marca dupla `U+2063 U+2063` no notify (`extensions/travar-modelos/index.ts`) → `caixaNeutra` desenha `▲ título`, corpo sob `│`, hora, fundo de aviso (`fundoAviso`, mesma conta de `warnBgRgb`, duplicada porque o core não importa a extensão). Asserção alterada em `travar-modelos/test/index.test.ts` (prefixo da marca).
- **Hora da mensagem do usuário sempre em cima** (dono, 2026-11-14): texto que não cabe na 1ª linha é quebrado (na palavra) antes da hora, em vez de a hora ir para uma linha no fim (`marcaUsuario`). Asserção alterada em `icons.test.ts` (caso dos 26 `x`).
- **Plan: rodapé, sem coluna de agente, hora do término** (dono, 2026-11-14; patch `zzzzzzzzzzzzzzzzzzzzzzz-plan-footer.patch`, 23 z, `plan-mode/{section,table}.ts`; original em `/tmp/pf-orig/plan-mode/`):
  tempo total, gasto, `n/m na tela`, aviso e teclas saíram da barra das abas e viraram a última linha da seção (sempre presente, então focar não desloca o chat; a barra fica só com as abas e as marcas `bloqueado/falhou/pulado/concluído`);
  coluna `agente` removida em qualquer largura; coluna `tempo` virou `fim`: hora do relógio em que a etapa terminou + duração (`17:42 · 02:14`; degrau curto só a hora; `--:--` quando a etapa já estava feita ao ser vista).
  A seção ficou 1 linha mais alta. Asserções alteradas (contrato antigo → novo) em `claude-home/bin/tests/interactive-display/`: `plan-table.test.ts` (`finalizado 02:14` → `HH:MM · 02:14`; escada sem `agente`; `code-reviewer` fora da linha; teclas/tempo/gasto/erro de `lines()[1]` → última linha), `plan-section.test.ts` (barra sem detalhe; +1 linha em 4 contagens; teclas no rodapé com a largura inteira), `native-frame.test.ts` e `native-panels.test.ts` (detalhe lido do rodapé). `native-*` (tmux) verdes na rodada conjunta (50 passam; 2 falhas: uma largura errada no teste novo, corrigida, e a pré-existente a seguir); `todos from the todo tool…` já falhava com os arquivos originais.
  Rollback: `patch -d <extensions> -p1 -R < <patch>` e remover a linha do `publish.list`.
- **`tools.test.ts` dividido** (limite de 800 linhas e de 7 arquivos por diretório): `extensions/ui-visual/test/tools/{base.ts,tools.test.ts,estado.test.ts}`; nenhum teste removido nem alterado (103 passam antes e depois). Rodar: `node --experimental-strip-types --test test/*.test.ts test/tools/*.test.ts`.
- **Patches pi-code que só existiam na instalação, trazidos para o repo** (2026-11-14, pré-commit): 12 patches (`subagent-routing`, `plan-no-step-status`, `plan-window-count`, `plan-source-reset`, `run-section`, `hide-finished`, `group-navigation`, `group-tabs`, `plan-cache-keep`, `tab-thinking-color`, `run-title-spinner`, `tab-shared-nav`) e 8 testes eram arquivos soltos em `~/.pi/agent/claude-home/patches/pi-code/`; os patches desta onda foram gerados sobre eles, então sem eles a pilha do repo não aplica numa instalação limpa. Movidos para `claude-home/patches/pi-code/` (testes soltos em `<patch>/`), symlink no lugar, 20 linhas no `publish.list`. `plan-source-reset.test.ts`: o ajudante `title()` passou a juntar a linha das abas com o rodapé (contrato do plan-footer); asserções intactas.
- **Pergunta alinhada como os demais blocos** (dono, 2026-11-14, print `b4b98ee1`): `perguntaLinhas` em `ui-visual/tools.ts` pega as linhas lógicas do bloco do pi-code e redesenha o corpo recuado sob o verbo atrás do `│` (também nas linhas quebradas), com o atalho à direita da 1ª linha do texto, abaixo da hora (antes: `│` na coluna 0, quebra sem trilho, atalho colado ao texto). Sem patch no pi-code. Teste novo em `test/tools/estado.test.ts`.
- **Preparação da entrega (2026-11-14)**: `publish.list` ganhou os arquivos do repo que faltavam na allowlist (patches/testes `onda5-*`, `ui-visual/diff.ts` e testes, `editor-vim.test.ts`, `arg-expansion-check.test.mjs`, `test_supervisor.sh`) e o patch de core `retomada` (+ teste), que só existia na instalação e era chamado por `bin/pi`. `scripts/refs-allow.txt`: teto documentado 15 → 22, com 4 caminhos de runtime (`keybindings.json`, seu backup, `diag/`, `subagent-routing.json`) e 3 nomes de fixture da galeria (`demo-skill`, `demo`, `projeto-agente`); `check-refs` 33 → 0. Testes de outras frentes consertados sem afrouxar asserção: `display.test.ts` (2 contratos antigos → `onda5-viewer`/`group-tabs`), `plan-table.test.ts` (mock executa todos os handlers de `session_start`), `subagent-render/render.test.ts` (limpa `NO_COLOR`), os dois `replay.test.ts` (retiram o bloco `permission-control` como o `bin/pi`), `async-default-routing.test.ts` e 3 testes do `claude-compat` (cópia com o pi ao lado).
