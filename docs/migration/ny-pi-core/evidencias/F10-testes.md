# Evidência F10: mapa dos testes do ny-pi

## Objetivo

Item C-F10-07 e critério global 3 de [00 §8](../00-mega-plano.md): todo teste do ny-pi tem um equivalente verde no
nycode, ou uma linha em [03](../03-mapa-de-migracao.md) que justifica a remoção. Esta evidência registra o método, as
contagens e o que ainda falta. Nenhum teste foi escrito nesta unidade.

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

| Situação | Antes | Depois |
|---|---:|---:|
| Equivalente com o mesmo caminho do anexo (`ok`) | 250 | 250 |
| Equivalente em outro caminho (`destino-diferente`) | 28 | 24 |
| Sem justificativa (`falta-justificativa`) | 2 | 0 |
| Pendente: só existe a cópia em `import/ny-pi/` | 0 | 4 |
| **Total** | **280** | **280** |

Depois das correções, 276 testes têm equivalente no nycode ou linha de remoção; 4 estão pendentes.

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

Observação: `E-resumo-por-regra.md` diz "gerado por `gerar-mapa.py`". As correções acima foram feitas à mão nos dois
arquivos gerados, e o gerador não conhece as exceções (ver Riscos).

## Casos a menos no destino

Legenda: **equivalente** (arquivo:linha no nycode), **SUPERADO** (o mecanismo testado deixou de existir; justificativa
na linha) e **AUSENTE** (o comportamento ainda existe ou foi decidido, e não há teste).

### `bench/tests/classify/test_affects.py` (11 para 7)

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
| `test_more_ui` (parametrizado: `sound-notify`, `dev-commands`, `up-dequeue`, `puxar`, `.pre-commit-config.yaml`) | **AUSENTE** para as 4 extensões. O nycode as classifica como funcionais (`not proven non-functional`: confirmado rodando `affects.classify_path`), e a lista UI de `affects.py` só tem `ui`, `ui-visual`, `footer`, `sticky-prompt`. O caso de `.pre-commit-config.yaml` está em `test_non_functional`. Falta confirmar a decisão D-21 (09 §3.2) e fixar o resultado num teste |

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
| `ctrl+shift+t alterna entre a lista completa e uma linha, e pede re-render` | **AUSENTE**. O destino testa só que o atalho existe e que o widget continua vazio (`:60`, `:81`) |
| `a linha recolhida respeita a largura` | **AUSENTE** (mesma razão) |
| `widget: render normal com glifos, └─ no último e cabeçalho dim quando tudo concluído` | **AUSENTE**: `:60` afirma `render(80) == []` |
| `widget concluído: clique expande, novo clique recolhe` | **AUSENTE** |
| `widget: roda do mouse rola a lista longa e mostra ↑↓` | **AUSENTE** |
| `allDone e retomada: item novo volta a expandir` | Parcial: `plan-source-reset.test.ts:66` cobre a lista concluída que some e reaparece na seção Plan, não o estado `expandedByUser` do `todo` |
| `widget: estouro mostra "+N more" e trunca à largura` | **AUSENTE** |

Os 7 AUSENTES e o parcial dizem respeito ao widget de todos no chat. O destino trocou o desenho: "o chat nunca desenha
os todos" (`:60`), e a lista vai à seção Plan por evento. O código do widget (`TodoOverlay`, clique, roda, recolher)
continua em `src/extensions/todo/index.ts:172-235`, e nenhum teste o exerce. Ou o código é morto e deve sair, ou o
comportamento vale e precisa de teste.

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

| Origem | Caso | O que testava |
|---|---|---|
| `test_affects.py` | `test_more_ui` (4 extensões) | `sound-notify`, `dev-commands`, `up-dequeue`, `puxar` classificados como não funcionais (UI) |
| `todo-collapse.test.ts` | `ctrl+shift+t` alterna | Atalho alterna lista completa e linha única e pede re-render |
| `todo-collapse.test.ts` | linha recolhida e largura | `collapsedLine` respeita a largura |
| `todo-collapse.test.ts` | widget render normal | Glifos, `└─` no último item, cabeçalho dim com tudo concluído |
| `todo-collapse.test.ts` | clique | Clique no widget concluído expande e recolhe |
| `todo-collapse.test.ts` | roda do mouse | Rolagem da lista longa com `↑↓` |
| `todo-collapse.test.ts` | estouro | `+N more` e truncamento à largura |
| `todo-collapse.test.ts` | `allDone` e retomada (parcial) | Item novo volta a expandir um widget recolhido pelo usuário |

## Pendências

1. Quatro testes só existem como cópia bruta em `import/ny-pi/` e saem com `import/` em F12. O anexo E os manda para
   `converter` em F3, e a conversão não aconteceu. Sem ela, o critério global 3 falha para estes:

   | Teste (origem) | Casos | Destino no anexo E | Equivalente atual |
   |---|---:|---|---|
   | `claude-home/bin/evals/harbor/tests/test_pi_harness_agent.py` | 10 | `bench/evals/harbor/tests/test_pi_harness_agent.py` | Nenhum. `bench/tests/harbor/test_nycode_agent.py` (11), `test_nycode_bundle.py` (4) e `test_nycode_step.py` (4) testam o agente do nycode, não o do ny-pi |
   | `claude-home/bin/evals/harbor/tests/test_pi_vanilla_api_agent.py` | 6 | `bench/evals/harbor/tests/test_pi_vanilla_api_agent.py` | Nenhum (mesmo diretório acima) |
   | `claude-home/bin/evals/test_plan_ab.py` | 25 | `bench/evals/test_plan_ab.py` | Nenhum. `rg plan_ab` fora de `import/` e `docs/` não acha nada |
   | `claude-home/bin/structure/test_structure.py` | 16 | `scripts/ci/lint/structure/test_structure.py` | Nenhum. `scripts/ci/lint/structure_changed.py` não tem teste; `test_changed_files.py` (2) e `test_skill_lint.py` testam outros scripts |

   Decisão pendente de quem manda: converter os quatro antes de F12 (unidade própria, F3), ou registrar a remoção no
   03 §2.3 (cada um com o motivo: agentes de benchmark do ny-pi, comparação A/B de plano, medidor de estrutura
   substituído por `structure_changed.py`).
2. Os AUSENTES da tabela acima: decidir entre escrever o teste e remover o código morto (todo), e fixar a classificação
   das 4 extensões em `bench/classify/affects.py`.
3. `gerar-mapa.py` deve receber as exceções (24 destinos e `replay.test.ts`), senão a próxima geração desfaz a correção.

## Riscos

- O anexo E e o resumo por regra são gerados; a edição manual diverge do gerador até a pendência 3.
- A contagem de casos usa o nome do `test(`/`it(`/`def test_` (parametrizados contam uma vez); ela não prova que as
  asserções são as mesmas, só que há caso homônimo. Nenhum teste foi executado nesta unidade.
- "Verde" depende do gate de cada fase; esta evidência mostra a existência do equivalente, não a execução.
