# Verificação de `extensions/bypass-permissions/index.ts` (2026-11-14)

Origem: a rodada final A2 reportou essa fonte (111 linhas) sem medição, porque não havia teste. Nenhuma lógica de produção mudou; só foi adicionado teste e este registro.

## Teste
`extensions/bypass-permissions/test/index.test.ts` (17 testes, 1 arquivo novo). Importa o módulo real `../index.ts` pelo loader do SDK 1.5.2 (`with-sdk.sh`, sem cópia nem fixture reescrita) e usa só `ExtensionAPI` falso (`on`, `events.on`, `registerCommand`, `registerShortcut`) e UI falsa (`notify`, `setStatus`, `theme.fg`). `Key.ctrlShift('b')` vem do `pi-tui` real.

Isolamento: só `PI_BYPASS_PERMISSIONS`, `NO_COLOR` e o slot global `Symbol.for('pi-harness.permission-modes')` são tocados; `beforeEach` limpa e `afterEach` restaura os valores originais (inclusive ausência). Nada de preferências, ferramentas, modelo, rede, pacotes, Git ou aplicação de patch no SDK.

Cobertura de contrato (asserções sobre mensagens, nível, chaves de status, env, argumentos de `select`):
- registro: comando `bypass`, Ctrl+Shift+B, `session_start`, canal `pi-code:plan-mode`;
- `/bypass on|off|status|<vazio/desconhecido>` e atalho; trim e caixa; env `1/true/on/yes`;
- headless (`hasUI=false`): env muda, sem notify/setStatus;
- `NO_COLOR`: texto puro sem chamar o tema; sem ele, `fg('error', …)`;
- slot inválido (7 formas) cai no env;
- controlador válido: `select('bypassPermissions'|'default', { explicit: true })`, env intacto, sem notify próprio, status da extensão limpo (sem duplicar o do controlador), toggle/status seguem o modo do controlador;
- `select` com `{ ok: false }`: nenhum sucesso fabricado (sem notify, env intacto);
- plan mode: restaura só o que estava ligado antes (com motivo), seguro nunca vira bypass, opt-in durante o plano é mantido, eventos repetidos e payloads inválidos ignorados, com controlador a extensão não age.

Observação (comportamento atual, fixado pelo teste, não alterado): a extensão ignora o retorno de `select`; a notificação de sucesso/falha é responsabilidade do controlador.

## Evidência (esta rodada, focada; não substitui o gate final)
- Autoria: `bash claude-home/bin/tests/claude-compat/with-sdk.sh node --experimental-strip-types --test extensions/bypass-permissions/test/index.test.ts`: 17 passou, 0 falhou (primeira execução; teste novo sobre código existente correto, então sem vermelho de TDD aplicável).
- Cobertura V8 bruta: cópias de `integrated-A2.y1z5XN/map` e `/v8` em `/tmp/bypasscov.qaPAG0` (recibos originais intocados; inventário e hash das fontes inalterados), `$CLEAN`, `PI_TEST_SDK_VERSION=1.5.2`, `PI_TEST_COVERAGE_MAP` e `NODE_V8_COVERAGE` apontando para as cópias, depois `coverage-map.mjs report`:
  `extensions/bypass-permissions/index.ts` measured **100% (70/70)**; resumo `sources 66, measured 66, unverified 0, belowMin 0`, `ok: true`, mínimo por fonte 90,5%.
- Não medido: cobertura de ramos (o medidor é por linha). Mutantes, LSP e o gate completo ficam com o gate final.
