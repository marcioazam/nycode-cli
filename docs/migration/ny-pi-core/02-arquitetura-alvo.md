# Arquitetura alvo

Onde cada peça do ny-pi passa a morar no nycode e por quê. Fatos de origem: [anexo A](anexos/A-inventario-ny-pi.md).
Fatos de destino: [anexo B](anexos/B-mapa-core-nycode.md). Decisões citadas como D-nn: [11](11-decisoes-e-pendencias.md).

## 1. Três níveis de integração

O nycode já tem três lugares para código, e cada peça do ny-pi vai para o mais externo que ainda a deixe funcionar
sem pacote de fora:

| Nível | Onde | Quando usar | Custo com o upstream |
|---|---|---|---|
| N1. Core | `packages/coding-agent/src/core/`, `src/cli/`, `packages/mcp/`, `packages/tui/` | A peça muda o laço do agente, a linha de comando, a configuração, ou precisa de algo que a API de extensão não expõe | Alto: edita arquivo do upstream. Só em costuras listadas |
| N2. Extensão embutida | `packages/coding-agent/src/extensions/<nome>/`, registrada em `src/extensions/index.ts` com `builtin: true` | A peça cabe na `ExtensionAPI` (eventos, `registerTool`, `registerCommand`, UI) | Baixo: diretório novo, uma linha no registro |
| N3. Recurso embarcado | `packages/coding-agent/resources/` (novo) | Texto ou script sem código TypeScript: agentes, skills, comandos, regras, instruções, hooks | Nenhum: diretório novo |

O mecanismo N2 já existe no fork: `src/extensions/index.ts:8-13` registra `llama.cpp`, `codemode`, `tool-search` e
`mcp`; o `resource-loader.ts:766-778` resolve caminhos `builtin:<nome>`; `nycode config` liga e desliga cada uma em
"Built-in extensions". É por isso que quase todo o ny-pi vira N2 e não uma reescrita do core.

Regra de decisão: comece em N3; suba para N2 se houver código; suba para N1 só com uma das três justificativas da
tabela, e registre a costura em [08](08-sincronizacao-upstream.md#costuras).

## 2. Árvore alvo

```text
nycode/
├── .github/                    regras e workflows unificados (04, 07)
├── bench/                      benchmark vindo do ny-pi (Python), braço `nycode`
├── docs/
│   ├── assets/                 nycode-pixel.svg, nycode-wordmark-ansi.txt
│   ├── bench/                  RUNBOOK e linhas de base
│   ├── fork/                   registro do fork e política de sincronização
│   ├── harness/                documentos vindos de claude-home/docs
│   ├── migration/ny-pi-core/   este plano e as evidências
│   └── specs/                  especificações 0001-0009 do ny-pi
├── packages/
│   ├── coding-agent/
│   │   ├── resources/          N3 (novo)
│   │   │   ├── agents/         17 agentes
│   │   │   ├── commands/       17 comandos
│   │   │   ├── hooks/          guard.py, graph_context.py, dispatch/, claims/
│   │   │   ├── instructions/   contrato de trabalho (ex-CLAUDE.md), headless, lite
│   │   │   ├── rules/          safety.md e rules-ref/
│   │   │   └── skills/         30 skills
│   │   ├── src/
│   │   │   ├── cli/args.ts     + flags do wrapper (N1)
│   │   │   ├── core/
│   │   │   │   ├── permissions/   motor nativo de permissão (N1, fase B de F8)
│   │   │   │   ├── sdk.ts         + piSameContextMessage (N1)
│   │   │   │   └── settings-*.ts  + chaves do harness (N1)
│   │   │   ├── extensions/     N2: uma pasta por extensão embutida (seção 3)
│   │   │   └── migrations/from-pi.ts   importador de ~/.pi/agent (N1)
│   │   └── test/harness/       testes portados do ny-pi
│   ├── mcp/src/transports/stdio.ts     STDIN_CLOSE_GRACE_MS = 100 (N1)
│   └── tui/                    API pública para o que hoje é campo interno (N1)
├── scripts/
│   ├── ci/                     run-static.sh, run-security.sh, lint/, install-tools.sh
│   └── harness/                ferramentas vindas de claude-home/bin
└── import/ny-pi/               histórico importado; esvazia a cada fase e some em F12
```

`import/` fica fora do `workspaces` do `package.json`, do `biome.json`, do `tsconfig.json`, do pacote publicado e de
todos os gates, exceto a verificação de vazamento.

## 3. Extensões embutidas (N2)

Nome do diretório e do registro `builtin:<nome>`. "Padrão" é o estado numa instalação nova.

<a id="31-vindas-do-pi-code-170-ja-com-os-19-patches"></a>

### 3.1 Vindas do pi-code 1.7.0 (já com os 19 patches)

| Extensão | Origem em pi-code | Linhas | Patches absorvidos | Padrão | Fase |
|---|---|---|---|---|---|
| `hooks` | `hooks/` | 2501 | — | ligada | F5 |
| `todo` | `todo.ts` | 611 | `todo-collapse` | ligada | F5 |
| `question` | `question.ts` | 752 | — | ligada | F5 |
| `commands` | `commands.ts` | 701 | `commands-print` | ligada | F5 |
| `status-line` | `status-line.ts` | 748 | `statusline-multiline`, `zzzzzzzz-statusline-provider` | ligada | F6 (D-34) |
| `notify` | `notify.ts` | 170 | `notify-focus` | ligada | F5 |
| `git-checkpoint` | `git-checkpoint.ts` | 740 | `rewind-tree` | ligada | F5 |
| `memory` | `memory.ts` | 698 | — | ligada | F5 |
| `claude-rules` | `claude-rules.ts` | 506 | — | ligada | F5 |
| `context-imports` | `context-imports.ts` | 1392 | — | ligada | F5 |
| `output-styles` | `output-styles.ts` | 294 | — | ligada | F5 |
| `skills-compat` | `skills.ts` | 296 | — | ligada | F5 |
| `session-title` | `session-title.ts` | 156 | — | ligada | F5 |
| `thinking` | `thinking.ts` | 108 | — | ligada | F5 |
| `env-settings` | `env-settings.ts` | 201 | — | ligada | F5 |
| `settings-flags` | `settings-flags.ts` | 89 | — | ligada | F5 |
| `init` | `init.ts` | 85 | — | ligada | F5 |
| `run` | `run/` | 1413 | — | ligada | F6 (D-34) |
| `context-usage` | `context-usage.ts` | 45 | — | ligada | F5 |
| `web` | `web.ts` | 450 | — | **desligada** (hoje `--exclude-tools web_search` e `no-web-search.ts`) | F5 |
| `subagent` | `subagent/` | 8526 | `subagent-nesting`, `subagent-panel`, `subagent-render`, `team`, `zz-panel-main-root`, `zz-subagent-respawn`, `zzz-panel-column0`, `zzzzzz-subagent-send`, `zzzzzzz-subagent-model-effort` | ligada | F6 |
| `plan-mode` | `plan-mode/` | 2628 | `zz-hotkeys-no-alt`, `zzzz-plan-done-rule`, `zzzzz-plan-sota` | ligada | F6 |
| `goal` | `goal.ts` + `internal/goal-*` | 722 + parte de `internal` | `goal` (inclui o fim do portão de confiança que hoje é um `sed`) | ligada | F6 |
| (biblioteca) `_shared` | `internal/` | 5559 | parte de `goal` | — | F5 |

Não migram do pi-code:

- `mcp/` (2548 linhas): o ny-pi já a excluía (`!extensions/mcp/**`); o nycode tem MCP próprio no core.
- `version-floor.ts` (30 linhas): confere a versão mínima do pi hospedeiro; sem sentido dentro do core.

Regra de importação (F5 e F6): o primeiro commit de cada extensão é a cópia **byte a byte** da árvore instalada e
remendada (`~/.pi/agent/npm/node_modules/pi-code/extensions/...` depois do boot do wrapper), conferida por hash
contra uma aplicação limpa dos patches sobre o tarball `pi-code@1.7.0`
(sha1 `8ba1f814773da6897f6708c62c7c517cee2baf4e`). O segundo commit troca os imports e o nome da variável `pi` por
`nycode`. O terceiro reformata com o Biome do fork. Assim a revisão de cada passo é mecânica.

Licença: pi-code é MIT (`Copyright (c) 2025 Mario Zechner`, `Copyright (c) 2026 ilovepixelart`). O `NOTICE` do nycode
ganha a atribuição e o commit de origem.

<a id="32-vindas-de-extensions-do-ny-pi"></a>

### 3.2 Vindas de `extensions/` do ny-pi

| Extensão embutida | Origem | Nível | Observação | Fase |
|---|---|---|---|---|
| `auto-resume` | `extensions/auto-resume/` | N2 | Chave `harness.autoResume` | F7 |
| `bash-timeout` | `extensions/bash-timeout/` | N2 → N1 | Padrão 600 s e teto 1800 s passam a ser opções da ferramenta `bash` do core; a extensão some | F7 |
| `permissions` | `extensions/bypass-permissions/` | N1 | Comando `/bypass`, atalho e estado passam ao motor de permissão | F8 |
| `cache-prefix-probe` | `extensions/cache-prefix-probe/` | — | **Não migra**: diagnóstico marcado como temporário. Confirmar em D-10 | F7 |
| `compact-threshold` | `extensions/compact-at-400k.ts` | N1 | Vira `compaction.maxContextTokens` no core; `scripts/compaction-400k.py` some | F7 |
| `completion-gate` | `extensions/completion-gate.ts` | N2 | Chave `harness.completionGate` | F7 |
| `dev-commands` | `extensions/dev-commands/` | N2 | `/copy-code`, `/keybindings` | F7 |
| `effort-sandwich` | `extensions/effort-sandwich/` | N2 | Opcional, desligada | F7 |
| `footer` | `extensions/footer-no-stats.ts` | N2 | UI | F7 |
| `headless-lean` | `extensions/headless-lean/` | N2 | Só no modo `print` | F7 |
| `context-files` | `extensions/no-context-files-covers-claude-md.ts` | — | **Some**: existia para contornar a injeção de `CLAUDE.md` pelo pi-code; com `claude-rules` embutida a regra é escrita direto nela | F7 |
| `no-web-search` | `extensions/no-web-search.ts` | — | **Some**: `web` nasce desligada | F5 |
| `docs-pointer` | `extensions/pi-docs/` | N2 | A seção `docs` do prompt de sistema passa a ser uma linha por padrão; extensão que sobrescreve `sections.docs`, como no ny-pi (D-36) | F7 |
| `plan-gate` | `extensions/plan-gate.ts` | N2 | Depende de `plan-mode` e do agente `plan-reviewer` | F7 |
| `prefix-cache-1h` | `extensions/prefix-cache-1h/` | N2 | Só sessão interativa | F7 |
| `import-claude-session` | `extensions/puxar.ts` | N2 | Opcional; chama `scripts/harness/puxar/puxar.py` | F7 |
| `sound-notify` | `extensions/sound-notify/` | N2 | Opcional, desligada | F7 |
| `sticky-prompt` | `extensions/sticky-prompt/` | N2 + N1 | Precisa de API pública em `@nycode/tui` no lugar dos campos internos do pi-tui 1.5.2 | F7 |
| `syntax-check` | `extensions/syntax-check/` | N2 | `@vscode/tree-sitter-wasm` 0.3.1 vira dependência exata do `coding-agent` | F7 |
| `todo-sync` | `extensions/todo-sync/` | N2 → fundida | Funde em `todo` | F7 |
| `ui` | `extensions/ui/` | N2 + N1 | `/btw`, `/diff`, `/rename`, `/vim`, histórico; `a11y` passa a usar API pública do cabeçalho | F7 |
| `ui-visual` | `extensions/ui-visual/` | N2 + N1 | O logo do cabeçalho deixa de ser cópia de `pi-logo` e usa o componente exportado, com a marca nycode | F7 |
| `up-dequeue` | `extensions/up-dequeue/` | N2 | — | F7 |

### 3.3 Vinda de terceiros

| Extensão embutida | Origem | Observação | Fase |
|---|---|---|---|
| `lsp` | `pi-lsp` 0.1.7 (MIT) + `patches/third-party/pi-lsp.patch` (4080 linhas) | O patch é maior que muita extensão: tratar como código próprio. `lsp.json` passa a `~/.nycode/agent/lsp.json` | F9 |

`ponytail`, `ralph-loop`, `pr-review-toolkit` e `claude-red` ficam como pacotes opcionais (seção 7).

<a id="4-mudancas-de-core-n1"></a>

## 4. Mudanças de core (N1)

Lista fechada. Cada linha é uma costura no upstream e entra em [08](08-sincronizacao-upstream.md#costuras).

| # | Arquivo do fork | Mudança | Origem no ny-pi | Fase |
|---|---|---|---|---|
| K1 | `packages/coding-agent/src/core/sdk.ts:370` | `messages.every((m, i) => current[i] === m)` passa a comparar por identidade de conteúdo (`piSameContextMessage`) | `claude-home/patches/pi-core/cache-warm-identity.mjs` | F4 |
| K2 | `packages/mcp/src/transports/stdio.ts:10` | `STDIN_CLOSE_GRACE_MS` de 500 para 100 | `mcp-close-grace.mjs`, especificação 0003 | F4 |
| K3 | `packages/coding-agent/src/cli/args.ts` | Flags `--bypass`, `--dangerously-skip-permissions`, `--safe`, `--no-bypass` | `bin/pi` | F4 |
| K4 | `packages/coding-agent/src/core/settings-schema.ts`, `settings-defaults.ts`, `src/modes/interactive/theme/theme.ts`, `src/modes/interactive/interactive-mode.ts` | Bloco `harness` e `permissions` (seção 5); `defaultProjectTrust` padrão `never`; `quietStartup` padrão `header`; `retry` padrão do ny-pi; temas `tokyo-night` e `mono` embutidos, `tokyo-night` padrão (D-37) | `bin/pi`, `settings.json.example`, `local.env.example` | F4 |
| K5 | `packages/coding-agent/src/extensions/index.ts` | Uma linha de registro por extensão embutida | — | F5 a F9 |
| K6 | `packages/coding-agent/src/core/resource-loader.ts` | Escopo `builtin` para agentes, skills, comandos, regras e instruções em `resources/`, com a menor precedência | `CLAUDE_CONFIG_DIR`, `publish.list` | F8 |
| K7 | `packages/coding-agent/src/core/system-prompt.ts` | Inclusão das instruções embarcadas (a seção `docs` em uma linha ficou na extensão `docs-pointer`, D-36) | `claude-home/CLAUDE.md` | F8 |
| K8 | `packages/coding-agent/src/core/tools/bash.ts` | Tempo limite padrão e teto configuráveis; opção de seguir em segundo plano | `extensions/bash-timeout`, especificação 0008 | F7 |
| K9 | `packages/coding-agent/src/core/compaction/` | Limite absoluto de contexto para compactar | `compact-at-400k.ts` | F7 |
| K10 | `packages/tui/src/` | API pública: widget fixo no topo, clique no cabeçalho, observador de entrada do terminal | `sticky-prompt`, `ui/a11y`, `ui/terminal` | F7 |
| K11 | `packages/coding-agent/src/core/permissions/` (novo) + gancho em `tool_call` | Motor nativo de permissão | `claude-home/hooks/guard.py` | F8 |
| K12 | `packages/coding-agent/src/main.ts` (chamada) + `src/migrations/from-pi.ts` (novo) | `nycode migrate from-pi` | `install.sh --link/--restore` | F4 |
| K13 | `packages/coding-agent/package.json` (`files`) | Inclui `resources/` | `publish.list` | F8 |
| K14 | `packages/coding-agent/src/config.ts:605` | Título de reserva "π" vira "nycode" | — | F2 |

<a id="5-configuracao-e-variaveis-de-ambiente"></a>

## 5. Configuração e variáveis de ambiente

Regra: toda variável vira chave tipada em `settings.json`; a variável `NYCODE_*` continua existindo como sobreposição
para automação. `PI_*` e `CLAUDE_CONFIG_DIR` **não** são lidas em tempo de execução (o `AGENTS.md` do fork proíbe
retrocompatibilidade não pedida); a conversão é feita uma vez por `nycode migrate from-pi` (D-09).

| Hoje (ny-pi) | Chave em `settings.json` | Variável | Padrão |
|---|---|---|---|
| `PI_BYPASS_PERMISSIONS`, `--bypass`, `--safe` | `permissions.bypass` | `NYCODE_BYPASS_PERMISSIONS` | `false` |
| (novo, K11) escolha do motor de permissão | `permissions.engine` | — (sem variável) | `"script"` (`guard.py`); `"native"` liga o motor TypeScript. valor desconhecido nega. **Só global** (`~/.nycode/agent/settings.json`; o do projeto é ignorado, como em `permissions.bypass`; C-F8-13). O padrão só muda após `security-reviewer` e benchmark (D-29) |
| `--no-approve` injetado pelo wrapper | `defaultProjectTrust` (já existe) | — | `"never"` |
| `--exclude-tools web_search` | extensão `web` desligada | — | desligada |
| `PI_COMPACT_AT` | `compaction.maxContextTokens` | `NYCODE_COMPACT_AT` | `250000` |
| `PI_EFFORT_SANDWICH`, `PI_EFFORT_SANDWICH_TURNS` | `harness.effortSandwich.{enabled,turns}` | `NYCODE_EFFORT_SANDWICH[_TURNS]` | desligado |
| `PI_SUBAGENT_RESPAWN` | `subagent.respawn` | `NYCODE_SUBAGENT_RESPAWN` | conforme o ny-pi |
| `PI_CODE_SUBAGENT`, `PI_CODE_SUBAGENT_DEPTH` | interno (marca de processo filho) | `NYCODE_SUBAGENT`, `NYCODE_SUBAGENT_DEPTH` | — |
| `PI_HEADLESS_LEAN`, `_TRIM`, `_TOOLS`, `_FLOOR` | `harness.headless.{lean,trim,tools,floor}` | `NYCODE_HEADLESS_*` | conforme a 0002 |
| `PI_BASH_TIMEOUT_BG` | `tools.bash.backgroundOnTimeout` | `NYCODE_BASH_TIMEOUT_BG` | desligado |
| `PI_TODO_SYNC` | `todo.staleReminder` | `NYCODE_TODO_SYNC` | ligado |
| `PI_PREFIX_CACHE_1H` | `harness.prefixCache1h` | `NYCODE_PREFIX_CACHE_1H` | ligado no interativo |
| `PI_AUTO_RESUME` | `harness.autoResume` | `NYCODE_AUTO_RESUME` | ligado |
| `PI_PLAN_GATE` | `plan.gate` | `NYCODE_PLAN_GATE` | ligado |
| `PI_COMPLETION_GATE` | `harness.completionGate` | `NYCODE_COMPLETION_GATE` | ligado |
| `PI_SOUND_NOTIFY` | `notify.sound` | `NYCODE_SOUND_NOTIFY` | ligado (o ny-pi só desligava com `PI_SOUND_NOTIFY=0`) |
| `PI_UI_STATE`, `PI_REDUCED_MOTION`, `PI_NERD_FONT`, `PI_ASCII_ICONS` | `terminal.{uiState,reducedMotion,nerdFont,asciiIcons}` | `NYCODE_*` iguais | conforme o ny-pi |
| `NO_COLOR`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` | — | `NO_COLOR` (padrão externo), `NYCODE_DISABLE_TERMINAL_TITLE` | — |
| `PI_KNOWLEDGE_VAULT`, `PI_GRAPHS_VAULT` | `knowledge.vault`, `knowledge.graphsVault` | `NYCODE_KNOWLEDGE_VAULT`, `NYCODE_GRAPHS_VAULT` | vazio |
| `CODEGRAPH_AUTO_ROOT`, `_BIN`, `_STATUS_TTL`, `_AUTO_STATE` | `codegraph.{autoRoot,bin,statusTtl,autoState}` | iguais (são do codegraph) | vazio |
| `PONYTAIL_QUIET_STARTUP`, `PONYTAIL_SUBAGENT_MATCHER` | do pacote opcional `ponytail` | iguais | — |
| `CLAUDE_CONFIG_DIR` | **some**: recursos embarcados + `~/.nycode/agent` | — | — |
| `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_SESSION_FILE` | — | `NYCODE_CODING_AGENT_DIR`, `NYCODE_CODING_AGENT_SESSION_DIR`, `NYCODE_SESSION_FILE` (já existem) | — |
| `PI_MCP_CONFIG` | `mcp.configPath` | `NYCODE_MCP_CONFIG` | `~/.nycode/agent/mcp.json` |
| `PI_LOCAL_ENV` + `local.env` (9 chaves, modo 0600) | **some**: as 9 chaves são chaves de `settings.json` | — | — |
| `PI_HARNESS_*` (instalador, pins) | **some** com o instalador por fora | — | — |
| `BENCH_*` | iguais (ferramenta do repositório) | `BENCH_*` | — |
| `hooks`, `statusLine`, `env` de `claude-home/settings.json` | `hooks`, `statusLine`, `env` em `settings.json` do nycode (lidos pela extensão `hooks`) | — | hooks embarcados da seção 6 |

O esquema JSON publicado (`packages/coding-agent/schemas`) é regenerado; `docs/settings.md` do pacote documenta as
chaves novas.

## 6. Recursos embarcados (N3)

| Recurso | Origem | Destino | Precedência |
|---|---|---|---|
| Instruções sempre carregadas | `claude-home/CLAUDE.md`, `CLAUDE.headless.md`, `lite/APPEND.md` | `resources/instructions/{contract,headless,lite}.md` | Embarcado < global (`~/.nycode/agent/AGENTS.md`) < projeto |
| Regras | `claude-home/rules/safety.md`, `rules-ref/*.md` (4) | `resources/rules/` | idem |
| Agentes | `claude-home/agents/*.md` (17) | `resources/agents/` | Um agente do usuário com o mesmo nome substitui o embarcado |
| Skills | `claude-home/skills/*/` (30 pastas, 227 arquivos) | `resources/skills/` | idem; `core`, `ui` ou `optional` segundo a 0005 |
| Comandos | `claude-home/commands/*.md` (17) | `resources/commands/` | idem |
| Hooks | `claude-home/hooks/` (21 arquivos) | `resources/hooks/` | Registrados por padrão em `hooks` de `settings-defaults.ts` |
| Temas | `themes/tokyo-night.json`, `themes/mono.json` | `src/modes/interactive/theme/` (tema padrão `tokyo-night`; D-37) | Junto de `dark` e `light` do upstream |
| Linha de status | `claude-home/plugins/claude-hud/` + `bin/hud/` | `resources/statusline/` | `statusLine` padrão |

Os caminhos dentro dos textos mudam de `$CLAUDE_CONFIG_DIR/...` e `~/.pi/agent/claude-home/...` para um marcador
resolvido pelo carregador (`${NYCODE_RESOURCES}`), nunca um caminho absoluto. `check-refs.py` valida.

O orçamento de instruções (`instruction_budget.py` e sua linha de base) migra junto e continua obrigatório: o texto
sempre carregado não pode crescer com a mudança de lugar.

Hooks, fase A (F8): os scripts Python e shell rodam como hoje, lançados pela extensão `hooks`. Dependência de
execução: `python3` e `jq` na máquina. Fase B (F8): `guard.py` ganha equivalente nativo em `core/permissions/`
(K11), sem Python no caminho de toda chamada de ferramenta; o script fica como referência e oráculo de teste.

## 7. Pacotes opcionais

Peças classificadas como `optional` pela 0005, ou de terceiros sem necessidade de mudança local, não entram no
pacote `@nycode/coding-agent`. Ficam como pacotes nycode instaláveis (`nycode install <fonte>`):

| Pacote | Origem | Mudança local hoje | Destino |
|---|---|---|---|
| `ponytail` | git `ef8ca48`, MIT, v4.10.3 | `ponytail.patch` (351 linhas) | Propor o patch ao autor; enquanto isso, fork em `marcioazam/` com o patch como commit (D-11) |
| `ralph-loop` | claude-plugins-official `893173f`, Apache-2.0 | `ralph-loop.patch` (26 linhas) | idem |
| `pr-review-toolkit` | claude-plugins-official `893173f`, Apache-2.0 | nenhuma | Instalar da origem com SHA fixo |
| `claude-red` | git `a8de813`, MIT, opcional | nenhuma | idem |

## 8. O que deixa de existir

| Peça | Motivo |
|---|---|
| `bin/pi`, `bin/test_pi_env.sh` | Flags e padrões nativos (K3, K4) |
| `claude-home/patches/` (60 arquivos), `scripts/check-patch-stack.sh` | Patches viram fonte; os testes dos patches migram |
| `patches/third-party/`, `third-party.json` | Seções 3.3 e 7 |
| `npm/` (`pi-extensions`, dependência `pi-code`) | pi-code é fonte do repositório |
| `install.sh`, `scripts/install-lib.sh`, `scripts/test_install.sh`, `publish.list` | Instalador e pacote do fork (F11); a regra de "só o que está na lista é publicado" vira o campo `files` do pacote e o teste `check-package-install` |
| `.githooks/pre-commit` (lista de caminhos permitidos) | Substituído por `.husky/pre-commit` do fork mais `check-leaks.sh --staged` |
| `local.env.example`, `settings.json.example`, `claude-home/settings.json.example` | Padrões no código; exemplos em `packages/coding-agent/docs/settings.md` |
| `mcp.json.example`, `models.json.example`, `lsp.json.example` | Viram `packages/coding-agent/examples/config/` |
| `no-web-search.ts`, `no-context-files-covers-claude-md.ts`, `version-floor.ts`, `scripts/compaction-400k.py` | Contornos de um acoplamento que acaba |

## 9. Regras de estrutura no destino

O ny-pi limita arquivo próprio a 800 linhas e diretório a 7 arquivos de código. O fork tem 50 arquivos de fonte
acima de 800 linhas herdados do upstream (por exemplo `core/extensions/types.ts`, 2358). Regra no nycode (D-06):

- O limite vale para **arquivos criados pelo nycode**: `packages/coding-agent/src/extensions/<nomes da seção 3>`,
  `src/core/permissions/`, `src/migrations/`, `resources/`, `scripts/ci/`, `scripts/harness/`, `bench/`.
- Arquivos do upstream ficam numa lista de base (`scripts/ci/lint/structure-upstream.txt`), como o "legado" do ny-pi.
  Dividi-los só aumentaria o conflito.
- Código importado do pi-code que passa do limite (por exemplo `context-imports.ts`, 1392) entra na lista de base no
  commit de cópia e sai dela quando for dividido, depois do corte.
- Formatação TypeScript: a do fork (Biome com tabulação, linha de 120). O `biome.json` do ny-pi (2 espaços, aspas
  simples) não migra. Python (`ruff`, `mypy --strict`) e shell (`shellcheck`, `shfmt`) mantêm a configuração do ny-pi.
- Regras do `AGENTS.md` do fork valem para o código migrado: sem `any`, sem import dinâmico, só sintaxe TypeScript
  apagável, ativos resolvidos por `src/config.ts`. A conversão é parte do terceiro commit de cada extensão.

## 10. Versões e ferramentas

| Item | Valor alvo | Motivo |
|---|---|---|
| Node | `>= 22.19.0` no `engines` (do fork); CI em 22 e 24 | O ny-pi roda em 24; o fork exige 22.19 |
| Python | 3.12 | Hooks, bench e gates |
| Versão dos pacotes | Continua em sincronia (`lockstep`) a partir de 1.6.0; a primeira versão com o harness é a `2.0.0` (D-13) | Mudança incompatível de padrões |
| TypeScript, Biome | Os do fork (7.0.2, 2.3.5) | Um só conjunto |
