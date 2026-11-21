# Onda 5 · plan / todo / fleet / goal (E01–E20)

**Status (2026-11-14): aplicado em parte, sem commit.** O dono aprovou "executar menos o 1, 2 e 3".
Aplicados: itens 4, 5, 6, 7, 8a, 8b, 8c da tabela "O que decidir" de `proposta.html`.
Não aplicados por decisão do dono: 1 (painéis abaixo do composer), 2 (tarefas), 3 (modo plano).
Fora do escopo desde a proposta: E16 (árvore) e E17 (bloco `[compaction]`), que exigem patch no core do pi.

Arquivos: `proposta.html` (antes real / depois mock), `execucao.md` (contrato das unidades),
`check.mjs` (capturas reais), `real-*.png` (evidência), `previa-*.png` (proposta).

## Regra da execução

Só muda o que aparece na tela. Texto enviado ao modelo (resultado de tool, `sendMessage`, prompts do
avaliador, `PLAN_REVIEW`, `LIMIT_MARK`), teclas, fluxo e decisões ficam idênticos. Onde o rótulo era
também valor de lógica, foram separados (`RESTORE_CHOICES` no `/rewind`).

## O que mudou

| Item | Onde | Antes | Depois | Evidência |
|---|---|---|---|---|
| 4 Objetivo | patch `zzzzzzzzzzzzzz-onda5-goal` (`goal.ts`, `internal/goal-ui.ts`) | `◎ /goal active (5m)`, `◎ Goal set:`, `✓ Goal achieved`, painel em inglês | `◎ objetivo · 3 turnos · 5m`, `◎ Objetivo definido`, `○ … ainda não atingido · continuando`, `✓ Objetivo atingido`, `✗ … não pôde ser atingido`, painel em português | `real-objetivo.png`, `real-objetivo-painel.png` |
| 5 Detalhe do agente | patch `…-onda5-viewer` (`fleet-ui/viewer.ts`, `runtime-label.ts`) | cabeçalho de 5 linhas, `Model:`/`Effort:` `(observed)`, `> `, dicas em inglês | 2 linhas (`main › agente` · `● rodando · tempo · tok · custo` / `modelo · esforço · ao lado: …`), `❯ Mensagem para este agente`, dicas condicionais, `▲ x de novo para parar …`; corpo ganhou 3 linhas | `real-agente.png`, `real-agente-parar.png` |
| 6 Pergunta | patch `…-onda5-question` (`question.ts`) | `[Header]`, `> 1. opção`, `Type something.`, `Your answer:` | header em negrito + `escolha uma` / `escolha um ou mais`, `❯`, `Outra resposta…`, `Sua resposta:`, dicas `↑↓ escolher · ⏎ confirma · esc cancela` | `real-pergunta-unica.png`, `real-pergunta-multi.png` |
| 7 Voltar no tempo | patch `…-onda5-rewind` (`git-checkpoint.ts`) | `Rewind to checkpoint:`, `1:26:12 AM`, `Restore mode:` sem consequência, `Rewind complete` | `Voltar para:`, `06:31 · há 4 min`, cada modo diz o que faz, `✓ Voltou para “…” · código e conversa`, avisos em português | `real-rewind-pontos.png`, `real-rewind-modos.png`, `real-rewind-resultado.png` |
| 8a Gate do plano | `extensions/plan-gate.ts` | parágrafo em inglês repetido a cada bloqueio | uma linha `▲ Plano  falta a revisão final (plan-reviewer) · o agente foi avisado · 2ª vez · ctrl+o`; expandido mostra o texto original | `real-plan-gate.png` |
| 8b Nova tentativa | `extensions/auto-resume/index.ts` | `auto-resume 1/5 in 30s` | `↻ nova tentativa em 30s · 1 de 5 · esc cancela` | `real-auto-resume.png` |
| 8c Hooks | patch `…-onda5-hooks` (`hooks/index.ts`) | tudo `Warning: <texto>` | `◇ hook <Evento> · …` (info), `▲ Hook … bloqueou · …` (warning), `✗ Hook … falhou · …` (error) | `real-hook.png` |

## Desvios da proposta (vale o código)

- Item 4: sem painel novo abaixo do composer (o mock usava o desenho do item 1, não aprovado). O resumo
  vai no status; ele só atualiza a cada 60 s (`INDICATOR_REFRESH_MS`, já era assim), então logo após
  `/goal` aparece só `◎ objetivo`.
- Item 5: Esc fecha o viewer, não desarma o `x`; a dica diz `esc fecha`. Não existe estado "na fila".
- Item 6: sem `1 de 2` (cada pergunta abre o próprio diálogo; mostrar progresso mudaria o fluxo) e sem
  fundo de seleção. A numeração saiu porque as teclas numéricas não fazem nada.
- Item 7: "Código e conversa" diz "restaura os arquivos editados e volta a conversa a este ponto": o
  código não apaga mensagens (move a folha da árvore) e só restaura arquivos que a sessão editou.
- Item 8a: o gate não notifica aprovação; nenhum aviso `✓` foi criado.
- Item 8b: a contagem ficou na linha de status, não na régua do composer (exigiria editar
  `extensions/ui/editor.ts`).
- Item 8c: bloqueio de `UserPromptSubmit` passou de `error` para `warning`.

## Ainda em inglês (fora dos arquivos aprovados)

- Prefixo `Warning:` / `Error:` dos avisos e a dica `↑↓ navigate enter select escape/ctrl+c cancel` do
  seletor (`→` em vez de `❯`): vêm do core do pi.
- Linha da tool `question` no transcript (`Options: … Type something.`): deriva do resultado enviado ao modelo.
- `goal-evaluator.ts` (motivos como `unreadable verdict`, `/goal` fora do TUI), `fleet-ui/index.ts:177`
  (`No subagent runs in this session.`), mensagens de parar do `panel.ts`, `Auto-continuing in Ns…` da pergunta.

## Verificação (2026-11-14, pacote vivo pi-code 1.7.0 com a pilha de 37 patches)

`node --experimental-strip-types --test <arquivo>`:

| Suíte | Resultado |
|---|---|
| `patches/pi-code/zzzzzzzzzzzzzz-onda5/{goal,viewer,question,rewind,hooks}.test.ts` | 6, 8, 6, 7, 4 passam |
| `goal.test.ts`, `goal-lifecycle.test.ts` | 15, 7 |
| `rewind-tree.test.ts` | 38 |
| `subagent-panel/*.test.ts` | 10, 12, 20, 29, 11, 32 |
| `zzzzzzz-subagent-model-effort/*.test.ts`, `zzzzzz-subagent-send/send.test.ts` | 13, 4, 11, 20 |
| `bin/tests/plan-gate.test.ts`, `extensions/auto-resume/index.test.ts` | 18, 16 |

Zero falhas, zero skips. A pilha inteira reverte limpa em ordem inversa numa cópia (critério do `bin/pi`).
`structure.py`: `extensions` e `extensions/auto-resume` sem achados; `patches/pi-code` continua com 8
arquivos de código na raiz (já era 8). Revisão independente (`code-reviewer`): não bloqueia; o único
achado (aviso de desistência do gate dizendo "0 avisos sem avanço" ao bater o teto de 30) foi corrigido
com teste vermelho → verde.

Contratos de teste levados ao texto novo, sem afrouxar: `goal.test.ts`, `goal-lifecycle.test.ts`,
`rewind-tree.test.ts` (agora escolhe o modo por `RESTORE_CHOICES` e reverte a pilha do arquivo até o
original), `subagent-panel/fleet-ui.test.ts`, `fleet-entry.test.ts`, `model-effort/render.test.ts`.

Não verificado: `NO_COLOR`, terminal estreito e outros temas no TUI real (só nos testes de largura);
suíte completa do repositório e CI; contraste do token `dim` (4,1:1, ajuste proposto não aplicado).

## Riscos residuais

- `fleet-entry.test.ts` falhou 8 de 10 uma vez, com seis lanes rodando em paralelo, e passou 10/10 em
  três execuções seguintes (com e sem o patch): instável sob carga, causa não investigada.
- Com modelo de nome muito longo, o esforço some da linha 2 do viewer (corte pela direita).
- `hooks/index.ts` tem 961 linhas (era 949, já acima de 800; é arquivo do pi-code).
- Falhas de hook são reconhecidas pelo prefixo do texto gerado em `decisions.ts`; se ele mudar, saem como info.
- Outra sessão está mexendo na mesma pilha; os patches novos só aplicam enquanto o pi-code for 1.7.0.
- A pasta instalada (`~/.pi/agent/claude-home/patches/pi-code`) recebeu links para os 5 patches e para
  `zzzzzzzzzzzzzz-onda5/`; ela e o repositório já divergiam antes em outros patches.

## Custo e qualidade (harness-economy)

Custo: 5 patches a mais para manter a cada versão do pi-code; nenhum token a mais por turno (nada do
que vai ao modelo mudou). Qualidade ganha: uma língua só, estado com glifo + palavra, três níveis de
aviso distinguíveis sem cor, bloqueio do gate em 1 linha em vez de ~6 por ocorrência.

## Rollback

1. `patch -d ~/.pi/agent/npm/node_modules/pi-code/extensions -p1 -R < <cada onda5 .patch>` (ou restaurar
   `/tmp/onda5-backup/extensions-antes-0629`, temporário).
2. Apagar `zzzzzzzzzzzzzz-onda5-*.patch` e `zzzzzzzzzzzzzz-onda5/` do repositório e os links da pasta instalada.
3. `git checkout -- extensions/plan-gate.ts extensions/auto-resume/` e os testes listados acima
   (atenção: `fleet-ui.test.ts` também tem mudanças de outra sessão).
