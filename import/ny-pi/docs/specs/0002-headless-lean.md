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

## Limites conhecidos

- O modo plano é detectado pelo `argv` (`--plan`, prompt `/plan ...`): um `/plan` enviado por stdin não é visto e
  a ferramenta fica inativa nessa execução.
- A linha `Graph: ... has no codegraph index` continua nas execuções sem interface (fora desta mudança).
- O ganho de cache só aparece quando sessões novas começam em diretórios diferentes dentro do TTL do cache.
- Nenhuma ferramenta foi removida (`lsp_*`, Antigravity): fica para uma ablação medida.

## Testes

- `node --experimental-strip-types --test extensions/headless-lean/index.test.ts`

## Reverter

Apagar `extensions/headless-lean/` (ou `PI_HEADLESS_LEAN=0`) e a frase do contrato.
