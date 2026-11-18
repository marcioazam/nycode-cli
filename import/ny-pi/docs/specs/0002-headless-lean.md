# 0002: sessão sem interface (`pi -p`, modo JSON)

Estado: implementado (2026-11-14); medição do S4 depois da correção ainda por repetir no baseline oficial.

## Problema medido

Benchmark S4 com `pi -p` (Sonnet 5.5): 14 de 24 acertos e US$ 0,092 por execução, contra 24 de 24 e US$ 0,030 do pi
sem o harness. Causas:

1. `plan_mode_complete` ficava ativa fora do modo plano, devolvia `Not in plan mode; tool ignored.` e o modelo
   parava à espera de aprovação (6 de 16 execuções).
2. `question` devolvia `Error: UI not available` e a resposta final saía sem pergunta (4 de 8).
3. A seção `<cwd>` ficava dentro do único bloco de sistema com `cache_control`, então cerca de 21,7 mil tokens eram
   regravados no cache a cada sessão em outro diretório.
4. Uma chamada extra para o título da sessão em toda execução.

## Comportamento

Sem interface quer dizer `ctx.hasUI` falso: modo print (`-p`, `--print`) e modo JSON. TUI e RPC não mudam, salvo o
item 3 e a rede do item 1, que valem para toda sessão.

| # | Regra | Onde |
|---|---|---|
| 1 | Sem interface e fora do modo plano, `plan_mode_complete` não fica ativa. `--plan` ou um prompt que começa com `/plan` a mantêm. | `extensions/headless-lean`, `session_start` |
| 1 | Rede, todo modo: o resultado `Not in plan mode; tool ignored.` chega ao modelo como "não há aprovação a esperar, execute o plano agora no mesmo turno". | `tool_result` |
| 2 | Sem interface, `question` não fica ativa. Rede: o erro de UI vira "escreva as perguntas, cada uma terminada em `?`, na resposta final e encerre o turno sem alterar arquivos". | `session_start`, `tool_result` |
| 3 | Pedido Anthropic: a seção `<cwd>` sai do bloco de sistema em cache e vai para um bloco final sem `cache_control`. O bloco em cache fica byte-idêntico entre diretórios; nenhum ponto de cache é criado e os demais blocos mantêm a ordem. Payload em outro formato segue intacto (`PI_HEADLESS_LEAN_DEBUG=1` escreve o motivo no stderr). | `before_provider_request` |
| 4 | Sem interface, o título de sessão não é gerado (`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`, salvo valor já definido). | `session_start` |
| 5 | Contrato: fora do modo plano, "planeje antes" é plano curto e implementação no mesmo turno, salvo pedido contraditório ou com escolha em aberto; sem interface, as perguntas vão na resposta final. | `claude-home/CLAUDE.md`, Delivery |

### Bloco `<headless>` (2026-11-15)

Sem UI, `before_agent_start` acrescenta ao prompt de sistema o bloco `HEADLESS_PROMPT` (cerca de 130 tokens, texto
fixo, no prefixo em cache). Com UI nada muda. O bloco tem três regras, nesta ordem:

1. Decidir primeiro se o pedido está claro; contradição ou escolha em aberto termina em perguntas, sem alterar arquivo.
2. Fora disso, nunca pedir permissão para começar: um pedido de plano é plano mais execução no mesmo turno.
3. Antes da resposta final, conferir o resultado contra o pedido linha a linha, executando uma asserção por regra e
   por exemplo, e uma entrada logo fora de cada lista de formas aceitas.

Medição (Sonnet, 8 repetições por tarefa, contra a referência k12 de `faf2268`):

| Tarefa | Referência | Regra 2 antes da 1 | Regras 1 e 2 | Regras 1, 2 e 3 |
|---|---|---|---|---|
| plan-discount-bug | 6/12 | 8/8 | 8/8 | 8/8 |
| plan-ask-merge-payments | 12/12 | 1/8 | 8/8 | 8/8 |
| plan-people-store-v2 | 9/12 | 5/8 | 4/8 | 6/8 |
| multi-timekit | 1/12 | | | 7/8 |
| multi-validkit, multi-moneykit, multi-collkit (reservadas) | 12/12 cada | | | 8/8 cada |

A ordem importa: com "implemente" antes de "pergunte", o agente passou a adivinhar num pedido vago.
`multi-fmtkit` falhava por defeito da tarefa (o teste oculto exigia erro para chave vazia, que o enunciado não
dizia); o enunciado foi corrigido no mesmo PR.

Fontes (citações conferidas com `quote_check.py` em 2026-11-15):

- Guia de prompting do Codex: "Unless asked for a plan, never end the interaction with only a plan."
- Anthropic, prompting best practices: "By default, implement changes rather than only suggesting them."
- arXiv:2607.02294: sob pedido subespecificado os agentes adivinham; por isso a regra 1 vem primeiro.
- arXiv:2607.06636: testes ancorados na especificação acertam mais que "teste casos de borda"; arXiv:2604.19825:
  a conferência só vale executada.

Não adotado agora: continuação automática em `agent_before_settle` e crítico independente (arXiv:2610.34577). Custam
um turno extra ou mais; entram só se o gate mostrar que o bloco não sustenta o ganho.

## Item 6: piso de prefixo

Na sessão headless de topo (sem UI e `PI_CODE_SUBAGENT_DEPTH` ausente ou `0`) o prompt de sistema perde o contrato
longo e a lista de skills. A extensão reescreve o payload em `before_provider_request`, como o `<cwd>`:

- O bloco `<project_instructions path="...">` que começa por `# Working contract (pi)` ganha o texto de
  `$CLAUDE_CONFIG_DIR/CLAUDE.headless.md` (`claude-home/CLAUDE.headless.md`, seis regras). Os delimitadores vêm do
  código do pi (`renderProjectContext`): o fechamento `</project_instructions>` é fixo e o contrato não o contém.
- A seção `<skills>` (introdução mais `<available_skills>`, de `formatSkillsForPrompt`) sai inteira. `rules/safety.md`,
  `personal.md`, ferramentas e o resto ficam.
- Subagentes do pi-code (`--mode json -p`, depth 1 ou mais) e sessões com UI não mudam. Arquivo ausente, vazio ou
  formato inesperado deixa o payload como está (`PI_HEADLESS_LEAN_DEBUG=1` diz o motivo).
- `PI_HEADLESS_FLOOR=0` desliga só este item; `PI_HEADLESS_LEAN=0` desliga tudo.

Evidência: A/B do Terminal-Bench com o braço piso (contrato de 6 regras, sem skills no prompt), não inferior ao
controle: +2,2 pp, IC90 [-4,4; +11,1], custo 0,92×. No servidor falso, o prefixo da 1ª requisição caiu de 24,0 mil
para 9,2 mil tokens com o CLAUDE.md antigo. O CLAUDE.md atual já encolheu 51% no #40, então o ganho a medir agora é
menor (a medir; sem número novo).

Reverter: `PI_HEADLESS_FLOOR=0`, ou apagar `claude-home/CLAUDE.headless.md` (arquivo ausente = sem efeito), ou tirar o
item 6 de `index.ts`.

## Limites conhecidos

- O modo plano é detectado pelo `argv` (`--plan`, prompt `/plan ...`): um `/plan` enviado por stdin não é visto e
  a ferramenta fica inativa nessa execução.
- A linha `Graph: ... has no codegraph index` continua nas execuções sem interface (fora desta mudança).
- O ganho de cache só aparece quando sessões novas começam em diretórios diferentes dentro do TTL do cache.
- Nenhuma ferramenta foi removida (`lsp_*`, `codemode`): fica para uma ablação medida.

## Testes

- `node --experimental-strip-types --test extensions/headless-lean/index.test.ts`

## Reverter

Apagar `extensions/headless-lean/` (ou `PI_HEADLESS_LEAN=0`) e a frase do contrato.
