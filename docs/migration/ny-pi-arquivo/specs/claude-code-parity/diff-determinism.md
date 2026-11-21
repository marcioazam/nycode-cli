# Determinismo de `extensions/ui/test/diff.test.ts` (2026-11-14)

## Defeito observado
A verificação V8 (`/tmp/pi-claude-compat-gate/A3-v8-183029/`) falhou em `comando abre o componente e navega` (linha 122): `comp` indefinido depois de um `setTimeout` arbitrário de 50 ms. O verificador repetiu sem mudança até passar; isso não é correção. Causa: o comando prepara (`collectChanges`, subprocessos git) antes de chamar `ui.custom`; o tempo de preparação é imprevisível. Os esperas de 200 ms (carga do diff) e 20 ms (`open`, erro de carga) tinham a mesma causa: `loadDiff` é assíncrono.

## Contrato novo (só teste; `diff.ts` inalterado)
- Prontidão do componente: promessa resolvida pela fábrica de `ui.custom` depois de atribuir `comp`; aguardada com prazo.
- Fim da carga: `watch().until` reavalia o predicado "sem `Carregando…`" a cada `requestRender` do componente (o `.finally(requestRender)` de `handleInput(Enter)` roda depois de `show`, cobrindo diff e `Erro: …`). Orientado a evento, sem polling.
- `within(p, rótulo, ms=5000)`: o prazo só rejeita (falha explícita em vez de travar) e limpa o timer ao resolver.
- Caracterização: `preparação atrasada do comando` usa `exec` com portão controlado: antes de liberar, `ui.custom` não foi chamado; depois, o teste espera o componente real. `within rejeita no prazo` prova que não trava.
- Todas as asserções anteriores (malformado/erro/viewport/comentários) preservadas; nenhum skip, catch incondicional, gancho de produção ou tolerância maior.

## Sleeps restantes
Nenhum aguardo de prontidão. O único `setTimeout` é o prazo de falha de `within` (cancelado em sucesso).
