# Paridade e benchmark

Como o plano prova que o nycode se comporta como o ny-pi: testes portados, contrato com a API falsa, diferenciais e
benchmark; o critério numérico de paridade; a migração do `bench/`; a sequência e o custo das medições.
Decisões D-nn e pendências P-n: [11](11-decisoes-e-pendencias.md). Caminhos de destino: seção 2 de
[02](02-arquitetura-alvo.md). Gates de CI e o check `bench-pr` como obrigatório: [07](07-ci-qualidade-seguranca.md).

Convenções: fatos do ny-pi vêm de `origin/main` de `marcioazam/ny-pi` (`e4f8729`, levantamento de 2026-11-20) e fatos
do nycode do worktree de migração. **Proposta** é o que não existe em nenhum dos dois; **não verificado** é o que não
foi conferido nos arquivos; **sem medida** é a dimensão ou o critério sem número hoje. Nada aqui foi executado: nenhum
benchmark, teste ou build rodou, e nenhuma ação de escrita foi feita no GitHub.

## 1. As quatro camadas de prova

- **1. Testes portados**. O que prova: Cada peça migrada mantém o comportamento que o teste do ny-pi fixava. Custo: zero
  (sem modelo). Onde roda: CI, `test (coding-agent)`.
- **2. Contrato com a API falsa**. O que prova: O que o nycode envia ao modelo: ferramentas, system prompt, prefixo em
  cache. Custo: zero. Onde roda: CI ou local.
- **3. Diferenciais**. O que prova: Dois motores dão o mesmo veredito (`guard.py` contra o motor nativo, D-08). Custo:
  zero. Onde roda: CI.
- **4. Benchmark**. O que prova: Acerto, custo, turnos e segurança com modelo real, contra a referência. Custo: US$
  (seção 6). Onde roda: máquina do dono.

As camadas 1 a 3 não gastam modelo e entram nos checks obrigatórios; a 4 só roda no poster local (`bench-pr`) e em F10.

### 1.1 Camada 1: testes portados

Regra do critério global 3 de [00](00-mega-plano.md): todo teste do ny-pi tem um equivalente verde no nycode ou uma
linha em [03](03-mapa-de-migracao.md) que justifica a remoção. Contagem em `origin/main` (padrão
`.test.ts|.test.mjs|test_*.py|test_*.sh|_test.py|conftest.py`, via `git ls-tree`): `extensions` 22,
`claude-home/patches` 25, `claude-home/bin` 22, `claude-home/hooks` 6, `claude-home/skills` 13, `scripts` 5, `bench`
(fora de `suites`) 25.
O formato dos testes do nycode é vitest (`packages/coding-agent/package.json:77`, 4.1.12); os testes `.test.ts` do ny-pi
usam o executor nativo do Node, então a porta troca o executor e os imports de teste para o `vitest`, com as asserções
preservadas (os imports atuais não foram lidos).

**Extensões (22 arquivos, `extensions/`).** Destino: `packages/coding-agent/test/harness/<extensão>/` (02, seção 2) ou
junto da extensão se o código ficar perto de `src/extensions/<nome>/`.

| Grupo no ny-pi | Arquivos | Extensão embutida de destino |
|---|---|---|
| `auto-resume` | 1 | `auto-resume` |
| `bash-timeout` | 1 | ferramenta `bash` do core (K8) |
| `dev-commands` | 2 | `dev-commands` |
| `effort-sandwich` | 1 | `effort-sandwich` |
| `headless-lean` | 1 | `headless-lean` |
| `pi-docs` | 1 | `docs-pointer` (K7) |
| `sticky-prompt` | 1 | `sticky-prompt` (K10) |
| `syntax-check` | 1 | `syntax-check` |
| `todo-sync` | 1 | `todo` (fundida) |
| `ui` | 6 | `ui` |
| `ui-visual` | 5 | `ui-visual` |
| `up-dequeue` | 1 | `up-dequeue` |
| Total | 22 | |

**Patches do pi-code e do pi (`claude-home/patches`, 25 arquivos `.test.ts`).** O patch vira fonte (02, seção 8); o
teste acompanha a extensão que absorveu o patch (02, seção 3.1).

- **`goal`, `goal-lifecycle`**. Arquivos: 2. Destino: `goal`.
- **`notify-focus`**. Arquivos: 1. Destino: `notify`.
- **`rewind-tree`**. Arquivos: 1. Destino: `git-checkpoint`.
- **`statusline-multiline`, `zzzzzzzz-statusline-provider`**. Arquivos: 2. Destino: `status-line`.
- **`todo-collapse`**. Arquivos: 1. Destino: `todo`.
- **`zzzz-plan-done-rule`, `zzzzz-plan-sota`**. Arquivos: 2. Destino: `plan-mode`.
- **`mcp-close-grace` (pi-core)**. Arquivos: 1. Destino: `packages/mcp` (K2, 100 ms).
- **`subagent-nesting`, `subagent-panel/*` (6), `subagent-render`, `team/*` (2), `zz-subagent-respawn`,
  `zzzzzz-subagent-send`, `zzzzzzz-subagent-model-effort/*` (3)**. Arquivos: 15. Destino: `subagent`.
- **Total**. Arquivos: 25.

O patch `cache-warm-identity` (K1) tem teste em `claude-home/bin/tests/cache-warm-identity.test.ts`, contado na linha
de `claude-home/bin` abaixo; o `ci-static` do ny-pi o excluía porque exige o pi-code remendado pelo wrapper. No nycode
a costura K1 é código do core: o teste passa a rodar sem o wrapper e **deixa de ser excluído**.

**`claude-home/bin` (22 arquivos, mais 3 scripts `.sh` de gate).**

- **`tests/*.test.ts` (8: `cache-warm-identity`, `compact-at-400k`, `config/models-example`, `gates/completion-gate`,
  `no-context-files`, `plan-gate`, `prefix-cache-1h`, `sound-notify`)**. Arquivos: 8. Destino ou decisão:
  `test/harness/` (K1, K9, exemplos de config, gates, cache, som); `no-context-files` **some** com a extensão (D-10).
- **`hud/tests` (`.mjs`)**. Arquivos: 4. Destino ou decisão: `resources/statusline/`; dependem do plugin Claude HUD
  (excluídos hoje do CI).
- **`evals/harbor/tests`**. Arquivos: 3. Destino ou decisão: `omp_agent` some (D-26); `pi_harness_agent` e
  `pi_vanilla_api_agent` foram para `bench/tests/harbor/` (F10).
- **`evals/test_plan_ab.py`**. Arquivos: 1. Destino ou decisão: removido em F10 (nada referencia o `plan_ab`; 03 §2.3).
- **`checks/` (`test_check_agents`, `test_skill_usage`)**. Arquivos: 2. Destino ou decisão: `scripts/harness/checks/`.
- **`telemetry/`**. Arquivos: 2. Destino ou decisão: `scripts/harness/telemetry/`.
- **`puxar/test_puxar.py`**. Arquivos: 1. Destino ou decisão: `scripts/harness/puxar/` (extensão
  `import-claude-session`).
- **`structure/test_structure.py`**. Arquivos: 1. Destino ou decisão: `scripts/ci/lint/structure/` (07 §3.5, F10).
- **Total**. Arquivos: 22.
- **`pi-ui-final-gate.sh`, `terminal-sota/{e2e,gate}.sh`**. Arquivos: 3. Destino ou decisão: gates de UI; **não
  verificado** se migram (ver a dimensão "interativo", seção 5.4).

**Hooks Python (`claude-home/hooks`, 6 arquivos).** Vão com os hooks para `resources/hooks/` (02, seção 6):
`dispatch/test_dispatch.py`, `fuzz/test_guard_fuzz.py`, `test_graph_context.py`, `test_guard.py`,
`test_hook_budget.py`, `test_impeccable_gate.py`. São Python e continuam em pytest (`run-static.sh`, `pytest_cov`);
medem o `guard.py` como subprocesso (`patch=subprocess`). `test_guard.py` tem 41 funções `def test_`.

**Outros.** `claude-home/skills` (13 arquivos, incluindo 6 de `atualizador`) acompanham as skills em
`resources/skills/`; os 5 de `scripts` seguem com `scripts/ci/`, exceto `test_install.sh`, que some (02, seção 8).
Os de `bench/` (14 em `tests`, 3 em `contract`, 3 em `faults`, 3 em `metrics`, 1 em `power`, 1 em `tools`, mais
`bench/tools/test_tools.sh`) seguem com a pasta.

**Teste sem red não é prova.** Cada porta de teste registra o vermelho: o mesmo teste, rodado contra o pi 1.6.0 sem a
extensão ou a costura (ou com a mudança revertida), tem de falhar por causa certa antes de passar. Onde o teste não
tem vermelho possível (uma asserção sobre texto fixo copiado), isso entra em `03` como "sem vermelho".

### 1.2 Camada 2: contrato com a API falsa

Já existe no ny-pi, sem modelo e sem rede: `bench/contract/check.py`, `contract_rules.py`, `fake_api.py` e `speed.py`.
Roda o `pi -p` do braço num estágio descartável contra uma API Anthropic falsa que responde por roteiro e captura cada
corpo de requisição (nunca os cabeçalhos). Verificações atuais: inventário de ferramentas e tamanho do system, regras
(`plan_mode_complete` e `question` fora de `-p`), ferramentas básicas (`read`, `write`, `edit`, `bash`, `todo`), plano,
comandos (`/goal`, `/plan`, `/subagents`), skills e MCP. Uso: `python3 bench/contract/check.py --arm ny-pi [--only
regras] [--json]`; exit 0 íntegro, 1 falha, 2 ambiente indisponível; `BENCH_STAGE` reaproveita um estágio.

Para a paridade, três saídas do replay são o contrato (comparadas entre o braço de referência e o `nycode`):

- **Ferramentas expostas**. Como o replay mede: nomes em `tools` de cada requisição (comparados sem diferenciar
  maiúsculas). Hoje: existe.
- **System prompt**. Como o replay mede: tamanho e presença das seções (as instruções embarcadas, K7). Hoje: existe
  (tamanho).
- **Prefixo em cache**. Como o replay mede: o prefixo (system, ferramentas, mensagens até a última marca
  `cache_control`) do turno N é idêntico byte a byte no turno N+1 do mesmo caso. Hoje: **proposta**: o corpo é
  capturado, a regra não existe.

O contrato roda sobre `<stage>/.pi/agent` e `PI_OFFLINE=1`, com `SESSION_PREFIXES = ("PI_", "CLAUDE_", "ANTHROPIC_")`
retirados do ambiente (`check.py`). O braço `nycode` precisa montar `<stage>/.nycode/agent` e usar as variáveis
`NYCODE_*`; o nome da variável equivalente a `PI_OFFLINE` no nycode **não foi verificado**.

A diferença esperada entre braços é de texto (marca, caminhos), nunca de estrutura; um diff do inventário de
ferramentas e do prefixo reprova, o do texto do system exige leitura (seção 8: não comparar por string exata).

### 1.3 Camada 3: diferenciais (D-08)

`guard.py` (799 linhas, D-08) é o único controle técnico de segurança do harness. Ele lê o JSON do hook `PreToolUse`
no stdin e responde nada (permite), `permissionDecision "ask"` ou `"deny"`; o bypass (`PI_BYPASS_PERMISSIONS=1`)
converte todo `ask` em permitido e nunca um `deny`.

Teste diferencial: o corpus de `test_guard.py` (41 testes) e a geração semeada de `fuzz/test_guard_fuzz.py` (PRNG
semeado, orçamento de 2 s por entrada de até 4 KB, sem lançar exceção) alimentam os dois motores (o script e
`core/permissions/`, K11) e comparam o veredito. Critério de D-08, sem folga: mesmo veredito em 100% do corpus e do
fuzz com semente fixa, mais revisão de segurança, antes de `permissions.engine` mudar o padrão de `"script"` para
`"native"`. Se o motor escolhido falhar ao iniciar, a chamada é negada: teste próprio.

O que ainda não está definido: o número de casos dentro de `test_guard.py` (só o de funções, 41), a semente e o número
de
iterações do fuzz usadas como corpus oficial, e se o veredito compara só a decisão ou também a mensagem.
**Proposta:** comparar decisão e categoria, e tratar mensagem como informativa.

A mesma lógica vale para `completion-gate` e `plan-gate` quando virarem nativos: o teste de cada um segue como oráculo.

### 1.4 Camada 4: benchmark

Quatro níveis de custo crescente, descritos nas seções 2 a 7: contrato (camada 2, sem modelo), `bench-pr` por PR
funcional (tier `pr`), nightly e F10 (tier `full`), e o re-teste vanilla (tier `vanilla`).

## 2. Braços do benchmark

`bench/arms.toml` tem hoje 4 braços, todos na mesma conta Claude (o token OAuth é lido em tempo de execução de
`$BENCH_CC_CREDENTIALS` por `bench/arms/oauth-token.sh`, e recusa quando faltam menos de 30 min de validade).

| Braço | Runner | Versão declarada | Como instala |
|---|---|---|---|
| `cc-vanilla` | `run.py` | claude-code 2.1.323 | binário `arms/claude-vanilla`, esforço médio |
| `pi-vanilla` | `run_pi.py` | pi 1.5.2 | `arms/pi-vanilla`: `PI_CODING_AGENT_DIR` vazio, `--thinking medium` |
| `ny-pi` | `run_pi.py` | pi 1.5.2 + pi-code 1.7.0 + este checkout | `arms/ny-pi`: estágio com `HOME` descartável |
| `omp` | `run_pi.py` | omp 18.20.0 | **não migra** (D-26) |

### 2.1 Como o braço `ny-pi` instala hoje

`bench/arms/ny-pi` monta um estágio em `${BENCH_STAGE_ROOT:-~/.cache/bench}/bench-nypi-<sha12>[-dirty]`:

1. `ln -s` de `~/.pi/agent/install` e `~/.pi/agent/bin` do dono para o estágio.
2. `npm ci --ignore-scripts` de `npm/package.json` e `package-lock.json` do checkout (pi-code "limpo", nunca a cópia
   viva com patches locais).
3. Camada do dono (`overlay.list`) copiada para o estágio; o hash vai para `.overlay-sha`.
4. `HOME=<estágio> bash install.sh --link --apply` e um `pi --version` de aquecimento (o `bin/pi` aplica patches no
   primeiro uso; uma execução real sem isso quebrou em 2026-11-13).
5. `.ready` marca o estágio pronto; depois `exec pi "$@"` com `HOME=<estágio>`.

Também fixa `MISE_*` no `HOME` real (os shims do mise recusam o `HOME` do estágio) e aceita o modo chave de API
(`BENCH_API_KEY_FILE`, `BENCH_ANTHROPIC_WORKSPACE_ID`).

### 2.2 Novo braço `nycode` (implementado em F3, `bench/arms/nycode`)

O nycode não tem instalador, patch nem wrapper; o braço passa a construir o monorepo e rodar o binário:

1. Estágio `bench-nycode-<sha12>[-dirty]` com `HOME` descartável e `NYCODE_CODING_AGENT_DIR=<estágio>/.nycode/agent`
   (a variável já existe: 02, seção 5).
2. `npm ci --ignore-scripts` e `npm run build` na raiz do checkout (o `ci.yml` do nycode roda esses dois comandos; o
   comando que gera o executável `nycode` a partir de `build-binaries.sh` ou `build-coding-agent-bundle.mjs` e o caminho
   de saída **não foram verificados**).
3. Camada do dono: `settings.json` e `AGENTS.md` de `~/.nycode/agent` (substitui `settings.json`, `local.env` e
   `claude-home/rules/personal.md`; `local.env` some, 02 seção 5). `vendor/pi-lsp` some (extensão `lsp`, F9) e
   `vendor/ponytail` vira pacote opcional (02, seção 7). Lista exata: **proposta**, por decidir em F3.
4. Aquecimento: `nycode --version` com o `HOME` do estágio.
5. Saída com `exec` para o executável, com as flags de avaliação do runner. As flags `--settings`, `--mcp-config`,
   `--setting-sources`, `--add-dir` e `--strict-mcp-config` hoje são entendidas só pelo pi-code (o braço `pi-vanilla`
   as descarta); no nycode dependem da extensão `settings-flags` (F5). **Não verificado** se o conjunto é o mesmo.

**Decidido em F3** (o que ficou diferente da proposta acima):

- O build é o do `ci.yml`: `npm ci --ignore-scripts` e `npm run build` na raiz do checkout; o executável é
  `packages/coding-agent/dist/bundle/cli.js` (campo `bin` de `packages/coding-agent/package.json`; `build` roda
  `build-coding-agent-bundle.mjs`). O binário compilado de `build:binary` (bun) não entra.
- Lista da camada do dono (`bench/arms/overlay-nycode.list`): `settings.json` e `AGENTS.md`, lidos de `~/.nycode/agent` ou de
  `BENCH_OVERLAY_DIR`. `local.env` some, `vendor/pi-lsp` volta como extensão `lsp` (F9) e `vendor/ponytail` vira pacote
  opcional; nenhum dos dois é copiado. `auth.json` e `models.json` nunca entram no hash.
- Estágio `bench-nycode-<sha12>[-dirty]` (campo `stage_prefix` do `arms.toml`); `meta.json` leva `overlay_sha` como nos braços ny-pi.
- As flags só do pi-code (`--settings`, `--mcp-config`, `--setting-sources`, `--add-dir`, `--strict-mcp-config`) são descartadas
  pelo braço até a extensão `settings-flags` (F5), como no `pi-vanilla`. Continua **não verificado** se o conjunto é o mesmo.
- Agente Harbor do nycode (S2, S3, S6): **implementado** em `bench/harbor/nycode_agent.py` (`NycodeAgent`) e `bench/harbor/bundle.sh`
  (detalhe abaixo); `_harbor_step` deixou de parar o braço. Substitui a decisão anterior de parar com erro explícito.
- Runner do `pi` (decisão do dono em F3): mantida a skill `pelo-em-ovo`, localizada por `BENCH_PELO_RUN_PI`; nada é copiado
  para `bench/`. A saída da skill de `claude-home` em F8 obriga a apontar a variável para a nova origem (ou copiar o
  `run_pi.py` então). `BENCH_EVALS_RUN` segue igual.

Dependências do `bench/` fora do repositório, que a migração não move (nem 02 nem 00 as colocam no destino):
`BENCH_EVALS_RUN` (padrão `~/.claude/evals/run.py`) e `BENCH_PELO_RUN_PI` (padrão
`~/.pi/agent/claude-home/skills/pelo-em-ovo/scripts/run_pi.py`) em `bench/runners.py`. O runner de `pi` recebe o
binário em `PELO_PI_BIN`. Decisão do dono em F3: copiar o `run_pi.py` para `bench/` ou manter a skill (a skill
`pelo-em-ovo` sai de `claude-home` em F8). Por enquanto, **não verificado** o que o `run_pi.py` assume sobre o
diretório de configuração do `pi`.

O Harbor (S2, S3, S6) usa um agente dentro do contêiner. O do ny-pi é `claude-home/bin/evals/harbor/pi_harness_agent.py`, que
instala `~/.pi/agent` e o wrapper a partir de um `bundle.sh`. O do `nycode` é o agente irmão `bench/harbor/nycode_agent.py`
(`-a nycode_agent:NycodeAgent`, `PYTHONPATH=bench/harbor`), subclasse do agente `Pi` do Harbor como o do ny-pi (flags
`--print --mode json --session-dir`, trajetória e custo herdados; o nycode mantém esse contrato):

- **Pacote** (`bench/harbor/bundle.sh`, `HOME=<estágio do braço>`, saída por rodada em `<rodada>/nycode-harness-bundle.tgz`, variável
  `NYCODE_HARNESS_BUNDLE`): a camada do dono do estágio (só os arquivos de `bench/arms/overlay-nycode.list`, nunca `auth.json` nem
  `models.json`) em `.nycode/agent`, e o runtime do checkout em `.local/lib/nycode`: `package.json`, `dist/bundle` (o `cli.js` e os
  chunks do `npm run build`), `dist/modes/interactive/{theme,assets}`, `dist/core/export-html`, `docs`, `examples`, `README.md`,
  `CHANGELOG.md` e `node_modules/{jiti,@silvia-odwyer/photon-node}`, os dois únicos pacotes que `build-coding-agent-bundle.mjs` deixa
  externos além de opcionais nativos. Verificado em cópia isolada (`git archive` + `npm ci --ignore-scripts` + `npm run build`,
  bundle de 6,8 MB): `node .local/lib/nycode/dist/bundle/cli.js --version` imprime `1.6.0` e `--list-models` roda, sem nenhum
  `node_modules` acima do pacote. O script falha sem `dist/bundle/cli.js` ou sem os dois pacotes e confere que nenhum caminho de
  credencial entrou.
- **Contêiner**: `install()` garante `curl` e `tar` (root; o nycode não precisa de `python3` nem `patch`), extrai o pacote em
  `/opt/nycode-home`, instala o Node com `nvm` (o mesmo trecho com tentativas do agente do ny-pi) e roda `--version` e `--help` (aquece o cache de compilação).
  A execução é `node /opt/nycode-home/.local/lib/nycode/dist/bundle/cli.js --print --mode json ...` com
  `HOME=/opt/nycode-home`, `NYCODE_CODING_AGENT_DIR=/opt/nycode-home/.nycode/agent` e `NYCODE_SKIP_VERSION_CHECK=1` (as variáveis do
  braço local). Token: `ANTHROPIC_OAUTH_TOKEN`; no modo de chave de API, `ANTHROPIC_WORKSPACE_ID` entra em `models.json`.
- **Diferença para o braço local**: o local usa `--no-session` e lê o stdout; o Harbor precisa do `--session-dir` para a trajetória, como no ny-pi.
- **Não verificado**: uma tarefa real do Terminal-Bench no contêiner (nenhuma rodada foi feita, nenhum custo); o `harbor run --dry-run`
  só valida a carga do agente. Se o nycode troca o formato de sessão do pi, o custo e os turnos do S2 saem vazios (o
  `parse_harbor_job` marca isso como erro de infraestrutura).

### 2.3 Braço temporário `ny-pi@1.6.0` (D-25)

D-25: antes de migrar código, medir o ny-pi **por fora** sobre o pi 1.6.0 para separar o efeito da base do efeito da
migração. É o mesmo `bench/arms/ny-pi` com a versão do `pi` trocada; `arm_version` passa de `1.5.2` para `1.6.0`.
Entradas, todas **propostas**:

- A origem do pi 1.6.0 no estágio (o `arms/ny-pi` aponta o `~/.pi/agent/install` do dono, que hoje é 1.5.2).
- O `meta.json` da rodada leva `arm: ny-pi`, `arm_version: 1.6.0`; o nome do diretório da rodada distingue (por
  exemplo `ny-pi-1.6.0`), para não ser confundido com a baseline guardada em `docs/bench/baseline-main/`.
- O braço some quando F10 fecha; `docs/bench/baseline-main/` passa a ser do braço `nycode`.

**Implementado em F3** (`ny-pi-pi160` em `bench/arms.toml`): o mesmo `bin` `arms/ny-pi`, com `BENCH_PI_VERSION=1.6.0` (tabela
`env`) e estágio próprio `bench-nypi160-<sha12>`; o `meta.json` leva `arm: ny-pi-pi160`. O script se recusa a montar o estágio
se o `current-version` de `BENCH_PI_INSTALL_DIR` (padrão `~/.pi/agent/install`) não for 1.6.0. Falta, para a rodada real,
uma instalação gerenciada do pi 1.6.0 (ver o relatório da unidade). A simulação sem custo roda; a rodada não foi feita.

A referência guardada atual (`baseline-main`) foi medida com `arm_version 1.5.2` e `overlay_sha c06e62526c0540fe`
(`docs/bench/baseline-main/meta.json`); por D-14 ela vale como histórico, mas **não** como referência de paridade do
nycode, que é pi 1.6.x.

### 2.4 Comparabilidade entre braços (lacuna)

`stats.META_KEYS = ("model", "arm_version", "overlay_sha")`: se qualquer um difere entre a base e o candidato, o gate
devolve `NOT_COMPARABLE` (exit 4). Um round do `nycode` contra um round do `ny-pi@1.6.0` difere em `arm_version` e
`overlay_sha` (os arquivos de camada são outros), então `bench gate` devolveria `NOT_COMPARABLE` por construção. O
`arm` não está em `META_KEYS`, então o nome do braço não bloqueia.

**Implementado em F3 (D-28)** (`bench gate --parity`): um modo de paridade (`bench gate --parity`) que ignora
`arm_version` e `overlay_sha`, mantém `model` e `jobs`, e grava no `verdict.json` a lista de chaves ignoradas.
Alternativa menor: o `nycode` e a referência declaram o mesmo `arm_version` (`1.6.0`) e o mesmo `overlay_sha` por uma
camada de dono convertida de uma só origem, o que exige as duas camadas terem conteúdo idêntico (improvável, porque as
camadas diferem em arquivos).

## 3. Operação: variáveis, units, `bench-pr.sh`

### 3.1 O que renomear

- **Arquivo de ambiente**. De: `~/.config/ny-pi/bench.env`. Para: `~/.config/nycode/bench.env` (modo 0600).
- **`bench-pr.service`**. De: `EnvironmentFile=%h/.config/ny-pi/bench.env`. Para: `%h/.config/nycode/bench.env`.
- **`bench-nightly.service`**. De: **não verificado** se usa o mesmo arquivo. Para: idem, se usar.
- **`BENCH_REPO`**. De: `marcioazam/ny-pi` (obrigatória). Para: `marcioazam/nycode`; a URL padrão deriva dela.
- **Cache do CI local**. De: `~/.cache/ny-pi-ci`. Para: `~/.cache/nycode-ci` (07, seção 7).
- **Overlay**. De: `bench/arms/overlay.list`. Para: nova lista (seção 2.2); `overlay-sha.sh` não muda (recebe o
  diretório e a lista).
- **Estado e cache**. De: `~/.local/state/bench`, `~/.cache/bench`. Para: iguais (não citam o ny-pi).

Variáveis `BENCH_*`, que continuam com o mesmo nome (02, seção 5: "iguais"): `BENCH_REPO`, `BENCH_CC_CREDENTIALS`,
`BENCH_BASELINE_MAIN`, `BENCH_STATE`, `BENCH_API_KEY_FILE`, `BENCH_ANTHROPIC_WORKSPACE_ID`, `BENCH_OVERLAY_DIR`,
`BENCH_STAGE`, `BENCH_STAGE_ROOT`, `BENCH_OUT`, `BENCH_JOBS` (padrão 4), `BENCH_MIN_FREE_GB` (padrão 30),
`BENCH_EXTEND_*`, `BENCH_PR_EXT_BUDGET` (padrão 6), `BENCH_NIGHTLY_BUDGET` (padrão 30), `BENCH_EVALS_RUN`,
`BENCH_PELO_RUN_PI`, `BENCH_HARBOR`. A lista vem de `bench/run.py`, `runners.py`, `tools/*.sh` e do RUNBOOK; as demais
variáveis do env file do RUNBOOK (truncadas na leitura) **não foram conferidas**.

Units (`bench/tools/systemd/`): `bench-pr.timer` (`OnBootSec=2min`, `OnUnitActiveSec=10min`, `Persistent=true`),
`bench-pr.service` (oneshot, `Slice=build.slice`, `TimeoutStartSec=90min`, `ExecStart=%h/.local/bin/bench-pr.sh
--poll`),
`bench-nightly.timer` (`OnCalendar=*-*-* 03:30:00`) e `bench-nightly.service` (`TimeoutStartSec=6h`). Instalação:
`install -m 755 bench/tools/{bench-pr,bench-nightly,vanilla-retest}.sh ~/.local/bin/`, units em
`~/.config/systemd/user` e `systemctl --user enable --now bench-pr.timer bench-nightly.timer` (RUNBOOK).

### 3.2 `bench-pr.sh`: repositório alvo e D-21

`REPO=${BENCH_REPO:?...}`; `URL` padrão `https://github.com/$REPO.git`; `MODEL` padrão `claude-sonnet-5-5`; teto
`BUDGET` 12 e `EXT_BUDGET` 6; trava `flock` em `$STATE/lock`; repositório bare em `$STATE/repo`; árvore descartável do
head do PR; status `pending`, depois `success`, `failure` ou `error` por `bench/run.py post-status`; falha fechada.
Só entram PRs abertos do mesmo repositório e do dono, e heads sem `bench-pr` final (RUNBOOK, "Fluxo do PR"). Muda para
o nycode: `BENCH_REPO`, `--arm nycode` no lugar de `--arm ny-pi` e a ordem de gatilho de 07 (seção 2.4, proposta).

**D-21** (`bench-pr` em mudança não funcional): o verificador publica `success` com a descrição "não funcional, sem
rodada". A classificação é `bench/classify/affects.py`, que falha fechada (qualquer caminho não provado não funcional
conta como funcional). Hoje ela lê a lista de caminhos do ny-pi e o `publish.list`, que some (02, seção 8). Os caminhos
que ela já trata como não funcionais: `docs/*`, `.github/*`, `.githooks/*`, `scripts/ci/*`, `scripts/check-*`,
`bench/*`, `claude-home/bin/evals/*` (menos `bundle.sh`), licença e dotfiles, testes (`*.test.ts`, `test_*.py` etc.) e
os de UI pura (`themes/*`, `extensions/ui/*`, `extensions/ui-visual/*`, `claude-home/bin/hud/*`, outros).

**Lista proposta de caminhos não funcionais no nycode** (nada disto existe no código; a regra continua fechando para
funcional o que não consta):

| Grupo | Padrões (proposta) |
|---|---|
| Documentação | `docs/**`, `**/*.md` fora de `packages/coding-agent/resources/**`, `packages/*/docs/**` |
| Repositório | `.github/**`, `.husky/**`, `scripts/ci/**`, `scripts/check-*`, `bench/**`, licença e dotfiles |
| Testes | `packages/*/test/**`, `**/*.test.ts`, `**/*.test.mjs`, `**/test_*.py` |
| Fora dos gates (D-23) | `apps/**` |
| UI pura | `resources/themes/**`, `resources/statusline/**`, `src/extensions/{ui,ui-visual,footer,sticky-prompt}/**` |

Ficam funcionais, de propósito: `packages/*/src/**` (menos os de UI pura acima), `packages/tui/**`, tudo em
`resources/{agents,skills,commands,rules,instructions,hooks}/**` (são prompts), `package.json` e
`package-lock.json` (mudam dependência) e o campo `files` do pacote (substitui o `publish.list`). A reescrita de
`affects.py` para ler o `files` de `package.json` em vez de `publish.list` é parte da F3; seu desenho e o teste (hoje
`bench/tests/classify/test_affects.py`) **não foram escritos**.

## 4. Fixtures de `bench/suites`

`git ls-tree -r origin/main bench/suites` lista **788 arquivos**: `hard` 577, `multi` 113, `plan` 94 e 4 soltos
(`README.md`, `check_oracles.py`, `conftest.py`, `test_check_oracles.py`). Os 784 dos casos são insumos do agente
(`repo/`, `hidden/`, `oracle/`), rodam em diretórios descartáveis e são validados por
`bench/suites/check_oracles.py` (sem a solução o teste falha; com o oráculo passa). Contam por suíte: `plan` 12 casos,
`multi` 10 e `hard` 12 (diretórios de primeiro nível).

Estado atual no ny-pi (`run-static.sh`): o regex `^bench/suites/[^/]+/[^/]+/(repo|hidden|oracle)/` tira os arquivos de
tipagem (`mypy`), cobertura e mutação, mas o `ruff` ainda os lint; o `structure_changed.py` não tem exclusão nas
linhas lidas (1 a 100), então só o fato de o legado nunca bloquear os poupava.

**Proposta** no nycode (D-06 inclui `bench/` na lista de código próprio, então sem exclusão a importação de 788 arquivos
estouraria os limites de 800 linhas e de 7 arquivos por diretório): excluir o regex acima do `structure_changed.py` e do
`ruff`, do `markdownlint` e do `diff-cover`, e manter `check_oracles.py` (e seu teste) como validação compensatória,
no `ci-static`. Os 4 arquivos soltos seguem as regras normais. O Biome do fork não os alcança, porque `biome.json`
(`files.includes`) lista só `packages/*`, `scripts/model-catalog-protocol*` e exemplos.

<a id="criterio-de-paridade"></a>

## 5. Critério de paridade

Este critério é o que o critério global 4 de [00](00-mega-plano.md) e a saída de F10 citam. O gate de benchmark já
existe e já é regra do dono ("Precisa", decisão de 2026-11-13, RUNBOOK); o plano **adota a mesma regra** para a
paridade e não inventa limite novo, exceto o que está marcado "proposta".

### 5.1 Regra numérica (constantes reais)

Constantes de `bench/stats.py` (linhas 34 a 46) e `bench/gate.py`:

| Constante | Valor | Papel |
|---|---|---|
| `MARGIN` | -0,10 | Não inferioridade de acerto, em 10 pontos percentuais |
| `ALPHA`, `N_BOOT`, `SEED` | 0,10; 10 000; 20261113 | IC bilateral de 90%, BCa, bootstrap pareado por tarefa |
| `COST_MAX`, `TURNS_MAX` | 1,10; 1,10 | Teto da mediana das razões por tarefa (candidato ÷ base) |
| `ALPHA1`, `COST1`, `TURNS1` | 0,01; 1,05; 1,05 | Olhar 1 do gate sequencial (decisão de 2026-11-18) |
| `SEC_CONFIRM_REPS` | 6 | Repetições de um caso de segurança antes de uma falha deixar de ser ruído |
| `MAX_EXCLUDED` | 0,10 | Acima disso o veredito é `NOT_VERIFIED` |
| `META_KEYS` | `model`, `arm_version`, `overlay_sha` | Diferença entre base e candidato dá `NOT_COMPARABLE` |
| `EXTEND_REPS`, `LOOK2_REPS`, `K1_SUITES` | 3; 2; `("s2",)` | Extensão e olhares do gate (`gate.py`) |

Regra de paridade, por unidade de comparação (a unidade é a tarefa, pareada entre o `nycode` e a referência):

1. **Acerto:** diferença pareada de taxas por tarefa, IC bilateral de 90%. PASS se o limite inferior é maior que
   -10 pp; FAIL se o limite superior é menor que -10 pp; senão INCONCLUSIVE, com extensão única de +3 repetições nas
   tarefas discordantes. Fronteira exata é INCONCLUSIVE (arredondamento a 9 casas).
2. **Custo:** mediana das razões por tarefa menor ou igual a 1,10 (`stats.py:34`; aplicada em `verdict`).
3. **Turnos:** idem, 1,10.
4. **Segurança:** nenhuma regressão confirmada nos casos `sec-*` do S1 (3 repetições por padrão no olhar 1; duas
   falhas em 6 confirmam).
5. **Tempo de parede:** só informativo (decisão de 2026-11-15, `stats.py`); a razão aparece, não decide.
6. **Elegibilidade:** metas iguais (`META_KEYS`) e no máximo 10% de tarefas excluídas.

No olhar 1 (PR) as mesmas regras valem com `ALPHA1 = 0,01` e `COST1 = TURNS1 = 1,05` só para aprovar cedo; só PASS
exige 1,05. Simulação registrada no código: o gate sequencial aprova PR inalterado em 98%, reprova queda real de
-10 pp em 96% e de -15 pp em 100%, com cerca de 146 execuções por PR (a regra antiga aprovava 41% dos PRs inalterados
e bloqueava -10 pp em 97%). O RUNBOOK diz que **não houve rodada real** do gate sequencial; a simulação é offline.

**Margem de custo.** O código tem margem de custo: a razão de 1,10 (`COST_MAX`) e a de 1,05 no olhar 1 (`COST1`), em
`stats.py`. O que **não existe**: nenhuma constante de custo em `gate.py` (que só tem extensão e olhares); nenhum limite
em dólares absolutos; nenhuma margem própria para o tier `full`; nenhuma medida do ruído de custo entre duas
rodadas idênticas do novo braço (o RUNBOOK registra um A/A de 2026-11-14 para turnos, 1,285 contra 0,998 pareado).
**Proposta:** (a) usar a mesma razão de 1,10, e para F10 aplicá-la também à razão das somas de custo, como informativa;
(b) medir em F3 um A/A do `ny-pi@1.6.0` contra ele mesmo e só então fixar uma margem de custo própria do F10, se o A/A
mostrar ruído acima de 1,10. Sem esse A/A, "custo por tarefa não pior além da margem" tem como número só o 1,10 herdado.

### 5.2 Tiers: smoke por PR, full por fase

`bench/suites.toml` tem os tiers `pr`, `baseline`, `full`, `tb41`, `vanilla` e `hard`. Não existe um tier `smoke`: o
critério de saída de F3 em [00](00-mega-plano.md) escreve `bench run --arm nycode --tier smoke`. **Decisão (D-27,
F3):** `smoke` é um apelido do `pr`, sem passos próprios: `[tier.smoke] alias = "pr"` em `bench/suites.toml`, resolvido por
`run.py` antes de montar o plano. A rodada, o `meta.json` (`tier`), o nome do diretório e o gate sequencial (que reconhece
`tier == "pr"`) veem `pr`; `--tier smoke` e `--tier pr` imprimem o mesmo plano.

- **`pr` ("smoke")**. Unidades: S1 `pr_cases` (16: 8 de segurança em k3, 8 em k1), S4 (12), S5 (10), S2 (4 do TB2), k1.
  Quando: por PR funcional.
- **`baseline`**. Unidades: as mesmas 42 unidades em k12 (S2 em k4). Quando: regrava `baseline-main`.
- **`full`**. Unidades: S1 (32 casos, k3), S4 e S5 (k3), S2 (77 do TB2, k1), S3 (`n=50`), S6 (6, k1). Quando: F10 e
  nightly.
- **`vanilla`**. Unidades: as unidades do `pr` em k2 (S2 em k1). Quando: re-teste dos vanilla.
- **`hard`**. Unidades: S8 (12 casos, k3). Quando: sob demanda (comparação de ablações).
- **`tb41`**. Unidades: S6 (6 tarefas do TB 4.1). Quando: sob demanda.

Contagens vindas de `suites.toml` (por `tomllib`: `s1.cases` 32, `s1.pr_cases` 16) e de `bench/tasks/*.json` (TB2: 89
tarefas, 12 excluídas, 77 usadas, 27 em `heldout`; TB 4.1: 6 de 6; SWE-bench Pro: 20, 1 excluída, 19 usadas, 6 em
`heldout`). O `full` pede `n = 50` em S3, mas o arquivo de tarefas só tem 19 utilizáveis; `sample_tasks` usa
`pool[:n]`, então o `full` roda 19. "Full por fase" em [00](00-mega-plano.md) é interpretado aqui como: `full` em F10 e
no nightly (seção 6); o `full` a cada fase custa cerca de US$ 86 estimados por braço (seção 6) e fica **sob decisão do
dono**, não é adotado.

### 5.3 As 11 dimensões do dono

Cada dimensão tem uma medida disponível, ou "sem medida". F10 fecha as 11 quando cada uma tem o número do `nycode`
contra a referência ou a declaração "sem medida" assinada pelo dono (criterio de saída de F10 em 00).

- **1**. Dimensão: Confiabilidade. Medida disponível: pass^k (tarefas com k >= 2), taxa de oscilação, p90 de custo e
  tempo, timeouts. Fonte: `bench/metrics/README.md`.
- **2**. Dimensão: Honestidade. Medida disponível: falso sucesso, "declarado com ressalva", desistência honesta;
  classificador por regra. Fonte: `bench/metrics`.
- **3**. Dimensão: Custo. Medida disponível: mediana das razões por tarefa; `COST_MAX` 1,10. Fonte: `stats.py:34`.
- **4**. Dimensão: Contexto. Medida disponível: acerto de cache, tokens da primeira requisição, tokens por execução
  resolvida; prefixo (camada 2). Fonte: `bench/metrics`, `bench/contract`.
- **5**. Dimensão: Velocidade. Medida disponível: inicialização, tempo de modelo e de ferramenta; razão de parede
  (informativa). Fonte: `bench/metrics/trace.py`.
- **6**. Dimensão: Autonomia. Medida disponível: pergunta ao usuário na mensagem final; pendência declarada. Fonte:
  `bench/metrics`.
- **7**. Dimensão: Robustez. Medida disponível: injeção de falha sem modelo: 429, 529, corte no meio do fluxo, primeiro
  byte lento (e outros). Fonte: `bench/faults`.
- **8**. Dimensão: Segurança. Medida disponível: casos `sec-*` do S1 em k3; regra de segurança do gate; diferencial do
  `guard`. Fonte: `suites.toml`, seção 1.3.
- **9**. Dimensão: Qualidade e dano colateral. Medida disponível: casos `quality-*` do S1; **sem medida** de alteração
  fora do escopo pedido. Fonte: `suites.toml`.
- **10**. Dimensão: Generalização. Medida disponível: divisão `heldout` (30% por suíte, semente 20261113) e conjuntos
  externos (TB2, SWE-bench Pro, TB 4.1). Fonte: `tasks/*.json`.
- **11**. Dimensão: Interativo. Medida disponível: **sem medida** no bench: runners e contrato usam `-p` (modo sem
  interface). Fonte: seção 5.4.

Dimensão 7: o README de `bench/faults` lista os cenários e foi lido só nas primeiras linhas (quatro cenários);
o total **não foi conferido**. Dimensão 9: a busca por "colateral" achou só
`claude-home/docs/pi-subagent-send-2026-11-13.md`;
o significado de "colateral" para o dono não está medido em nenhum arquivo lido. Dimensão 3 e 5: as razões
(custo, turnos, tempo) são pareadas por tarefa, só decidem custo e turnos.

O registro do dono que define as 11 dimensões (a "Full evaluation" do follow-up record citada em
`bench/metrics/README.md`) **não foi lido**; a lista acima segue o enunciado desta frente, e as 11 linhas se apoiam no
que `bench/metrics` e `bench/faults` calculam hoje.

### 5.4 Dimensão 11 e o modo interativo

O bench inteiro roda sem interface: `arm_cmd` monta `-p --output-format stream-json`. O ny-pi tem scripts de gate
interativo que o bench não chama: `claude-home/bin/tests/pi-ui-final-gate.sh` e `terminal-sota/{e2e,gate}.sh`
(cobertura de 80% por linha nos arquivos listados). Não foram executados nem lidos por inteiro. **Proposta:** a
dimensão 11 entra em F10 com esses gates portados como verificação por lista (sim/não), não como pontuação.

### 5.5 Meta de certeza maior que 80% e tamanho de amostra

O que o código diz (sem rodar): `bench/power/sim.py` e `bench run power` simulam o poder da alegação "à frente"
(superior),
não o da não inferioridade; prior Beta(0,5; 0,5), 2 000 simulações por célula (`N_SIMS`), `DEFAULT_KS "1,2,3"`,
`DEFAULT_NS "24,49,73"`, `DEFAULT_DELTAS "0,0.03,0.05,0.08"`. Resultados do RUNBOOK ("Poder (#76)"), a partir das 42
tarefas
do ny-pi e do `cc-vanilla` (k aproximado de 1,8):

- Modelo B (prior de cada braço por máxima verossimilhança): o ganho alcançável é +4,7 pp (o alvo de +8 pp é
  inalcançável: o ny-pi já acerta quase tudo). Com n = 73 e k = 3, poder de 0,97 (P >= 0,80) e 0,85 (IC90 > 0); o menor
  desenho com os dois critérios >= 0,80 é n = 100, k = 1.
- Modelo anterior (Beta fixo): +8 pp com n = 73, k = 3 dá 0,87 e 0,65 (os dois critérios juntos **não** chegam a 80%); o
  menor desenho com os dois >= 0,80 é n = 150, k = 2.
- Falso positivo com ganho zero: 0,15 a 0,21 para "à frente"; no máximo 0,07 para IC90 > 0.

Para a **paridade** (não inferioridade em 10 pp), o número é o da simulação do gate sequencial em `stats.py`: reprovar
queda real de -10 pp em 96% (acima de 80%) e aprovar PR inalterado em 98%. Para quedas menores que 10 pp (por exemplo
-5 pp) **não há medida de poder**. O plano **não afirma** certeza acima de 80% para diferenças pequenas: só para a faixa
-10 pp a -15 pp, e com o desenho de 42 tarefas. Tamanho de amostra do F10: as unidades do `full` com k = 1 em S2, S3 e
S6 dão poucas repetições por tarefa; o poder desse desenho **não foi simulado** (proposta: rodar `bench run power` com o
`full` de F3 antes de F10).

## 6. Sequência de medições e custo

Fila única na conta `claude`: o `flock` em `$STATE/lock` do `bench-pr.sh` também protege `bench-nightly.sh` e
`vanilla-retest.sh` (RUNBOOK, "Fluxo do PR"), e a regra "integre a `main` e rode o gate do PR seguinte só depois do
merge do anterior" (2026-11-18) evita `base_moved`. Modelo padrão `claude-sonnet-5-5`.

Custo estimado = soma de `est_cost_usd` de `suites.toml` por execução (s1 0,09; s2 0,30; s3 1,50; s4 0,12; s5 0,12;
s6 3,00; s8 0,60), na calibração de 2026-11-14 (média do piloto do ny-pi mais 25% de folga; o S3 e o S6 não foram
pilotados). Só entra no `bench run --dry-run` e na checagem de orçamento. Não inclui as sobreposições `reps` por caso
(`suites.toml`, não lidas); por isso é uma estimativa e não um orçamento.

- **F3**. O que roda: `ny-pi@1.6.0`, tier `baseline` (grava a base do gate). Cálculo: 16x12x0,09 + 12x12x0,12 +
  10x12x0,12 + 4x4x0,30. Estimado (US$): 53,76.
- **F3**. O que roda: `ny-pi@1.6.0`, tier `full` (referência de paridade). Cálculo: 32x3x0,09 + 12x3x0,12 + 10x3x0,12 +
  77x0,30 + 19x1,50 + 6x3,00. Estimado (US$): 86,16.
- **F3**. O que roda: `nycode`, tier `pr` (critério de saída de F3, com alias `smoke`). Cálculo: 32x0,09 + 12x0,12 +
  10x0,12 + 4x0,30. Estimado (US$): 6,72.
- **F5 a F9**. O que roda: por PR funcional, tier `pr` no braço `nycode`. Cálculo: igual à linha acima, por PR. Estimado
  (US$): 6,72 por PR.
- **F10**. O que roda: `nycode`, tier `full`. Cálculo: igual ao full do F3. Estimado (US$): 86,16.
- **F10**. O que roda: `nycode`, tier `baseline` (regrava `baseline-main`). Cálculo: igual ao baseline do F3. Estimado
  (US$): 53,76.
- **F10**. O que roda: `pi-vanilla` e `cc-vanilla`, tier `vanilla` (D-14, uma vez). Cálculo: 2 x (32x0,09 + 12x2x0,12 +
  10x2x0,12 + 4x0,30). Estimado (US$): 18,72.

Totais estimados: F3 = 53,76 + 86,16 + 6,72 = 146,64; F10 = 86,16 + 53,76 + 18,72 = 158,64; F5 a F9 = 6,72 por PR
funcional, mais a extensão (teto `BENCH_PR_EXT_BUDGET` 6) quando o olhar 1 não decide. O S1 no tier `pr` usa 32
execuções
(8 casos de segurança em k3 e 8 em k1); sem as sobreposições `reps`.

Referências reais, para comparar com a estimativa: a baseline `ny-pi` k12 de `docs/bench/baseline-main/meta.json`
(2026-11-18, `tier: baseline`, 42 tarefas, teto US$ 60) custou **US$ 17,43**, cerca de um terço dos 53,76 estimados; o
baseline vanilla de 2026-11 (76 execuções de Sonnet por braço) custou US$ 5,57 (`cc-vanilla`), 2,10 (`pi-vanilla`),
7,54 (`omp`) e 7,06 (`ny-pi`). Os valores de `est_cost_usd` portanto **superestimam** o `tier baseline`; a causa (folga
de 25%, caso curto, `reps` por caso) **não foi investigada**. O tempo de parede não está estimado: o comentário do
`suites.toml` diz que o k3 com 77 mais 50 tarefas levou mais de 12 h e que o `pr` cabe em cerca de 1 h; as tarefas
Harbor chegam a 28 min.

**Ordem e passos.**

- **F3**. Medição: Referência `ny-pi@1.6.0` (tiers `baseline` e `full`) e `nycode` em `pr`. Observação: Separa efeito da
  base de efeito da migração (D-25); A/A de custo (seção 5.1).
- **F5**. Medição: `pr` por PR funcional. Observação: Hooks, todo, question e o resto da camada base.
- **F6**. Medição: `pr` por PR funcional mais S4 e S5 em k3 (os dois que exercitam plano e frota). Observação:
  Subagente, plano e `goal` mudam o laço; S4/S5 já estão no `pr` em k1. **Proposta**.
- **F7**. Medição: `pr` por PR funcional.
- **F8**. Medição: `pr` mais S1 de segurança em k3 e o diferencial do `guard` (seção 1.3). Observação: Permissões e
  recursos.
- **F9**. Medição: `pr` por PR funcional. Observação: `lsp`: **sem suíte específica** no bench.
- **F10**. Medição: `full`, `baseline` e `vanilla`. Observação: D-14: re-medição única dos vanilla.

**Risco do nightly.** O `bench-nightly.sh` roda o tier `full` com teto padrão de 30 (`BENCH_NIGHTLY_BUDGET`), abaixo dos
cerca de US$ 86 estimados por braço; o `full` pode não caber no teto e dar `NOT_VERIFIED` ("orçamento esgotado").
Durante
a migração o nightly só roda se o dono ajustar o teto; **decisão do dono** (o nightly nunca atualiza a baseline: só
imprime o comando do PR de atualização).

## 7. Nova linha de base e relatório de paridade

### 7.1 `docs/bench/baseline-main`

Conteúdo atual (ny-pi): `meta.json`, `runs.jsonl`, `verdict.json`. O `meta.json` guarda `arm`, `arm_version`, `model`,
`git_sha`, `started`, `budget_usd`, `overlay_sha`, `tier`, `jobs`, `not_verified`, `errors`, `cost_usd` e
`dropped_infra_rows`. A `baseline-main` de 2026-11-18: `arm ny-pi`, `arm_version 1.5.2`, `model claude-sonnet-5-5`, tier
`baseline`, 6 jobs, teto US$ 60, custo US$ 17,43, `overlay_sha c06e62526c0540fe` (corrigido em 2026-11-15 para o locale
C), 2 linhas de infraestrutura descartadas. O `verdict.json` do baseline contra ele mesmo é PASS com n = 42.

**Procedimento** (RUNBOOK, "Tier baseline" e "NOT_COMPARABLE"), com o braço `nycode`:

1. Congelar a camada do dono: `. bench/arms/overlay-sha.sh; overlay_freeze ~/.nycode/agent <destino>
   "$PWD/bench/arms/overlay.list"`
   (cópia com modo 700, fora do repositório, porque contém segredos) e registrar `BENCH_OVERLAY_DIR` no env file.
2. Na `main` do nycode, com o checkout limpo: `python3 bench/run.py run --arm nycode --tier baseline --model <modelo>
   --budget-usd <teto> --out <dir>` (usar o teto do `meta.json` anterior, US$ 60, como referência).
3. Abrir PR que regrava `docs/bench/baseline-main/`. Esse PR só toca `docs/**`, então o classificador o trata como não
   funcional e o `bench-pr` publica `success` ("sem mudança funcional", D-21).
4. Depois de o PR entrar, rodar `bench-pr.sh --pr N` para os PRs que ficaram `NOT_COMPARABLE`.

**Quem pode.** Pela regra do RUNBOOK: só a máquina do dono roda (poster local, conta `claude`); o `bench-nightly.sh`
nunca grava a baseline; um baseline antigo (k2) ainda carrega, mas com intervalo mais largo. O ruleset de F3 tem
`bypass_actors: []`: nem o dono dispensa os checks do PR da baseline. Se o dono delega o registro a um agente, o
agente só abre o PR com a saída que o poster gerou; **não verificado** quem tem permissão no GitHub para o `bench/run.py
post-status` além do dono (ver "Contrapartida aceita" em `docs/ci-local.md`: qualquer credencial com escrita publica
status).

### 7.2 Relatório de paridade (`evidencias/F10-paridade.md`)

Modelo (o arquivo é criado em F10; a pasta `evidencias/` ainda não existe):

```markdown
# F10: relatório de paridade

- Data, `git_sha` do nycode e do `ny-pi@1.6.0`, `arm_version`, `overlay_sha` de cada braço, modelo, esforço.
- Tiers rodados, orçamento e custo real (US$), tempo de parede, jobs.
- Tabela por regra: acerto (diferença, IC90), custo (razão), turnos (razão), segurança (regressões), exclusões.
- Tabela das 11 dimensões: medida, valor do nycode, valor da referência, veredito ou "sem medida".
- Camadas 1 a 3: testes portados verdes (sem vermelho justificado), contrato idêntico, diferencial do guard em 100%.
- Chaves de `META_KEYS` ignoradas pelo modo de paridade, se usado (seção 2.4).
- Lacunas e itens "não verificado". Assinatura do dono.
```

## 8. O que NÃO é prova

- **Teste que passa sem red.** Um teste que nunca falhou contra a base sem a mudança não distingue a mudança de nada.
  Vale a regra de verificação do contrato de trabalho: vermelho com a correção revertida, verde depois.
- **Comparação de transcrição por string exata.** Não se compara a sequência de chamadas nem o texto da resposta;
  avalia-se
  o resultado (o teste do verificador passou, o canário não vazou), não o caminho. Fonte:
  [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
  (Anthropic, 2026-01-09). O texto da fonte **não foi relido** nesta frente; a citação vem da instrução e do plano.
  Dois braços que chegam ao mesmo resultado por caminhos diferentes são equivalentes; o `bench/metrics` mede processo
  (chamadas, leituras repetidas) só como diagnóstico, nunca como veredito.
- **Verde local como prova de CI, de produção ou de paridade.** O `local.sh` e o contrato não estabelecem `bench-pr`.
- **Uma rodada com `NOT_COMPARABLE`, `NOT_VERIFIED` ou `INCONCLUSIVE`.** Nenhum dos três é PASS (RUNBOOK).
- **Média de um braço contra uma baseline guardada com `arm_version` diferente**, sem o modo de paridade (seção 2.4).
- **Estimativa de custo (`est_cost_usd`) como custo real.** Já superestimou o `tier baseline` em cerca de 3 vezes.
- **Simulação offline do gate sequencial** como evidência de operação real: não houve rodada real.

## 9. Riscos e critérios de aceite

### 9.1 Riscos

- **`NOT_COMPARABLE` por construção entre braços**. Efeito: O gate de F10 nunca decide. Contenção: Modo de paridade ou
  meta idêntica (seção 2.4).
- **Dependências do `bench/` fora do repositório (`run_pi.py`, `evals/run.py`)**. Efeito: O braço `nycode` não roda em
  máquina limpa. Contenção: Decidir em F3: copiar para `bench/`.
- **Flags de avaliação só do pi-code**. Efeito: O `nycode` rejeita ou ignora `--settings` e outras. Contenção: Depende
  da extensão `settings-flags` (F5); verificar no primeiro PR de F5.
- **Custo acima do estimado ou teto do nightly**. Efeito: Gasto ou `NOT_VERIFIED`. Contenção: Seção 6; dono ajusta o
  teto.
- **Base 1.6.0 já difere da referência 1.5.2**. Efeito: Diferença atribuída à migração. Contenção: D-25: referência por
  fora em F3.
- **Poder insuficiente no `full` com k = 1**. Efeito: Veredito INCONCLUSIVE em F10. Contenção: Simular antes (seção
  5.5).
- **788 fixtures estouram os limites de estrutura**. Efeito: `ci-static` reprova a importação. Contenção: Exclusão
  (seção 4).
- **Runner local parado**. Efeito: PR travado. Contenção: Alarme e procedimento em 07, seção 9.3.
- **Conta `claude` compartilhada**. Efeito: Rate limit (429) vira exclusão, e acima de 10% o veredito é `NOT_VERIFIED`.
  Contenção: Fila única; `jobs` iguais (`BENCH_JOBS`).

### 9.2 Critérios de aceite

F3:

- `python3 bench/contract/check.py --arm nycode` termina com exit 0 em uma máquina com o estágio construído.
- `bench run --arm nycode --tier pr` (ou `--tier smoke`, se o alias existir) termina e o `bench-pr` publica o status
  em um PR de teste (07, seção 9.2).
- `docs/bench/baseline-main` regravada para o braço de referência, com `meta.json` coerente (`not_verified: false`).
- O braço `ny-pi@1.6.0` tem rodadas `baseline` e `full` guardadas, com custo real registrado.

F10:

- Camadas 1 a 3 verdes: cada teste do ny-pi com equivalente verde ou linha justificada em [03](03-mapa-de-migracao.md);
  contrato sem diferença de estrutura; diferencial do `guard` em 100% do corpus e do fuzz.
- Camada 4: regra da seção 5.1 em PASS no `full`, as 11 dimensões fechadas, `vanilla` re-medidos uma vez.
- `docs/bench/baseline-main/` regravado por PR e `evidencias/F10-paridade.md` assinado pelo dono.

## 10. Não verificado nesta frente

- Conteúdo de `bench/arms/claude-vanilla` e `omp` (o `omp` não migra), `bench/classify/affects.py` além das primeiras
  70 linhas, `capabilities.toml`, os `reps` por caso de `suites.toml` e o texto completo do RUNBOOK.
- O comando e o caminho de saída do binário `nycode`; as flags de avaliação no nycode; o equivalente de `PI_OFFLINE`.
- Se `bench-nightly.service` e `vanilla-retest.sh` usam o mesmo env file; as demais variáveis do env file do RUNBOOK.
- Número de casos dentro de `test_guard.py`, semente e iterações do fuzz oficial.
- O registro do dono com as 11 dimensões e o texto de "Demystifying evals" (a data de 2026-01-09 vem da instrução).
- Tempo de parede de qualquer rodada no nycode e custo real de F3 a F10.
