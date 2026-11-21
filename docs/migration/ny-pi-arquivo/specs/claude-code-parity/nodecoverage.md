# Cobertura Node por fonte de primeira parte (2026-11-14, fix round 2/2)

Origem: gate A reportou 11 fontes sem medição (`ui/editor`, `ui/history`, `ui/index`…): testes **copiam** a fonte para `/tmp`, importam a cópia e **apagam** a pasta. Sem dependência nova, sem `package.json` na raiz, sem alterar módulo, fonte, seleção ou resultado de teste.

## Causa observada
- `node --experimental-test-coverage` (LCOV) lê a fonte no relatório e **descarta** a cópia já apagada (sonda: o `SF:` da cópia só aparece se o arquivo ainda existe). Cópia viva aparece como `../cp-XXXX/a.ts`, nunca como a fonte do repo.
- O V8 bruto (`NODE_V8_COVERAGE`) **mantém** `url` + intervalos de offset da cópia apagada. Contrato antigo "agregar LCOV" **superado**: a entrada do agregador é o diretório V8 bruto; a saída pode ser um LCOV só com fontes reais (`--lcov-out`), sem duplicatas de cópia.

## Prova de identidade
1. `coverage-map.mjs init` grava `inventory.json`: SHA256 + bytes de cada fonte de primeira parte (TS/MJS que não é teste, `.d.ts`, `node_modules`, nem link simbólico) sob os `--include`.
2. Com `PI_TEST_COVERAGE_MAP=<dir absoluto>` o loader existente (`sdk-hooks.mjs`, hook `load(url, context, nextLoad)`) lê o **bruto** devolvido por `nextLoad` (antes de o teste apagar a cópia), calcula o SHA256 e anexa um registro `loads-<pid>-<uuid>.jsonl` (um arquivo por loader-thread; PID + UUID: sem corrida entre processos). O registro tem só `{v,pid,path,sha256,bytes,known}`. Sem a variável, o loader não grava nada. Só escopo próprio: `file:`, candidato TS/MJS fora de teste, fora de `node_modules` e fora da raiz do SDK gerenciado (SDK e demais não são registrados).
3. `report` funde um script V8 numa fonte do inventário **somente** com hash idêntico, no mesmo PID, para o mesmo caminho (união dos aliases: linha coberta se qualquer alias a cobre; linhas executáveis vêm da fonte do repo, sem inflar contagem; nunca por basename).
4. `UNVERIFIED` (listado em `unverifiedLoaded`, nunca mesclado): cópia com bytes diferentes (`no-exact-hash`, ex.: fixture import-only modificada), hash ambíguo entre fontes, mesmo caminho com dois hashes no mesmo processo, script V8 sem registro de load (código dinâmico/Jit, `no-load-record`). Transformação que preserva linhas só entraria com mapa de fonte provado; hoje não há, então nada é normalizado em silêncio.
5. Fonte do inventário nunca carregada = `unverified-never-loaded`, 0%; carregada sem V8 = `unverified-no-v8`. Ambas reprovam.
6. Falha fechada (exit 2): JSON/registro malformado, campo desconhecido, versão ≠ 1, caminho relativo, SHA inválido, `known` divergente do inventário, fonte carregada com bytes ≠ inventário, intervalo V8 inicial além da fonte, inventário de outro repo. Identidade da fonte **antes/depois**: o relatório re-hasheia cada fonte; mudança = `unstableSources` e reprova.

## Limites e política
- Mínimo **80% por arquivo**, sem isenção e sem rebaixar limite. Uma fonte medida com 0 linhas executáveis após strip de tipos fica `no-executable-lines` (passa só se carregada e medida; nunca por ausência).
- Linhas executáveis = não vazias após `stripTypeScriptTypes` (modo strip, mesmo comprimento) e que não são só comentário. É aproximação de linha (não ramo): o algoritmo é o do v8-to-istanbul (intervalo externo primeiro, interno sobrescreve; linha só muda se o intervalo a cobre inteira). O V8 anexa `//# sourceURL=…`: o fim do intervalo raiz passa do tamanho da fonte e é aceito; o início além da fonte falha.
- Limites de entrada (`LIMITS`): 5000 fontes, 2 MiB por fonte, 16 MiB por metadado, 128 MiB por arquivo V8, 200 mil registros, 200 itens por lista. Saída: JSON só de metadados (caminhos, hashes, contagens); nunca conteúdo de arquivo nem segredos.
- Processos filhos com `env` explícito sem `NODE_OPTIONS`/`NODE_V8_COVERAGE` não gravam: o que só eles carregam fica `unverified`. Cobertura de ramos não é medida.

## Arquivos (raiz `claude-home/bin/tests/claude-compat/`: 4 existentes + 2 novos = 6 de código)
`coverage-map.mjs` (inventário, registro, agregador, CLI), `coverage-map.test.mjs` (13 testes, inclui instrumentação real com duas cópias exatas apagadas, cópia alterada, módulo nunca importado, malformados, limites), `sdk-hooks.mjs` (+`load`), `sdk-register.mjs` (+`coverageDir`). Links globais e `publish.list` cobrem estes, `with-sdk.sh`, `pycov/*` e `hooks/permissions/tests/{__init__,test_hardening}.py`.

## Comandos exatos para o runner final (raiz do repo; `$CLEAN` como em `fix-test-setup.md` §1)
Node, **sem** `--experimental-test-coverage` nesta medição (o V8 bruto é a fonte); repita a linha `node … --test` para cada passo Node do gate, com os mesmos argumentos e arquivos dele; o diretório V8 acumula:
```sh
M=claude-home/bin/tests/claude-compat; D=$(mktemp -d /tmp/nodecov.XXXXXX)
CLEAN="env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH -u PI_CODE_SUBAGENT_ALLOWED_AGENTS -u PI_CODING_AGENT -u PI_SESSION_FILE -u PI_PERMISSION_MODE"
node --test $M/sdk-hooks.test.mjs $M/coverage-map.test.mjs                       # autotestes (5 + 13)
node $M/coverage-map.mjs init --repo $PWD --dir $D/map --include extensions --include claude-home/patches/pi-core --include claude-home/patches/pi-code
mkdir $D/v8
PI_TEST_COVERAGE_MAP=$D/map NODE_V8_COVERAGE=$D/v8 PI_TEST_SDK_VERSION=1.5.2 $CLEAN bash $M/with-sdk.sh node --experimental-strip-types --test <arquivos do passo>
node $M/coverage-map.mjs report --repo $PWD --dir $D/map --v8 $D/v8 --json $D/report.json --lcov-out $D/real.lcov   # exit 1 = alguma fonte < 80% ou não verificada
```
Python (stdlib) e Python limpo: ver `fix-test-setup.md` §3 (comando guard + permissions) e `python3 -m unittest claude-home/bin/tests/claude-compat/pycov/test_pycov.py`. Setup Node limpo: `$CLEAN` + `PI_TEST_SDK_VERSION=1.5.2` + `with-sdk.sh`.

## Medido nesta rodada (focado, não é gate)
Autotestes 13/13 + `sdk-hooks` 5/5. Sonda real com um único teste (`extensions/ui/test/vim/editor-vim.test.ts`, 116 fontes no inventário): 11 medidas (aliases 97,0; fleet 6,1; slot 25,0; engine 95,1; host 95,1; motions 93,1; ops 100; render 96,0; text 100; **ui/editor 51,1; ui/history 11,1**), 105 `unverified-never-loaded` (não carregadas por esse teste), `unverifiedLoaded` 0. Isto mostra que a ferramenta mede cópias apagadas; **não** é cobertura agregada nem verde: `fleet`, `slot`, `editor`, `history` ficam abaixo de 80% com só esse teste e as demais fontes só medem com o gate completo.

## Gaps encontrados fora do escopo (relatar, não corrigidos)
- Meta+M: `docs/claude-code-compat.md:233` e `extensions/claude-compat/shortcuts.ts:93` listam "Shift+Tab / Meta+M" sem condição. O primário em cache (`interactive-mode.md` linha 39) diz Alt+M **somente no Windows com entrada VT desativada**, não obrigatório no Linux; `docs/claude-code-keybindings.md:26` já traz "(Meta+M no Windows sem VT)". O inventário deve tratar Meta+M como condicional de plataforma, sem inventar suporte de tecla. Dono: docs/atalhos/matrix, fora deste escopo.
- `check-instructions.py` (baseline, exit 0): 2 problemas, `rules-ref/research-and-tools.md` linha 15 "hook SessionStart (inexistente no pi)" e `commands/team-onboarding.md` "/nome" inexistente. Fora do escopo; não alterados.
- Entradas ainda fora do `publish.list` e de outras lanes: `claude-home/bin/lifecycle/test_supervisor.sh`, patches `zzzzzzzzzzzzzz-onda5*`, `extensions/diagnostico/test/obs/*`, `extensions/ui-visual/{diff.ts,test/*}`, `extensions/ui/test/vim/editor-vim.test.ts`.
