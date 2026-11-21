# Evidência F10: mapa dos testes do ny-pi

## Objetivo

Item C-F10-07 e critério global 3 de [00 §8](../00-mega-plano.md): todo teste do ny-pi tem um equivalente verde no
nycode, ou uma linha em [03](../03-mapa-de-migracao.md) que justifica a remoção. Esta evidência registra o método, as
contagens e o estado final. A unidade só mexeu em testes onde o código testado mudou (todo e `test_affects.py`).

## Método

1. Universo: os 280 arquivos de teste do ny-pi em `origin/main` (`*.test.ts`, `test_*.py`, `*_test.py`, `tests/*.sh`),
   lidos só por `git -C ~/source/ny-pi show origin/main:<caminho>`.
2. Destino de cada um: coluna `destino` do anexo [E](../anexos/E-mapa-arquivo-a-arquivo.tsv), confirmada com
   `git ls-tree origin/main -- <destino>`. Quando o destino do anexo não existe, procurou-se o arquivo real pelo nome.
3. Casos: contagem de `test(`/`it(`/`def test_` na origem e no destino. Destino com menos casos (10 arquivos) foi
   comparado caso a caso, por nome e por asserção, em qualquer arquivo do nycode (seção "Casos a menos").
4. Remoções: o arquivo precisa de linha no 03 (§2.3) ou de uma decisão que o cubra.

Insumo bruto: `f10-tests-map.tsv` (280 linhas), em `~/.local/share/nycode-mig/`, fora do repositório.

## Contagens

| Situação | Início | Final |
|---|---:|---:|
| Equivalente com o mesmo caminho do anexo (`ok`) | 250 | 253 |
| Equivalente em outro caminho (`destino-diferente`) | 28 | 24 |
| Sem justificativa (`falta-justificativa`) | 2 | 0 |
| Removido com linha em [03 §2.3](../03-mapa-de-migracao.md): `replay.test.ts` e `test_cache_probe_join.py` (já no início) e `test_plan_ab.py` | 0 | 3 |
| **Total** | **280** | **280** |

Final: 280 de 280 têm equivalente no nycode (277) ou remoção justificada no 03 (3). Três dos quatro testes que só
existiam em `import/ny-pi/` foram convertidos com o código que testam (ver "Pendências resolvidas"); só o de `plan_ab`
saiu, junto com o `plan_ab`, que nada referencia.

Correções feitas no anexo E (commit `999af08da`):

- 24 linhas ganharam o caminho real do destino na coluna `destino` (por exemplo `test/harness/goal/goal.test.ts` em vez
  de `test/harness/extensions/goal/goal.test.ts`; a refatoração de F5/F6 reorganizou as pastas). Todos os 24 caminhos
  existem em `origin/main`. `scripts/test_check_refs.py` ficou em `scripts/`, e não em `scripts/ci/lint/`.
- `replay.test.ts` virou `remover` (regra P16), com linha no 03 §2.3. Ele reverte e reaplica a pilha de patches
  (`patch -R` sobre a árvore instalada do pi-code), que o nycode não tem: o código do `subagent` é do repositório (D-02).
  O comportamento de roteamento que ele guardava tem `render.test.ts` e `tracker.test.ts` no destino. Efeito nas
  contagens do 03 §2.1: `remover` 35 e `converter` 1317; o resumo por regra (P15 14, P16 2, F6 e total) acompanhou.
- `test_cache_probe_join.py` não precisou de linha nova: o 03 §2.3 já lista "`cache_probe_join.py`, seu teste" sob a D-10
  (diagnóstico temporário). O anexo E já o marcava `remover`.

`gerar-mapa.py` agora produz essas correções: ganhou `OVERRIDES` (os 24 destinos, `replay.test.ts`, mais as 4 linhas
já editadas à mão por D-36 e D-37) e a regra `X01` (os 5 arquivos sem referência viva: `plan_ab.py`, `plan_ab_cases.jsonl`, `test_plan_ab.py`, `harbor/run.sh`,
`harbor/README.md`), além de `--resumo <sha>`, que gera
`E-resumo-por-regra.md` (antes só o TSV saía do script). Prova: com o ny-pi em `origin/main` `e4f8729` (1485 caminhos),
o gerador sem `X01` e sem os 5 destinos de Harbor dá o TSV idêntico ao de `999af08da` (diff vazio). A conversão de
2026-11-21 (segunda parte) mudou 22 linhas do TSV, todas em `claude-home/bin/evals/` e `claude-home/bin/structure/`.
O resumo de `999af08da` estava defasado em duas células (F7 com `mover` 32 e `absorver` 5, total 89 e 33, quando o TSV
tem 33, 4, 90 e 32 desde D-36): a regeneração as corrige.

## Casos a menos no destino

Legenda: **equivalente** (arquivo:linha no nycode), **SUPERADO** (o mecanismo testado deixou de existir; justificativa
na linha) e **AUSENTE** (o comportamento ainda existe ou foi decidido, e não há teste).

### `bench/tests/classify/test_affects.py` (11 para 7, os 11 cobertos com 4 casos novos)

| Caso na origem | Equivalente |
|---|---|
| `test_non_functional` | `bench/tests/classify/test_affects.py:46` |
| `test_functional` | `bench/tests/classify/test_affects.py:76` |
| `test_render_lists_decision` | `bench/tests/classify/test_affects.py:156` |
| `test_cli_against_real_git` | `bench/tests/classify/test_affects.py:164` |
| `test_publish_list_only_tests_is_non_functional` | `test_package_json_files_field_replaces_publish_list`, `:80` (o campo `files` do `package.json` substituiu `publish.list`) |
| `test_evaluate_real_git` | `test_evaluate_reads_files_field_from_git`, `:128`, e `test_evaluate_added_package_json_is_functional`, `:146` |
| `test_record_docs` | SUPERADO: não há `claude-home/docs`; `docs/*` já é "docs" em `test_non_functional` |
| `test_patch_targets` | SUPERADO: não há pilha de patches |
| `test_parse_helpers` | SUPERADO: `patch_target_files` e `referenced_docs` deixaram de existir |
| `test_more_ui` (parametrizado: `sound-notify`, `dev-commands`, `up-dequeue`, `puxar`, `.pre-commit-config.yaml`) | `.pre-commit-config.yaml`: `test_non_functional`. As 4 extensões: a lista do nycode é deliberadamente mais estreita (09 §3.2, D-21: UI pura é `ui`, `ui-visual`, `footer`, `sticky-prompt`, temas e linha de status; o resto falha fechado), então o equivalente é o inverso: `test_functional` afirma `sound-notify`, `dev-commands`, `up-dequeue` e `import-claude-session` (o `puxar`) como funcionais (`bench/tests/classify/test_affects.py`, 4 casos novos). Justificativa no 03 §2.3 |

### `claude-home/bin/tests/pi-ui-final-gate.sh` (2 para 0)

| Caso na origem | Equivalente |
|---|---|
| Não é uma suíte: é um roteiro de gate (`chk` e `nt`) que roda outros testes sobre `~/.pi/agent`. A contagem "2" veio do padrão `test(` dentro do texto | SUPERADO: `scripts/harness/ui-gates/pi-ui-final-gate.sh` é o roteiro adaptado (F7), sem casos próprios |

### `notify-focus.test.ts` (8 para 7)

| Caso na origem | Equivalente |
|---|---|
| 7 casos de foco e `isAway` | `test/harness/notify/notify-focus.test.ts:45` a `:86` |
| `patch aplica ao original e reverte no instalado` | SUPERADO: não há pilha de patches |

### `rewind-tree.test.ts` (38 para 37)

| Caso na origem | Equivalente |
|---|---|
| 37 casos | `test/harness/git-checkpoint/git-checkpoint.test.ts:85` a `:763`, mesmos nomes |
| `patch aplica ao original e reverte no instalado` | SUPERADO: não há pilha de patches |

### `subagent-panel/fleet-ui.test.ts` (32 para 24)

| Caso na origem | Equivalente |
|---|---|
| 8 casos do viewer: `formatadores do viewer` (2), `render`, `leitura incremental`, `←/→ irmãos`, `input`, `x x para`, `com poll` | `test/harness/subagent/panel/fleet-viewer.test.ts:14` a `:190`, mesmos nomes (arquivo separado no destino) |
| `controller: ativa só com editor vazio, editor focado e linhas; release ignorado` | `fleet-ui.test.ts:265` (reescrito: a entrada no painel passou a ser o título em `section-nav` e `enterBody()`, não mais ↓ no editor vazio) |
| Demais 23 casos | `fleet-ui.test.ts:27` a `:658`, mesmos nomes |

Nenhum AUSENTE: 24 no arquivo mais 8 no `fleet-viewer.test.ts` cobrem os 32 (o 265 substituiu um caso).

### `subagent-panel/fleet.test.ts` (29 para 16)

| Caso na origem | Equivalente |
|---|---|
| 16 casos de `id guard` até `stopOwnForegroundRuns` | `test/harness/subagent/fleet/fleet.test.ts:19` a `:430` |
| `detach`, `raceDetach` (2), `inbox`, `inbox watcher`, `onChange`, `F1` a `F6` | `test/harness/subagent/fleet/fleet-lifecycle.test.ts:23` a `:377`, mesmos nomes |
| `fleetStatusLines lists detached depth-1 running runs outside the registry` | `fleet-lifecycle.test.ts:134` (`D8 fleetStatusLines lists every lane of the tree`, regra nova) |

Nenhum AUSENTE.

### `todo-collapse.test.ts` (30 para 23)

| Caso na origem | Equivalente |
|---|---|
| 22 casos de `collapsedLine`, `execute`, `renderCall`, `renderResult`, `replay`, `widget` (registro), `scrollWindow`, `layoutOverlay`, `normalizeTodo`, `/todos` | `test/harness/todo/todo-collapse.test.ts:15` a `:420`, mesmos nomes |
| `patch aplica ao original e reverte no instalado` | SUPERADO: não há pilha de patches |
| Os 7 casos do widget (`ctrl+shift+t` alterna, linha recolhida e largura, render normal com glifos, clique, roda do mouse, estouro `+N more`) e o parcial (`allDone` e retomada) | SUPERADO: o widget foi removido (commit `aff208fc3`), ver abaixo |

Evidência de que o widget era código morto, em `src/extensions/todo/index.ts` antes da remoção:

1. `renderWidget` devolvia `[]` sempre (a lista vai à seção Plan pelo evento `pi-code:todos`, `plan-mode/index.ts`).
2. O mouse chega ao componente pela caixa que ele ocupa na tela (`getLayoutBoxesAt` em
   `packages/tui/src/tui-alt-screen.ts`, `dispatchMouseToLayout`): um componente de zero linhas não tem caixa, então
   `handleMouse` (clique e roda) nunca era chamado.
3. `ctrl+shift+t` só mudava `collapsed`, `expandedByUser` e `scroll`, lidos apenas por `renderWidget`; o efeito
   visível era nenhum. `layoutOverlay`, `scrollWindow`, `collapsedLine` e `allDone` só serviam a essa renderização.
4. Registrar um widget de zero linhas não muda a altura do contêiner acima do editor (`renderWidgetContainer`: um
   `Spacer(1)` com ou sem widgets).

Removidos: `TodoOverlay`, o atalho, `layoutOverlay`, `scrollWindow`, `collapsedLine`, `allDone`, `WIDGET_KEY` e
`MAX_WIDGET_LINES`. Testes que acompanham: saíram os de `collapsedLine` (2), do widget (2), do atalho (2) e de
`scrollWindow` e `layoutOverlay`, e o teste "o chat nunca desenha" virou "não registra widget nem atalho e publica a
lista pelo evento". Os demais casos de `todo-collapse.test.ts` (ferramenta, replay, `/todos`) seguem verdes. A
documentação histórica copiada de `claude-home/docs` (`docs/harness/pi-ui-sota.md`, `goal.md`) ainda descreve o
atalho; é registro do ny-pi e não foi editada.

### `patches/pi-core/mcp-close-grace.test.ts` (7 para 1)

| Caso na origem | Equivalente |
|---|---|
| `fechar um servidor que ainda sobe leva bem menos que 500 ms` | `packages/mcp/test/stdio-close-grace.test.ts:7` (SIGTERM cerca de 100 ms após fechar o stdin) |
| `apply troca 500 por 100 no bundle e é idempotente`, `apply não casa com outra versão`, `apply reconhece a forma do dist/transports/stdio.js`, `rodar o .mjs por um symlink aplica`, `diretório somente-leitura`, `escrita atômica` | SUPERADO: eram testes do script que aplicava o patch ao `pi-mcp` instalado. Com o código no repositório não há patch nem `.mjs` |

Nenhum AUSENTE.

### `extensions/sticky-prompt/sticky.test.ts` (8 para 7)

| Caso na origem | Equivalente |
|---|---|
| 7 casos de matcher, linha e estilo | `test/harness/extensions/sticky-prompt/sticky.test.ts:25` a `:67` |
| `seleção em andamento esconde o sticky` | `test/harness/extensions/sticky-prompt/index.test.ts:106` |

Nenhum AUSENTE.

### `extensions/ui/test/a11y.test.ts` (9 para 7)

| Caso na origem | Equivalente |
|---|---|
| `noColor`, `reducedMotion: só "1"`, `NO_PROGRESS`, `NO_COLOR aplica o tema mono`, `PI_REDUCED_MOTION`, `sem UI ou sem env` | `test/harness/extensions/ui/a11y.test.ts:11`, `:17`, `:28`, `:75`, `:82`, `:86` |
| `plainHeader: tira as cores do cabeçalho embutido e repassa expandir/invalidar` | `test/harness/core/appearance/header-no-color.test.ts:27` (K10: o cabeçalho sem cor passou ao core) |
| `plainHeader: no /reload acha o embutido atrás do wrapper anterior` | SUPERADO: não há wrapper encadeado, o `BuiltInHeader` lê `NO_COLOR` direto |
| `plainHeader: sem cabeçalho embutido (startup silenciado) não desenha nada` | SUPERADO: o wrapper que procurava o cabeçalho na árvore não existe |

Nenhum AUSENTE. O destino ganhou `terminal.reducedMotion` do `settings.json` (`:23`) e a variável vencendo o settings.

### Resumo dos AUSENTES

Nenhum AUSENTE ficou em aberto: `test_more_ui` tem o teste inverso no nycode e os casos do widget de todos são
SUPERADOS pela remoção do widget.

## Pendências resolvidas

1. Os quatro testes que só existiam em `import/ny-pi/` primeiro viraram `remover` (regra `X01`). Depois, por decisão do
   dono ("converter já o que o nycode usa; o que não usa sai"), o código testado foi convertido quando algo vivo o usa:

   | Teste (origem) | Casos | Código | Situação final |
   |---|---:|---|---|
   | `harbor/tests/test_pi_harness_agent.py` | 10 | `pi_harness_agent.py` | `bench/harbor/` e `bench/tests/harbor/`: `bench/run.py` o usa no braço `ny-pi` |
   | `harbor/tests/test_pi_vanilla_api_agent.py` | 6 | `pi_vanilla_api_agent.py` | idem, braço `pi-vanilla` em modo API (importa `_models_merge` do anterior) |
   | `structure/test_structure.py` | 16 | `structure.py` | `scripts/ci/lint/structure/`: as instruções embarcadas mandam rodar esse caminho |
   | `test_plan_ab.py` | 25 | `plan_ab.py` | removido com o código: `rg plan_ab` fora de `import/` e `docs/` não acha nada |

   Para o Harbor, o `bundle.sh` do ny-pi virou `bench/harbor/pi_bundle.sh` (o `bundle.sh` do nycode já ocupa o nome) e
   `bench/run.py` passou a ter `HARBOR_DIR = bench/harbor` para todos os braços, mais `OMP_DIR` só para o braço `omp`
   (D-26), que ainda lê `omp_agent.py` e `omp-release.sh` de `import/`. `harbor/run.sh` e `harbor/README.md` saíram: eram
   a execução manual do braço com credenciais do dono, que `bench/run.py` substitui. Os testes dos dois agentes agora
   importam o módulo contra módulos `harbor` falsos e restauram `sys.modules` (`bench/tests/harbor/stubs.py`), em vez de
   deixar os falsos no processo.

   Nome com "pi": `pi_harness_agent.py` e `pi_vanilla_api_agent.py` ficam com o nome porque descrevem o produto medido
   (os braços `ny-pi` e `pi-vanilla`), caso previsto em 05 §6 (D-31: "Pi Vanilla" e "ny-pi" nomeiam a referência do
   benchmark). O código também cita `~/.pi/agent` e `pi --print`, que é o produto medido, e não pode ser renomeado.
2. `structure.py`: `git mv` sem alteração, depois caminhos e nomes (cabeçalho, pinos do `VENDORED` do pi-code saem, o
   verificador do `diagram-design` aponta para o checkout), tipos para `mypy --strict`, `ruff format` e o teste sem
   carregar o módulo por `importlib` à mão. `python3 scripts/ci/lint/structure/structure.py --project-root . --json`
   roda (8078 arquivos de código; os achados são arquivos do upstream acima de 800 linhas, fora do alcance do
   `structure_changed.py`). `structure_changed.py` citava `scripts/harness/structure/structure.py`, que nunca existiu:
   agora cita o caminho real. A cópia `DEFAULT_SUFFIXES` ficou (importar exigiria mudar o carregamento por raiz e os
   testes que usam raízes de teste) e ganhou um teste que a mantém igual à lista do `structure.py`.
3. `test_more_ui` e os casos do widget de todos: ver as seções acima.
4. `gerar-mapa.py` recebeu as exceções (ver "Correções feitas no anexo E").

## Riscos

- O braço `omp` (D-26: não migra) ainda existe em `bench/` (`arms/omp`, `OMP_DIR` em `bench/run.py`) e lê
  `omp_agent.py`, `omp-release.sh` e `test_omp_agent.py` de `import/`. Ao remover `import/` (F12), remover o braço junto.
- `bench/arms/ny-pi` roda o `install.sh` de `import/ny-pi` (a árvore de instalação do ny-pi); `core_scope.py` e seu teste
  citam `import/ny-pi` para saber que peças ainda esperam migração. São usos vivos de `import/`, tratados em F12.
- A contagem de casos usa o nome do `test(`/`it(`/`def test_` (parametrizados contam uma vez); ela não prova que as
  asserções são as mesmas, só que há caso homônimo.
- "Verde" depende do gate de cada fase; esta evidência mostra a existência do equivalente. Execução desta unidade em
  "Verificação".

## Verificação

Ramo `docs/f10-test-map`, 2026-11-21. Registros em `~/.local/share/nycode-mig/f10c-*.log`.

| Verificação | Resultado |
|---|---|
| `npm run check` | exit 0 |
| `npm run build`, depois `env -u OPENROUTER_API_KEY npx vitest --run` em `packages/coding-agent` (suíte inteira, porque o `todo` mudou) | exit 0: 491 arquivos e 4394 testes passaram; 6 arquivos e 53 testes ficaram `skipped` (já eram assim) |
| `vitest test/harness/todo test/harness/extensions/todo test/harness/plan-mode` | 13 arquivos, 116 testes verdes |
| `pytest bench/tests/classify` | 36 testes verdes (32 antes mais 4) |
| `pytest scripts/ci/lint/test_gerar_mapa.py` | 4 testes; cobertura de `gerar-mapa.py` 98% (só o `sys.exit` final fica de fora) |
| Regeneração do anexo E (`gerar-mapa.py` sobre os 1485 caminhos do ny-pi `e4f8729`) | diff vazio contra o TSV e o resumo do ramo; sem `X01`, diff vazio contra o TSV de `999af08da` |
| `run-static.sh` (Python 3.12, `BASE_SHA` = merge-base com `origin/main`) | `ci-static OK`, diff-cover 100% |
| `check-refs.py` | 0 |
| `core_scope.py` | OK (109 peças) |
| `check-seams.sh` | exit 0 |

Não rodado: `check-leaks.sh` (nenhum arquivo movido; só texto, um teste e um script do mapa). O venv de CI em
`/tmp/ci312` sumiu durante a unidade e foi refeito em `~/.local/share/nycode-mig/ci312` com
`scripts/ci/requirements-ci.txt` (hashes exigidos).
