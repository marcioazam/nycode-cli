# ui-visual: fundo cortado no cabeçalho de tool (2026-11-13)

## Objetivo / aceite
- Quando o cabeçalho (`callComponent`) ou uma linha de resultado (`lines`) é truncado, o fundo do Box pai continua ativo em `…` e na duração; cores/negrito não vazam; largura ≤ w; sem corte a saída é idêntica.

## Causa
`truncateToWidth` (pi-tui) fecha o corte com `ESC[0m … ESC[0m`. O reset total apaga o fundo do Box, então `…` e a duração aparecem sem fundo. Caso relacionado: `lines()` (resultados e erros) usava a mesma chamada.

## Mudança
`extensions/ui-visual/tools.ts`: `fit()` troca os dois resets finais por `ESC[22;23;24;27;29;39m` (atributos + cor, sem fundo); usado em `callComponent` e `lines`.

## Teste
`extensions/ui-visual/test/tools.test.ts`: modelo de terminal com SGR reais (fundo 48;5;236, fg/bold ANSI), casos de corte (cabeçalho w=30/60/100, resultado), sem corte, largura exata e exata−1, corte dentro de negrito.

## Procedimento red/green (rodar só na verificação final)
- Comando: `node --experimental-strip-types --test extensions/ui-visual/test/tools.test.ts`
- Red: reverter `fit` para `truncateToWidth(text, Math.max(1, w), '…')` (corpo de `fit` = `return cut` logo após o truncate) e rodar: os 2 testes novos falham (fundo `…`/duração e `fit` regex).
- Green: com o fix, todos passam no gate.

## Evidência
- Red observado: 13 passaram e 2 falharam, incluindo `fundo w=30` com `… 1m 05s` sem fundo.
- Green: `node --experimental-strip-types --test extensions/ui-visual/test/*.test.ts`: 39 passaram, 0 falharam.
- Estrutura de `extensions/ui-visual`: sem achados. `git diff --check` geral aponta espaços preexistentes em `claude-home/patches/pi-code/todo-collapse.patch`.
- Verificação visual ao vivo não executada. A troca dos resets depende do formato atual do pi-tui; se mudar, o comportamento anterior é mantido.
- Custo: processamento adicional apenas ao renderizar linhas truncadas, sem nova dependência.
