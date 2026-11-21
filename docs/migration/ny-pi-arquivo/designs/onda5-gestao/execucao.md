# Onda 5 · execução (itens 4, 5, 6, 7, 8a, 8b, 8c)

Decisão do dono (2026-11-14): “executar menos o 1, 2 e 3”. Ficam **fora**: painéis abaixo do composer (item 1), tarefas (item 2), modo plano (item 3). Especificação visual: `proposta.html` nesta pasta (seções `#objetivo`, `#agente`, `#pergunta`, `#rewind`, `#avisos`); os mocks são o alvo de texto e hierarquia.

Sem commit, push ou PR: não foram pedidos.

## Regras comuns a todas as unidades (valem como restrição)
1. **Só muda o que o usuário vê na tela.** Texto enviado ao modelo (resultado de tool, `sendMessage` com conteúdo para o LLM, prompts do avaliador, marcadores como `PLAN_REVIEW`, `LIMIT_MARK`), teclas, fluxo, valores de retorno e comparações de lógica ficam idênticos. Se um rótulo exibido também é usado como valor de lógica, separe rótulo de valor (mapa rótulo → valor) em vez de trocar o valor.
2. **Gramática** (igual à Onda 2, `../onda2-editor/README.md`): português; `❯` marca a linha ativa; dicas em `dim` separadas por ` · `, sempre na última linha, no formato `↑↓ escolher · ⏎ confirma · esc cancela`; estado = glifo + palavra (`✓` feito, `○` pendente, `●` rodando, `◎` objetivo, `▲` pede atenção, `✗` erro, `◇` informação); nada depende só de cor. Use os tokens de tema que o arquivo já usa (`accent`, `dim`, `muted`, `warning`, `error`, `success`); nenhuma cor nova.
3. **Texto fiel ao código.** Onde o mock descreve uma consequência (ex.: o que cada modo de `/rewind` desfaz), confirme no código o que acontece de fato e escreva isso; se o mock estiver errado, vale o código e o desvio vai no handback.
4. **Itens 1–3 não aprovados**: não mexer em `subagent/fleet-ui/panel.ts`, `chrome.ts`, `palette.ts`, `plan-mode/*`, `todo.ts`, `run/*`, `status-line.ts`.
5. Proibido: commit, push, `git checkout`/`reset`/`stash`, editar arquivo fora da lista “arquivos da unidade”, editar `~/.pi/agent/npm/node_modules` no lugar (o checkout tem ~70 mudanças de outras sessões em andamento; não tocar nelas).
6. Durante o trabalho só checagens que não compilam e terminam em segundos. O teste novo da própria unidade pode rodar (é a reprodução mínima dela). A verificação completa roda uma vez no fim, pelo orquestrador.
7. Arquivo de código ≤ 800 linhas. Sem dependência nova. Sem abstração além do necessário.

## Como fazer um patch do pi-code (unidades A–E)
- Pacote vivo, já com a pilha atual aplicada: `~/.pi/agent/npm/node_modules/pi-code/extensions` (pi-code 1.7.0). **Não editar no lugar.**
- `cp -r` desse diretório para `/tmp/onda5-<unidade>/a` e `/tmp/onda5-<unidade>/b`; editar só em `b`; gerar com `cd /tmp/onda5-<unidade> && diff -u a/<arquivo> b/<arquivo>` para cada arquivo da unidade, concatenados, com cabeçalhos `--- a/<arquivo>` / `+++ b/<arquivo>` (o wrapper aplica com `patch -d <extensions> -p1`).
- Gravar em `claude-home/patches/pi-code/<nome>.patch` (nome exato dado na unidade; os 14 `z` garantem que entra por último na pilha) e o teste ao lado, `<nome>.test.ts`.
- Teste: copiar o padrão de `claude-home/bin/tests/avisos-core/notify-owner.test.ts` (copia o pacote para um tmp, aplica o patch se ainda não estiver aplicado, importa o módulo da cópia). Rodar: `node --experimental-strip-types --test <arquivo>`. O teste afirma os textos novos, que o valor de lógica não mudou e pelo menos um caso de falha/vazio.
- Conferir: `patch -d <cópia limpa de a> -p1 -N --dry-run < patch` aplica sem rejeição.
- Testes existentes que fixam o texto antigo do mesmo arquivo (ex.: `goal.test.ts`) são atualizados para o contrato novo, sem afrouxar o resto; liste antigo → novo no handback.

## Unidades
| id | item | arquivos da unidade | status |
|---|---|---|---|
| A | 4 Objetivo | patch `zzzzzzzzzzzzzz-onda5-goal` (`goal.ts`, `internal/goal-ui.ts`) + teste; `goal.test.ts`, `goal-lifecycle.test.ts` só se fixarem texto antigo | pendente |
| B | 5 Detalhe do agente | patch `zzzzzzzzzzzzzz-onda5-viewer` (`subagent/fleet-ui/viewer.ts`, `runtime-label.ts`) + teste | pendente |
| C | 6 Pergunta | patch `zzzzzzzzzzzzzz-onda5-question` (`question.ts`) + teste | pendente |
| D | 7 Voltar no tempo | patch `zzzzzzzzzzzzzz-onda5-rewind` (`git-checkpoint.ts`) + teste | pendente |
| E | 8c Hooks | patch `zzzzzzzzzzzzzz-onda5-hooks` (`hooks/index.ts`) + teste | pendente |
| F | 8a Gate do plano, 8b Nova tentativa | `extensions/plan-gate.ts`, `claude-home/bin/tests/plan-gate.test.ts`, `extensions/auto-resume/index.ts` e o teste dele | pendente |

Depois: copiar os patches para `~/.pi/agent/claude-home/patches/pi-code/` (o que o wrapper aplica), gate único, revisão, capturas reais.

## Desvios da proposta decididos antes de executar
- **Item 4**: o mock mostra o objetivo como painel abaixo do composer, no desenho do item 1, que não foi aprovado. Para não criar um painel num estilo diferente dos que ficam, o objetivo **não** vira painel novo: o indicador do status passa a levar o resumo (`◎ objetivo · 3 turnos · 4m 12s`) e o painel do `/goal` e as mensagens do transcript vão para português.
- **Item 8b**: a contagem vai para a régua do composer só se o mecanismo do indicador “escrevendo” (`extensions/ui-visual/working.ts`) puder ser usado com o agente parado sem tocar em `extensions/ui/editor.ts`; senão fica no status, em português.
