<!-- Anexo A: levantamento bruto de 2026-11-20 (ny-pi origin/main e4f8729). Fonte de fatos do plano; não editar à mão, regenerar. -->
# Inventário ny-pi para migração ao core de um fork do pi

Fonte: `origin/main` = e4f8729 (2026-11-20, "fix(security): clear code-fixable Security and quality findings (#66)"), extraído com `git archive` para /tmp/nyx (somente leitura). Working tree sujo (351 entradas no porcelain), não lido. 1485 arquivos rastreados.
Cobertura: leitura direta de arquivos (sem codegraph; inventário literal). Raiz de caminhos abaixo = raiz do repo.
**Correção de premissa:** não existem ~60 extensões próprias. O repo tem **23 unidades** (7 arquivos soltos + 16 diretórios), 37 arquivos .ts não-teste (3542 linhas) + 22 arquivos de teste. O restante do "harness" que parece extensão vive em **pi-code 1.7.0** (goal, subagent, plan-mode, hooks, todo, notify, status-line, git-checkpoint, commands, mcp) modificado por 19 patches, mais pi-lsp e ponytail (vendor).

## 0. Alvo e pins (item 9)
- pi upstream (`@earendil-works/pi-coding-agent`): **1.5.2** — `scripts/install-lib.sh:6` (`PI_VERSION=1.5.2`) + sha256 dos artefatos (`install-lib.sh:9`); `bin/pi` (`PI_HARNESS_PI_VERSION:-1.5.2`); `install.sh:3`. Release instalada em `~/.pi/agent/install/releases/<ver>/`, versão em `~/.pi/agent/install/current-version`.
- pi-code (pacote npm de extensões Claude-compat): **1.7.0** — `npm/package.json` (dep exata), `npm/package-lock.json`, `install-lib.sh:7`, `bin/pi` (`PI_HARNESS_PI_CODE_VERSION:-1.7.0`), `settings.json.example` (`npm:pi-code@1.7.0`), `scripts/check-patch-stack.sh:9` (tarball sha1 `8ba1f814773da6897f6708c62c7c517cee2baf4e`).
- Terceiros pinados em `third-party.json` (schema 1): ponytail (git ef8ca48, MIT, v4.10.3, required), pi-lsp 0.1.7 (npm sha512, required), ralph-loop e pr-review-toolkit (claude-plugins-official @893173f, Apache-2.0, required), claude-red (git a8de813, opcional). Hooks pi-code testados com fixtures `claude-home/hooks/fixtures/pi-code-1.7.0/`.
- Toolchains: Node 24 (`ci-static.yml:54`; statusLine usa mise node/24), Python 3.12 (`ci-static.yml:50`, `ci-security.yml:52`), bash/sh POSIX, jq, patch, curl, tar, sha256sum (`preflight`, `install-lib.sh:21`). Ferramentas CI pinadas por sha256 em `scripts/ci/install-tools.sh`: actionlint gitleaks trufflehog osv-scanner shellcheck shfmt biome rg; pip com hashes `scripts/ci/requirements-ci.txt`; ruff, mypy --strict, markdownlint, zizmor 1.32.0, semgrep, tree-sitter-wasm 0.3.1 (`extensions/syntax-check/package.json`).
- Limites de estrutura (≤800 linhas/arquivo, ≤7 arquivos de código por diretório): `scripts/ci/lint/structure_changed.py:16-17` (só arquivos alterados no PR, chamado por `run-static.sh`); `claude-home/bin/structure/structure.py:139` (repo inteiro, 800 linhas; teste `test_structure.py`); regra textual em `claude-home/CLAUDE.md`. Violações pré-existentes são "legacy" (não bloqueiam). Obs.: `bench/suites/**` (788 arquivos) é fixture de tarefas.

## 1. bin/pi (wrapper POSIX sh, 198 linhas) + bin/test_pi_env.sh (selftest do loader, `PI_WRAPPER_TEST=1`)
Boot, em ordem:
1. `pi_load_local_env ${PI_LOCAL_ENV:-~/.pi/agent/local.env}`: parser linha a linha (nunca source/eval do valor); exige dono=usuário e modo 0600/0400; allowlist de chaves: `PI_BYPASS_PERMISSIONS PI_COMPACT_AT PONYTAIL_QUIET_STARTUP PI_KNOWLEDGE_VAULT PI_GRAPHS_VAULT CODEGRAPH_AUTO_ROOT PI_SUBAGENT_RESPAWN PI_EFFORT_SANDWICH PI_EFFORT_SANDWICH_TURNS`; variável já exportada vence; aspas simples/duplas removidas.
2. `export CLAUDE_CONFIG_DIR=$HOME/.pi/agent/claude-home` (pi-code lê config Claude daqui; isola de ~/.claude).
3. `PONYTAIL_QUIET_STARTUP=1` (default); `PI_COMPACT_AT=250000` (default; par com `scripts/compaction-400k.py` que gera `compaction.modelOverrides` no settings.json).
4. Flags consumidas (removidas do argv): `--bypass` / `--dangerously-skip-permissions` → `PI_BYPASS_PERMISSIONS=1`; `--safe` / `--no-bypass` → 0. Default `PI_BYPASS_PERMISSIONS=0`.
5. Subcomandos `install|remove|uninstall|update|list|config|auth|mcp` → `exec ~/.pi/agent/bin/pi "$@"` direto (sem flags de sessão).
6. Injeta `--no-approve` salvo `--approve|-a` explícito antes de `--` (projeto `.claude` nunca carregado).
7. Patches pi-code (ver §2.1): confere versão do pi-code (`$HOME/.pi/agent/npm/node_modules/pi-code/package.json`) == `PI_HARNESS_PI_CODE_VERSION`(1.7.0), senão avisa e pula. Alvo `~/.pi/agent/npm/node_modules/pi-code/extensions`.
8. `pi_fix_check`: avisa se sumiram `Partial<MainStats>` (fleet-ui/panel.ts), `subagent/respawn/index.ts`, `DONE_RULE` e `plan-workflow/SKILL.md` em plan-mode/index.ts.
9. `sed -i` comenta `if (!trusted) return TRUST_GATE` em goal.ts (desliga trust do /goal; restaura antes de reverter patch).
10. Patches pi-core (§2.2) só se `~/.pi/agent/install/current-version` == `PI_HARNESS_PI_VERSION`(1.5.2): `cache-warm-identity.mjs` (se `piSameContextMessage` ausente em dist/core/sdk.js) e `mcp-close-grace.mjs` (se `STDIN_CLOSE_GRACE_MS=500` presente em dist/bundle/chunks).
11. `set -- --exclude-tools web_search "$@"`; `exec ~/.pi/agent/bin/pi "$@"`.
Env lidas/escritas pelo código do repo (contagem de ocorrências): `PI_CODE_SUBAGENT`(64; marca processo filho do subagent), `PI_CODE_SUBAGENT_DEPTH`(14), `CLAUDE_CONFIG_DIR`(48), `NO_COLOR`, `PI_REDUCED_MOTION`, `PI_NERD_FONT`, `PI_ASCII_ICONS`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, `PI_BYPASS_PERMISSIONS`, `PI_COMPACT_AT`, `PI_EFFORT_SANDWICH(_TURNS)`, `PI_HEADLESS_LEAN|TRIM|TOOLS|FLOOR`, `PI_BASH_TIMEOUT_BG`, `PI_TODO_SYNC`, `PI_PREFIX_CACHE_1H`, `PI_AUTO_RESUME`, `PI_PLAN_GATE`, `PI_COMPLETION_GATE`, `PI_SOUND_NOTIFY`, `PI_UI_STATE`, `PI_SUBAGENT_RESPAWN`, `PI_KNOWLEDGE_VAULT`, `PI_GRAPHS_VAULT`, `CODEGRAPH_AUTO_ROOT|BIN|STATUS_TTL|AUTO_STATE`, `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_SESSION_FILE`, `PI_MCP_CONFIG`, `PI_HARNESS_*` (PI_VERSION, PI_CODE_VERSION, MANIFEST, SKIP_EXT_DEPS, BUNDLE, E2E_NET, ALLOW_NO_TRUFFLEHOG, TMP_CHECK_PATH), `PI_LOCAL_ENV`, `PI_WRAPPER_TEST`, `PI_API` (`PI_HARNESS_API`), `PONYTAIL_QUIET_STARTUP`, `PONYTAIL_SUBAGENT_MATCHER` (settings env), `EIO_BACKEND=posix`, `BENCH_*` (REPO, STATE, MODEL, REPO_URL, STAGE_ROOT).

## 2. Patches
### 2.1 pi-code (claude-home/patches/pi-code/, aplicados em `…/pi-code/extensions` com `patch -p1 -N`, ordem alfabética do glob: sufixos z/zz/… impõem ordem)
Reaplicação: a cada boot; "stack aplicada" = reverter toda a pilha em cópia temporária (ordem inversa) sem erro → nada a fazer; senão por patch: reverse --dry-run ok = já aplicado, forward --dry-run ok = aplica, senão avisa "redo the patch". CI: `scripts/check-patch-stack.sh` (baixa pi-code@1.7.0, confere sha1, aplica/reverte). Cada patch tem `*.test.ts` (node:test) e `orig/` guarda originais.
| patch (linhas) | alvos em pi-code/extensions | mudança |
|---|---|---|
| goal.patch (872) | goal.ts, internal/goal-evaluator.ts, internal/goal-ui.ts, internal/model-complete.ts | /goal sem trust, ciclo de vida/avaliador/UI (testes goal.test.ts, goal-lifecycle.test.ts) |
| commands-print.patch (56) | commands.ts | slash-commands também em modo print (`-p`) |
| notify-focus.patch (62) | notify.ts | notificação só fora de foco |
| rewind-tree.patch (87) | git-checkpoint.ts | rewind em árvore |
| statusline-multiline.patch (168) | status-line.ts | status-line multilinha (HUD) |
| subagent-nesting.patch (248) | subagent/{background,concurrency,index,modes,run}.ts, nesting/index.ts | subagents aninhados (profundidade 3) |
| subagent-panel.patch (2547) | subagent/fleet/*, fleet-ui/{index,palette,panel,viewer,view-model}.ts, background.ts | painel de frota (store, tracker, inbox, detach) |
| subagent-render.patch (563) | subagent/index.ts, transcript/{call,format,index,layout,result}.ts | render de transcrição de subagent |
| team.patch (808) | subagent/team/*, fleet-ui, run.ts, index.ts | times de agentes (feed, route, tasks, ui) |
| todo-collapse.patch (161) | todo.ts | todo colapsável |
| zz-hotkeys-no-alt.patch (63) | plan-mode/index.ts, README | hotkeys do plan-mode sem Alt |
| zz-panel-main-root.patch (245) | fleet-ui/{index,panel,view-model}.ts | raiz "main" no painel |
| zz-subagent-respawn.patch (222) | subagent/run.ts, respawn/index.ts | respawn de subagent foreground (env `PI_SUBAGENT_RESPAWN`) |
| zzz-panel-column0.patch (28) | fleet-ui/panel.ts | coluna 0 |
| zzzz-plan-done-rule.patch (30) | plan-mode/index.ts | DONE_RULE ([DONE:n]) |
| zzzzz-plan-sota.patch (410) | plan-mode/{index,utils}.ts | plan-workflow/tiers de perguntas |
| zzzzzz-subagent-send.patch (373) | fleet/{inbox,source,store,types}.ts, index.ts, params.ts, registry-text.ts | `send` a subagent em execução |
| zzzzzzz-subagent-model-effort.patch (328) | fleet/{types,tracker}.ts, run.ts, background.ts, fleet-ui/*, runtime-label.ts | model/effort por spawn + política /subagents-setup |
| zzzzzzzz-statusline-provider.patch (32) | status-line.ts | provedor no status |
Suporte: `orig/` (13 originais), `subagent-panel/setup.ts`, 6 testes fleet, `team/` 2 testes, mais um teste por patch (60 arquivos em claude-home/patches).
### 2.2 pi-core (claude-home/patches/pi-core/, scripts node que reescrevem dist do pi 1.5.2; idempotentes; saída 2 = não casou)
- `cache-warm-identity.mjs` (59 l; teste bin/tests/cache-warm-identity.test.ts): em dist/core/sdk.js e bundle troca `messages.every(...===message)` por `piSameContextMessage(...)` (aquecimento de cache da Anthropic; doc pi-memory-cache-sota-2026-11-13.md).
- `mcp-close-grace.mjs` (74 l; teste mcp-close-grace.test.ts): `STDIN_CLOSE_GRACE_MS` 500→100 em bundle/chunks/*.js e pi-mcp/dist/transports/stdio.js (spec 0003).
### 2.3 third-party (patches/third-party/, aplicados por `install-lib.sh apply_patch` fail-closed no staging)
- `pi-lsp.patch` (4080 l): extensions/pi-lsp/{index,post-edit,process}.ts + testes, _shared/config/{config,trust}.ts, package-lock → diagnósticos pós-edição, tratamento de processo, shutdown.
- `ponytail.patch` (351): pi-extension/index.js (+testes), 6 skills ponytail-* (alias args, subagent matcher, disable-model-invocation).
- `ralph-loop.patch` (26): adiciona scripts/pi-ralph-start.sh.

## 3. extensions/ (23 unidades; carregadas via `~/.pi/agent/extensions/` por symlink do publish.list; API: `@earendil-works/pi-coding-agent` ExtensionAPI, `@earendil-works/pi-tui`)
Linhas = wc -l do(s) arquivo(s) fonte (sem testes). "pi.on" = eventos assinados.
| unidade (caminho) | linhas | o que faz | APIs do pi usadas | deps |
|---|---|---|---|---|
| extensions/auto-resume/index.ts | 301 | retoma sessão após erro transitório do provedor esgotados os retries (também subagents) | on: after_provider_response, agent_before_settle, message_end; ui.notify/setStatus; env PI_AUTO_RESUME | — |
| extensions/bash-timeout/index.ts | 84 | timeout default 600 s, teto 1800 s; opt-in segundo plano (spec 0008) | on: tool_call, tool_result | — |
| extensions/bypass-permissions/index.ts | 87 | /bypass, Ctrl+Shift+B; estado do bypass lido pelo guard | on: session_start; registerCommand bypass; ui.notify/setStatus/theme; pi-tui | hooks/guard.py (via env PI_BYPASS_PERMISSIONS) |
| extensions/cache-prefix-probe/index.ts | 58 | diagnóstico TEMPORÁRIO de prefixo de cache (grava hashes em ~/.cache/pi-cache-probe) | on: before_provider_request | claude-home/bin/telemetry/cache_probe_join.py |
| extensions/compact-at-400k.ts | 67 | compacta em PI_COMPACT_AT (250k) como rede de segurança | on: agent_settled; ui.notify | scripts/compaction-400k.py |
| extensions/completion-gate.ts | 172 | bloqueia fim de turno se editou código sem checagem verde depois | on: agent_before_settle | teste bin/tests/gates/ |
| extensions/dev-commands/{index 16, copy-code 78, keybindings 44}.ts | 138 | /copy-code [N], /keybindings (edita keybindings.json) | registerCommand ×2; ui.select/editor/notify | — |
| extensions/effort-sandwich/index.ts | 33 | thinking high nos N primeiros turnos de `pi -p` (opt-in, spec 0009) | on: turn_start | importa ../headless-lean/index.ts |
| extensions/footer-no-stats.ts | 41 | footer só com status das extensões | on: session_start; ui.setFooter; pi-tui | — |
| extensions/headless-lean/index.ts | 204 | `pi -p`: `<cwd>` fora do prefixo em cache, poda ferramentas/respostas (spec 0002) | on: before_agent_start, before_provider_request, session_start, tool_result | — |
| extensions/no-context-files-covers-claude-md.ts | 67 | tira CLAUDE.md/rules do pi-code do contexto (paridade CC) | hooks do pi-code (session_start/before_agent_start) | pi-code |
| extensions/no-web-search.ts | 18 | desliga web_search do pi-code em toda sessão e subagents | on: session_start | redundante com `--exclude-tools` do wrapper |
| extensions/pi-docs/index.ts | 85 | troca seção `docs` do prompt por ponteiro de uma linha | on: before_agent_start; registerCommand pi-docs; systemPromptOptions.sections.docs | — |
| extensions/plan-gate.ts | 194 | plano aprovado roda até o fim e fecha com plan-reviewer | on: agent_before_settle | pi-code plan-mode (+patch DONE_RULE), agents/plan-reviewer.md |
| extensions/prefix-cache-1h/index.ts | 41 | cache 1h só no prefixo (tools+system) da sessão interativa | on: before_provider_request | — |
| extensions/puxar.ts | 88 | /puxar <perfil>: importa sessão do Claude Code | registerCommand puxar; ui.notify | claude-home/bin/puxar/puxar.py |
| extensions/sound-notify/index.ts | 49 | som local ao fim real do turno | on: agent_settled | — |
| extensions/sticky-prompt/{index 82, sticky 58}.ts | 140 | última mensagem do usuário fixa no topo (fullscreen) | on: message_end, session_start, session_tree; ui.setWidget; **campos internos do pi-tui 1.5.2** | — |
| extensions/syntax-check/index.ts (+package.json, lock) | 154 | erro de sintaxe pós edit/write via tree-sitter-wasm | on: tool_call, tool_result | npm @vscode/tree-sitter-wasm 0.3.1; complementa pi-lsp |
| extensions/todo-sync/index.ts | 73 | lembrete quando a lista todo fica parada | on: tool_result | pi-code todo |
| extensions/ui/{index 12, a11y 50, btw 112, diff 263, editor 187, history 239, terminal 105}.ts | 968 | /btw, /diff, /rename, /vim, Ctrl+R/S, a11y NO_COLOR/mono, título e foco do terminal | registerCommand btw,diff,rename,vim; on: session_start, session_info_changed, agent_start, agent_settled, session_shutdown, stdin data; ui.custom/setEditorComponent/getEditorText/setEditorText/setHeader/setTheme/setWorkingIndicator/onTerminalInput | a11y usado por ui-visual; temas themes/mono.json |
| extensions/ui-visual/{index 10, header 87, icons 47, tools 183, working 97}.ts | 424 | cabeçalho, indicador de trabalho, renderers read/bash/edit/write/grep/find/ls | on: session_start, agent_start/settled, message_update, tool_execution_start/end, session_shutdown; registerToolRenderer; ui.setHeader/setWorkingIndicator/setWorkingMessage/setHiddenThinkingLabel | importa ../ui/a11y.ts; copia pi-logo (não exportado) |
| extensions/up-dequeue/index.ts | 24 | ↑ restaura fila de steering/follow-up | on: session_start; ui.onTerminalInput/getEditorText | — |
Testes: 22 arquivos (*.test.ts) em auto-resume, bash-timeout, dev-commands/test, effort-sandwich, headless-lean, pi-docs, sticky-prompt, syntax-check, todo-sync, ui/test(6), ui-visual/test(5), up-dequeue; + claude-home/bin/tests/*.test.ts (cache-warm, compact-at-400k, completion-gate, no-context-files, plan-gate, prefix-cache-1h, sound-notify).
Dependências cruzadas: effort-sandwich→headless-lean; ui-visual→ui/a11y e icons; ui/editor→ui/history; dev-commands interno; extensões dependem de pi-code (plan-gate, todo-sync, no-context-files), do wrapper (env) e do hook guard (bypass).
Settings: `packages` = pi-code (extensions `!extensions/mcp/**`, MCP vem do mcp.json próprio), ./vendor/pi-lsp, ./vendor/ponytail.

## 4. claude-home/ (CLAUDE_CONFIG_DIR) — 17 agents, 227 arquivos em 30 skills, 1 rules, 4 rules-ref, 21 hooks, 57 bin, 17 commands, 29 docs, 1 plugin, 2 lite, 60 patches; evals/ e settings/ NÃO existem (só `settings.json.example`; evals em bin/evals)
- agents (17): Explore, Plan, claim-verifier, code-reviewer, gate-runner, general-purpose, git-delivery, lane-integrator, perplexity-scout, plan-reviewer, reliability-reviewer, research-scout, security-reviewer, swarm-worker, test-author, test-reviewer, web-scout (.md com frontmatter `model:`; validados por bin/checks/check-agents.py).
- skills (30 dirs): agent-routing agent-systems atualizador code-simplification codegraph context-economy deep-search diagnose differential-review doces-ou-travessuras engineering-standards git-workflow graph-engineering insecure-defaults lane-integration loop-engineering perplexity-urls plan-workflow pr-review property-based-testing quality-gates ripple-hunt sdd-workflow security-audit sharp-edges soteiros swarm-orchestration tdd to-questionnaire variant-analysis (validadas por scripts/ci/lint/skill_lint.py; skills opcionais como impeccable ausentes).
- rules (1): rules/safety.md. rules-ref (4): delivery-and-orchestration, docs-and-knowledge, harness-economy, research-and-tools. Raiz: CLAUDE.md, CLAUDE.headless.md; lite/APPEND.md + lite/settings.json (perfil leve, só guard 5 s).
- commands (17): cancel-ralph claude-hud-configure claude-hud-setup claude-tier clean_gone code-review commit-push-pr commit diff-review insecure-defaults-audit pre-launch ralph-help ralph-loop review-pr revise-claude-md skill-gen swarm.
- hooks (settings.json.example, estilo Claude Code, executados pelo hooks do pi-code):
  - PreToolUse, matcher `Bash|Edit|Write|Read`: `hooks/guard.py` (799 l; deny catastrófico sempre, "ask" auto-aprovado com bypass; testes test_guard.py, fuzz/test_guard_fuzz.py).
  - SessionStart `startup|resume|clear|compact`: `hooks/graph_context.py` (313; linha Graph:/workspace), `hooks/dispatch/hook-dispatch.sh` (observe-only), `hooks/impeccable_gate.sh hook`.
  - SubagentStart `*`: graph_context.py.
  - PostToolUse `*`: hook-dispatch.sh (jq; contrato de campos; claims/patterns.ere); PostToolUse `Edit|Write`: impeccable_gate.sh.
  - Stop: `vendor/ralph-loop/hooks/stop-hook.sh`, impeccable_gate.sh.
  - statusLine: node `plugins/claude-hud/statusline.mjs` (+ bin/hud/*).
  - env no settings: PONYTAIL_SUBAGENT_MATCHER, EIO_BACKEND=posix.
  - Demais arquivos: hooks/claims/claims.py, hooks/fixtures/pi-code-1.7.0/*.json (7 payloads), test_hook_budget.py, test_graph_context.py, test_impeccable_gate.py, dispatch/test_dispatch.py.
- bin (57): cache-misses.sh, git-deliver, mcp-header.sh, pi-image.mjs, port-agents.py; checks/{arg-expansion-check.mjs, check-agents.py, check-instructions.py, skill-usage.py, README, 2 testes}; doctor/{pi-doctor, pi-typecheck, prune-sessions, README}; evals/{plan_ab.py, plan_ab_cases.jsonl, test_plan_ab.py, harbor/(bundle.sh, omp-release.sh, omp_agent.py, pi_harness_agent.py, pi_vanilla_api_agent.py, run.sh, README, tests ×3)}; hud/{claude-hud-pi-transcript, -provider, -statusline, -usage .mjs + 4 testes}; puxar/{puxar.py,test}; structure/{structure.py,test}; telemetry/{cache_probe_join.py, cache-remeasure.sh, pi_telemetry.py, 2 testes}; tests/{cache-warm-identity, compact-at-400k, config/models-example, gates/completion-gate, no-context-files, plan-gate, prefix-cache-1h, sound-notify}.test.ts, pi-ui-final-gate.sh, terminal-sota/{e2e.sh,gate.sh}.
- docs (29): agent-contract.md, context-economy-extensions-2026-11-12, external-eval-terminal-bench-2026-11-13, goal, pi-agent-fleet-2026-11-12, pi-agents-ui-teams-sota-2026-11-13, pi-claude-harness-transfer-2026-11-12, pi-commands, pi-graph-loop-harness-sota-2026-11-13, pi-hooks-port, pi-instructions, pi-memory-cache-sota-2026-11-13, pi-multi-agent-2026-11-11, pi-subagent-send-2026-11-13, pi-terminal-sota-2026-11-13, pi-ui-sota, plan-sota-2026-11, preamble-diet-completion-gate-2026-11-13, subagent-model-effort, third-party-adoptions-2026-11-13 (.md); research/{2026-11-11-pi-multiagent-sota.md, 2026-11-13-graph-loop-harness-sota.md + .ledger.json, 2026-11-plan-sota.md}; third-party/{addy-agent-skills/LICENSE, agent-research-20260920/research-core.md, knowledge-work-plugins/README.md, mattpocock-skills/LICENSE, obra-superpowers/LICENSE}.

## 5. themes, npm, install, publish, third-party, *.example
- themes/mono.json, themes/tokyo-night.json: nome=arquivo, 56 chaves de cor cada (tema padrão `tokyo-night`; mono usado por NO_COLOR via ui/a11y.ts).
- npm/package.json: nome `pi-extensions`, `private:true`, dep única `pi-code` 1.7.0; npm/package-lock.json. **Não é publicado no npm** (private); "publish" aqui = copiar via publish.list/symlinks. extensions/syntax-check/package.json (`pi-syntax-check`, private).
- install.sh (201 l) + scripts/install-lib.sh (210): modos (a) padrão `[--with-optional]`: preflight (node npm git patch jq curl tar sha256sum) → verify_npm_pin → valida manifest → fetch_third_party em STAGE (git shallow commit exato / npm sha512, https obrigatório, licença sha256, patch fail-closed, `npm ci --omit=dev --ignore-scripts`) → install_pi_core (baixa package.json+lock de `https://pi.dev/api/installer/releases/1.5.2/`, `npm ci`, sha256, launcher em ~/.pi/agent/bin/pi, release em install/releases/) → install_npm_deps (npm ci em npm/, confere pi-code 1.7.0) → install_ext_deps (npm ci nas extensões com package.json; `PI_HARNESS_SKIP_EXT_DEPS`) → install_third_party (copia p/ dest, backup). (b) `--link [--apply]` symlinks de publish.list (dry-run default; manifest em ~/.pi-backup/<ts>/link-manifest.tsv). (c) `--restore [ts]`. Nunca toca auth*.json, mcp.json, sessions/. Teste: scripts/test_install.sh.
- publish.list (502 linhas, TSV `<destino com $HOME>\t<caminho no repo>`): lista de arquivos que `--link` instala em ~/.pi/agent (bin/pi→~/.local/bin/pi; extensions, claude-home, themes, scripts/compaction-400k.py). `.githooks/pre-commit` bloqueia paths fora dela/allowlist.
- third-party.json: ver §0 (5 componentes; dest `vendor/…` ou `claude-home/vendor/…` relativo a ~/.pi/agent).
- settings.json.example: packages[pi-code@1.7.0 (extensions `!extensions/mcp/**`), ./vendor/pi-lsp, ./vendor/ponytail], theme, compaction.enabled, defaultProjectTrust="never", retry{enabled,maxRetries 10,baseDelayMs 2000,maxAgentDelayMs 60000}, shellCommandPrefix (GIT_EDITOR=true… PAGER=cat…), quietStartup="header".
- mcp.json.example: mcpServers perplexity (npx @perplexity-ai/mcp-server@1.3.0), brave-search (@brave/brave-search-mcp-server@2.1.4), exa (url), context7 (url), codegraph (`codegraph serve --mcp`), playwright (@playwright/mcp@0.0.85); segredos por `${ENV}`.
- models.json.example: providers.anthropic.modelOverrides["claude-sonnet-5-5"].compat.allowedFallbackModels[{provider, model claude-sonnet-5, cost{input,output,cacheRead,cacheWrite}}] (teste bin/tests/config/models-example.test.ts).
- lsp.json.example: version 1; servers typescript (typescript-language-server), pyright, ruff, gopls, rust-analyzer — chaves id, include, exclude, rootMarkers, bin, args, cwd, languageIdByExtension, startupTimeoutMs, diagnosticsWaitMs (consumido pelo pi-lsp).
- local.env.example: ver allowlist §1 (9 chaves, modo 0600).
- claude-home/settings.json.example: hooks/statusLine/env (§4).

## 6. scripts/, CI e governança
scripts/: check-leaks.sh (221; gitleaks+trufflehog+identificadores pessoais; modos --tree|--staged|--history|--selftest), check-patch-stack.sh (39), check-refs.py (143; referências de skills/agents/paths inexistentes; allowlist refs-allow.txt; teste test_check_refs.py), compaction-400k.py (37), install-lib.sh, test_install.sh (114), fixtures/leak/clean.txt.
scripts/ci/: changed-files.sh (12), install-tools.sh (52; binários pinados sha256), local.sh (93; roda ci-static/ci-security/instruction-budget localmente em HOME descartável — doc docs/ci-local.md), run-static.sh (232: skill lint, testes install/refs/python/node, diff coverage; só alterados: ruff, mypy --strict, biome, shellcheck, shfmt, markdownlint, structure; arg `mutation`), run-security.sh (174: SHA-pin/permissions policy, actionlint, zizmor --min-severity medium, check-leaks + trufflehog --only-verified no histórico, semgrep --error, osv-scanner HIGH/CRITICAL=0), instruction_budget.py (161; + baseline .json + teste; orçamento das instruções sempre carregadas), lint/{core_scope.py (126; confere docs/specs/0005 vs skills/agents/extensions entregues), skill_lint.py (96), structure_changed.py (68), 2 testes}, biome.json, markdownlint.jsonc (+ markdownlint/package.json/lock), osv-scanner.toml, requirements-ci.in/.txt.
.github/workflows (todas com actions pinadas por SHA, harden-runner 1d88384 v2.22.4, checkout 3d3c42e v7.0.1):
- ci-static.yml: triggers pull_request, merge_group, push; jobs `ci-static` (checks: ci-static; setup-python 3.12 v7.1.0, setup-node 24 v7.1.0; `install-tools.sh shellcheck shfmt biome rg`; `run-static.sh`) e `mutation` (check `ci-mutation`; `run-static.sh mutation`).
- ci-security.yml: pull_request, merge_group, push; job `ci-security` (install actionlint gitleaks trufflehog osv-scanner shellcheck rg; `run-security.sh`).
- instruction-budget.yml: pull_request, merge_group, push; job `instruction-budget` (`instruction_budget.py check --labels-from-event`).
- codeql.yml: push, pull_request, schedule cron `41 6 * * 3`, dispatch; job `Analyze (${{matrix.language}})` (github/codeql-action init/analyze 33d7b85 v4.39.3).
- scorecard.yml: push, cron `23 9 * * 1`, dispatch; job `Scorecard analysis` (ossf/scorecard-action fa7117d v2.5.0 + upload-sarif).
- Checks exigidos pelo ruleset `.github/rulesets/main.json`: ci-static, ci-security, instruction-budget, **bench-pr** (status postado localmente por bench/tools/bench-pr.sh; não há workflow); squash only, histórico linear, 0 aprovações, strict status checks, sem bypass.
Outros: .github/{CODEOWNERS (`* @marcioazam`), dependabot.yml (github-actions `/` e npm `/npm`, semanal, cooldown 7 d, agrupado), zizmor.yml (hash-pin), release.yml (categorias de changelog por label), PULL_REQUEST_TEMPLATE.md, ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml, DISCUSSION_TEMPLATE/{ideas,q-a}.yml}. .githooks/pre-commit (bloqueia paths fora de publish.list/allowlist + `check-leaks.sh --staged`). .pre-commit-config.yaml (ruff-check/format v0.17.5, shellcheck 0.11.0, shfmt 3.14.1, actionlint 1.7.12, gitleaks 8.30.1, todos por SHA). .gitleaks.toml (default + 2 allowlists), .leak-allow (path:regex benignos), .editorconfig (utf-8, LF, 2 espaços, py 4), .gitattributes (`* text=auto eol=lf`, binários). Raiz: CHANGELOG, CODE_OF_CONDUCT, CONTRIBUTING, LICENSE, NOTICE, README, SECURITY, SUPPORT.

## 7. bench/ (808 arquivos em bench/; 788 em suites/)
- Código: run.py (CLI `bench run|post-status|…`), runners.py, gate.py (compara com baseline), report.py, stats.py, evidence.py, arms.toml, suites.toml (suites s1..; `est_cost_usd`), capabilities.toml.
- arms/ (7): claude-vanilla, ny-pi, omp, pi-vanilla (braços comparados), oauth-token.sh, overlay-sha.sh, overlay.list. classify/ (2), contract/ (8; fake_api, speed, regras), faults/ (7; injetor de falhas), metrics/ (8), power/ (3; simulação de poder), tasks/ (7; swebenchpro, tb2, tb41 + excluídas), tests/ (19), tools/ (11): bench-pr.sh (poller local do status `bench-pr`, `--poll|--pr N`, worktree descartável, gate vs baseline main), bench-nightly.sh (tier full 03:30, nunca atualiza baseline), gate_real.py, systemd/{bench-pr,bench-nightly}.{service,timer} (timer PR a cada 10 min; instalação manual em ~/.config/systemd/user; env em ~/.config/ny-pi/bench.env: BENCH_REPO obrigatório, BENCH_STATE, BENCH_MODEL, BENCH_REPO_URL).
- suites/ (788): hard/ 12 tarefas (577 arquivos), multi/ 10 (113), plan/ (94; casos plan-ask-*), check_oracles.py + teste + conftest + README.
- Baselines em docs/bench/ (31): baseline-main/{meta.json,runs.jsonl,verdict.json}; BASELINE-VANILLA-2026-11.{md,json}; baseline-vanilla-2026-11/{opus,sonnet,tb41}/{cc-vanilla,ny-pi,omp,pi-vanilla}/{meta.json,runs.jsonl} (24 arquivos); coverage-map.json; RUNBOOK.md (666 l).

## 8. docs/ (39 arquivos)
- docs/ci-local.md: CI local e quando o remoto não roda.
- docs/specs/0001-publish-harness.md (277 l): publicação do harness (decisões, glossário, publish.list). 0002-headless-lean.md: sessão `pi -p` enxuta (cwd fora do cache, medições). 0003-boot-exit.md: latência de boot/saída (grace MCP 500→100 ms). 0005-core-scope.md (177): escopo do núcleo generalista, o que fica/sai (checado por core_scope.py). 0006-instruction-format.md: formato das instruções ao modelo. 0008-bash-timeout-background.md: bash estourado segue em background (opt-in). 0009-effort-sandwich.md: esforço alto nos primeiros turnos. (0004 e 0007 ausentes; não há ADRs separados.)
- docs/bench/ (31): RUNBOOK + baselines (§7).
- Ver também claude-home/docs (29, §4). Não há pasta de runbooks além de docs/bench/RUNBOOK.md e docs/ci-local.md.

## 9. Acoplamentos "por fora" que somem num fork do core
1. Wrapper `bin/pi` + `~/.local/bin/pi` + launcher `~/.pi/agent/bin/pi`: flags `--bypass/--safe/--no-approve/--exclude-tools web_search` viram flags/defaults nativos.
2. Patch-on-boot por `patch -p1` e `sed -i` em `~/.pi/agent/npm/node_modules/pi-code/extensions` (19 patches, trust sed do goal.ts, pi_fix_check, pilha reversível, pin de versão) → vira código-fonte; some check-patch-stack.sh e o pin sha1 do tarball.
3. Reescrita de dist minificado do pi (`cache-warm-identity.mjs`, `mcp-close-grace.mjs`; regex em bundle/chunks, `install/current-version`, `PI_HARNESS_PI_VERSION`) → commit no core.
4. `CLAUDE_CONFIG_DIR=~/.pi/agent/claude-home` + isolamento de ~/.claude + `--no-approve` para não carregar `.claude` de projeto; `no-context-files-covers-claude-md.ts` (contorna que pi-code injeta CLAUDE.md/rules).
5. Allowlist de `local.env` (9 chaves) + env como API (PI_BYPASS_PERMISSIONS, PI_COMPACT_AT, PI_EFFORT_SANDWICH*, PI_SUBAGENT_RESPAWN, PI_CODE_SUBAGENT[_DEPTH], PONYTAIL_*, CODEGRAPH_*): vira configuração tipada em settings.
6. Extensões que fazem monkey-patch de internos: sticky-prompt (campos internos do pi-tui 1.5.2), ui/a11y (BuiltInHeader/onLogoClick), ui-visual/header (cópia de pi-logo não exportado), ui-visual/tools (registerToolRenderer), ui/terminal (observer em process.stdin, tui-alt-screen), pi-docs (systemPromptOptions.sections.docs), headless-lean/prefix-cache-1h/cache-prefix-probe (mutam payload em before_provider_request), compact-at-400k (rede para compaction.modelOverrides), footer-no-stats.
7. Caminhos fixos `~/.pi/agent/**` (95 arquivos citam `.pi/agent`/`node_modules/pi-code`/`~/.local/bin/pi`), hooks em `settings.json` apontando `$HOME/.pi/agent/claude-home/hooks/*` e payloads Claude-compat (guard.py, hook-dispatch.sh, graph_context.py) com fixtures por versão do pi-code → eventos nativos.
8. Instalador: pin de pi 1.5.2 por `pi.dev/api/installer/releases`, `npm/` com pi-code, `install_ext_deps`, symlinks publish.list/--link/--restore, third-party.json (ponytail, pi-lsp, ralph-loop, pr-review-toolkit, claude-red) com patches locais → embutir/forkar (pi-lsp.patch de 4080 linhas é o maior) ou manter como pacote.
9. Subcomandos que passam direto (install/mcp/…): `--exclude-tools`, mcp excluído do pi-code (`!extensions/mcp/**`) e MCP do pi separado.
10. Gates que checam o acoplamento: check-patch-stack.sh, core_scope.py, check-refs.py, structure_changed.py, instruction_budget.py, bench/contract (fake API), bench-pr (status local obrigatório).

## Lacunas
- Descrições de cada patch inferidas por nome+arquivos alvo+docs; conteúdo dos 872/2547 linhas não lido linha a linha. Conteúdo de skills (227 arquivos) e bench/suites listado por contagem, não arquivo a arquivo. Referências "orig/" e arquivos de teste de patches não descritos individualmente.
- Fronteira em aberto: quais eventos/hooks do pi-code 1.7.0 (goal, subagent, plan-mode) o fork deve expor como core API estável — decidir após ler `docs/specs/0005-core-scope.md` e `claude-home/docs/pi-commands.md`.
