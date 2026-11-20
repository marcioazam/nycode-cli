# Inventário da origem e do destino

Resumo do que existe hoje, com as contagens que o resto do plano usa. O levantamento bruto, com caminho e linha,
está nos anexos [A](anexos/A-inventario-ny-pi.md) (ny-pi) e [B](anexos/B-mapa-core-nycode.md) (nycode).

## 1. Como o ny-pi funciona hoje

```text
usuário digita `pi`
   │
   ▼
~/.local/bin/pi  (wrapper bin/pi, 198 linhas de sh)
   │ 1. lê ~/.pi/agent/local.env (9 chaves permitidas, modo 0600)
   │ 2. exporta CLAUDE_CONFIG_DIR=~/.pi/agent/claude-home
   │ 3. consome --bypass / --safe; injeta --no-approve e --exclude-tools web_search
   │ 4. aplica 19 patches em node_modules/pi-code/extensions (patch -p1) e um sed em goal.ts
   │ 5. reescreve o dist do pi 1.5.2 com 2 scripts (cache-warm-identity, mcp-close-grace)
   ▼
~/.pi/agent/bin/pi  (pi 1.5.2, instalado de pi.dev)
   │ carrega pacotes de settings.json:
   │   pi-code@1.7.0 (sem extensions/mcp), ./vendor/pi-lsp, ./vendor/ponytail
   │ carrega ~/.pi/agent/extensions/ (23 unidades do ny-pi, por ligação simbólica)
   ▼
pi-code lê CLAUDE_CONFIG_DIR: CLAUDE.md, rules/, agents/, skills/, commands/, settings.json (hooks)
   │ hooks: guard.py (PreToolUse), graph_context.py (SessionStart), hook-dispatch.sh, statusline.mjs
   ▼
sessão
```

Nada disso é um binário único: são quatro camadas instaladas em momentos diferentes (pi, pi-code, terceiros, ny-pi),
unidas por um script de shell que reaplica patches a cada início.

## 2. Contagens da origem (`marcioazam/ny-pi@e4f8729`)

| Área | Quantidade | Detalhe |
|---|---:|---|
| Arquivos rastreados | 1485 | |
| `bench/` | 870 | 788 em `suites/` (784 tarefas e 4 arquivos próprios), 82 de código e configuração |
| `claude-home/` | 439 | Ver linhas abaixo |
| — agentes | 17 | `Explore`, `Plan`, `claim-verifier`, `code-reviewer`, `gate-runner`, `general-purpose`, `git-delivery`, `lane-integrator`, `perplexity-scout`, `plan-reviewer`, `reliability-reviewer`, `research-scout`, `security-reviewer`, `swarm-worker`, `test-author`, `test-reviewer`, `web-scout` |
| — skills | 30 pastas, 227 arquivos | `agent-routing`, `agent-systems`, `atualizador`, `code-simplification`, `codegraph`, `context-economy`, `deep-search`, `diagnose`, `differential-review`, `doces-ou-travessuras`, `engineering-standards`, `git-workflow`, `graph-engineering`, `insecure-defaults`, `lane-integration`, `loop-engineering`, `perplexity-urls`, `plan-workflow`, `pr-review`, `property-based-testing`, `quality-gates`, `ripple-hunt`, `sdd-workflow`, `security-audit`, `sharp-edges`, `soteiros`, `swarm-orchestration`, `tdd`, `to-questionnaire`, `variant-analysis` |
| — comandos | 17 | `cancel-ralph`, `claude-hud-configure`, `claude-hud-setup`, `claude-tier`, `clean_gone`, `code-review`, `commit-push-pr`, `commit`, `diff-review`, `insecure-defaults-audit`, `pre-launch`, `ralph-help`, `ralph-loop`, `review-pr`, `revise-claude-md`, `skill-gen`, `swarm` |
| — regras e instruções | 8 | `CLAUDE.md`, `CLAUDE.headless.md`, `rules/safety.md`, 4 em `rules-ref/`, `lite/APPEND.md` |
| — hooks | 21 | `guard.py` (799 linhas), `graph_context.py`, `dispatch/hook-dispatch.sh`, `impeccable_gate.sh`, `claims/`, 9 amostras de carga, 6 testes |
| — ferramentas (`bin/`) | 57 | `git-deliver`, `checks/`, `doctor/`, `evals/`, `hud/`, `puxar/`, `structure/`, `telemetry/`, `tests/` |
| — patches | 60 | 19 patches de pi-code, 2 scripts de core, 13 originais, 26 testes e apoio |
| — documentos | 29 | Registros de decisão e pesquisa do harness |
| `extensions/` | 60 arquivos | 23 unidades, 37 fontes (3542 linhas), 22 testes, `package.json` e lock do `syntax-check` |
| `scripts/` | 29 | 20 em `scripts/ci/` |
| `.github/` | 16 | 5 workflows, ruleset, modelos, `dependabot.yml`, `CODEOWNERS` |
| `docs/` | 39 | 7 especificações, `ci-local.md`, 31 em `docs/bench/` |
| Demais | 32 | Raiz (README, licenças, exemplos, `install.sh`, `publish.list`), `bin/`, `npm/`, `patches/third-party/`, `themes/` |

## 3. O que vem de fora do repositório

| Componente | Versão fixada | Tamanho | Papel |
|---|---|---|---|
| pi (`@earendil-works/pi-coding-agent`) | 1.5.2 | — | O agente; base do fork na 1.6.0 |
| pi-code | 1.7.0 (a mais nova no npm é 1.10.1) | 112 arquivos no tarball; 159 depois dos patches; cerca de 32 mil linhas | Subagentes, modo de plano, objetivo, hooks, tarefas, comandos, regras, linha de status |
| pi-lsp | 0.1.7 | patch local de 4080 linhas | Diagnósticos depois de editar |
| ponytail | git `ef8ca48` (v4.10.3) | patch local de 351 linhas | Modo de código mínimo |
| ralph-loop, pr-review-toolkit | claude-plugins-official `893173f` | patch de 26 linhas no primeiro | Laço e revisão de PR |
| claude-red | git `a8de813` | — | Opcional |

## 4. Contagens do destino (`marcioazam/nycode@fb05db936`)

| Área | Valor |
|---|---|
| Origem | `earendil-works/pi@073b0bae8488ee20def26e873b77036dac4e9eea`, histórico preservado |
| Renome | Commit `f523ebd25`, 2316 arquivos |
| Pacotes | 12 em `packages/` (`agent`, `ai`, `chord`, `codemode`, `coding-agent`, `durable`, `env`, `evals`, `mcp`, `schema`, `telemetry`, `tui`), todos 1.6.0 |
| Aplicativos | `apps/p2`, `apps/p3`, `apps/p2-mac` |
| `packages/coding-agent/src` | 266 arquivos `.ts` (core 103, modes 71, utils 39, extensions 25, cli 15, bun 5) |
| Extensões embutidas | 4: `llama.cpp`, `codemode`, `tool-search`, `mcp` |
| Eventos da `ExtensionAPI` | cerca de 40, incluindo todos os que as extensões do ny-pi usam (`agent_before_settle`, `agent_settled`, `before_provider_request`, `tool_call`, `tool_result`, `session_start` e outros) |
| Subagentes, modo de plano, objetivo, hooks, tarefas | Não existem no core |
| Arquivos de fonte acima de 800 linhas | 50 de 939 em `packages/*/src` |
| Workflows | `ci.yml` (`build-check`, `test` em 4 grupos, `mcp-conformance`), `npm-audit.yml` |
| Publicação | Scripts existem; nenhum workflow de publicação; `@nycode/coding-agent` não existe no npm |
| Ainda citam `pi.dev` ou `earendil` | 249 arquivos (catálogo de modelos, instalador, documentação, registros de mudança) |
| Ramos remotos | 213, a maioria do antigo projeto em Rust |

## 5. Dez acoplamentos que a migração elimina

1. Wrapper `bin/pi` com flags próprias.
2. Patches aplicados a cada início (`patch -p1`, `sed -i`) sobre `node_modules/pi-code`.
3. Reescrita do `dist` minificado do pi.
4. `CLAUDE_CONFIG_DIR` apontando para `claude-home`, e a extensão que desfaz a injeção de `CLAUDE.md`.
5. Variáveis de ambiente como interface de configuração, com lista de permissão em `local.env`.
6. Extensões que leem campos internos do TUI e copiam componentes não exportados.
7. Caminhos fixos `~/.pi/agent/...` em 95 arquivos.
8. Instalador que fixa o pi por `pi.dev`, o pi-code por npm e terceiros por `third-party.json` com patch.
9. MCP do pi-code excluído por filtro para não duplicar o do pi.
10. Gates que existem só para vigiar o acoplamento (`check-patch-stack.sh`, lista de `publish.list` no pre-commit).

## 6. Lacunas conhecidas do levantamento

- Os patches grandes (`subagent-panel`, 2547 linhas; `goal`, 872) foram descritos por nome, alvo e documentação, não
  lidos linha a linha (pendência P-2).
- As 227 peças de skill foram contadas, não lidas uma a uma; a classe de cada uma vem da especificação 0005 (P-1).
- Não foi verificado se o repositório de origem do pi-code tem testes próprios além dos que o ny-pi escreveu.
- O levantamento do nycode não usou índice de código; foi leitura e busca literal.
