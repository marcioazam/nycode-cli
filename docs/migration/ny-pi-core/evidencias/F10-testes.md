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
| Equivalente com o mesmo caminho do anexo (`ok`) | 250 | 250 |
| Equivalente em outro caminho (`destino-diferente`) | 28 | 24 |
| Sem justificativa (`falta-justificativa`) | 2 | 0 |
| Removido com linha em [03 §2.3](../03-mapa-de-migracao.md): `replay.test.ts` e `test_cache_probe_join.py` (já no início) e os 4 de 2026-11-21 | 0 | 6 |
| **Total** | **280** | **280** |

Final: 280 de 280 têm equivalente no nycode (274) ou remoção justificada no 03 (6). Os 4 testes removidos em
2026-11-21 deixam o código testado só em `import/ny-pi/` (ver Riscos).

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
já editadas à mão por D-36 e D-37) e a regra `X01` (os 4 testes removidos), além de `--resumo <sha>`, que gera
`E-resumo-por-regra.md` (antes só o TSV saía do script). Prova: com o ny-pi em `origin/main` `e4f8729` (1485 caminhos),
o gerador sem `X01` dá o TSV idêntico ao de `999af08da` (diff vazio); com `X01`, o TSV difere só nas 4 linhas novas.
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

1. Os quatro testes que só existiam em `import/ny-pi/` viraram `remover` no anexo E (regra `X01`) com linha no 03 §2.3.
   Em cada um, o código testado também só existe em `import/ny-pi/`, não foi convertido por F3 e sai com ele em F12:

   | Teste (origem) | Casos | Código testado | Situação |
   |---|---:|---|---|
   | `claude-home/bin/evals/harbor/tests/test_pi_harness_agent.py` | 10 | `pi_harness_agent.py` | Só em `import/ny-pi/`; `bench/run.py` (`HARBOR_DIR`) ainda o usa no braço `ny-pi`. O agente do nycode é `bench/harbor/nycode_agent.py` (testes: 11, 4 e 4 casos) |
   | `claude-home/bin/evals/harbor/tests/test_pi_vanilla_api_agent.py` | 6 | `pi_vanilla_api_agent.py` | Idem, braço `pi-vanilla` em modo API; importa `_models_merge` de `pi_harness_agent` |
   | `claude-home/bin/evals/test_plan_ab.py` | 25 | `plan_ab.py` | Nada no nycode o referencia (`rg plan_ab` fora de `import/` e `docs/`) |
   | `claude-home/bin/structure/test_structure.py` | 16 | `structure.py` | Só em `import/ny-pi/`; o CI usa `scripts/ci/lint/structure_changed.py` (D-06), que não importa o `structure.py` (usa a cópia `DEFAULT_SUFFIXES`) |

   Portar o código exigiria tipar em `mypy --strict`, trocar nomes e decidir o destino (`scripts/harness/` no 07 §3.5,
   `scripts/ci/lint/` no anexo E): código de produção novo só para salvar um teste.
2. `test_more_ui` e os casos do widget de todos: ver as seções acima.
3. `gerar-mapa.py` recebeu as exceções (ver "Correções feitas no anexo E").

## Riscos

- As linhas do anexo E do código testado (`pi_harness_agent.py`, `pi_vanilla_api_agent.py`, `plan_ab.py`,
  `plan_ab_cases.jsonl`, `structure.py`) seguem `converter` F3, e a conversão não aconteceu. Decidir antes de F12:
  converter ou marcar `remover`. Sem decisão, o braço `pi-vanilla` (D-26) perde o agente de Harbor quando `import/`
  sair (`bench/run.py` lê `HARBOR_DIR` de lá), e as instruções embarcadas (`resources/instructions/contract.md`,
  `rules/ref/harness-economy.md`, skills `engineering-standards` e `ripple-hunt`) continuam mandando rodar
  `scripts/ci/lint/structure/structure.py`, que não existe.
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
