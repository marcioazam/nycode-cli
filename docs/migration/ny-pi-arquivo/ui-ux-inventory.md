# Inventário de UI/UX do pi-harness (para revisão item a item)

Status: documento de **inventário**, não de decisão. Criado em 2026-11-13 como etapa prévia de um futuro redesign. Nada de código, tema ou UI foi alterado ao produzi-lo.
Não é auditoria nem certificação SOTA, e não houve pesquisa web. Toda evidência vem de **leitura de código**; **nenhuma superfície foi vista rodando** (sem tmux, sem testes, sem capturas).

## Índice

1. [Como ler e revisar](#1-como-ler-e-revisar)
2. [Mapa de camadas](#2-mapa-de-camadas)
3. [Docs existentes (preservadas)](#3-docs-existentes-preservadas)
4. Checklist por ondas
   - [Onda 1: cromo da tela (A)](#onda-1--cromo-da-tela-header-footer-status-título-foco)
   - [Onda 2: editor, histórico, fila e atalhos (B)](#onda-2--editor-histórico-fila-e-atalhos)
   - [Onda 3: transcript, tools e renderização de conteúdo (C)](#onda-3--transcript-tools-markdowncodediffimagens)
   - [Onda 4: overlays, seletores, ajuda, settings, auth (D)](#onda-4--overlays-seletores-ajuda-settings-modelos-sessão-auth)
   - [Onda 5: plan, goal, todo, fleet, rewind, compactação (E)](#onda-5--plan-goal-todo-fleet-status-rewind-compactação)
   - [Onda 6: som, notificação, erros, retries, loading, cancelamento (F)](#onda-6--som-notificação-foco-erros-retries-loading-cancelamento)
   - [Onda 7: tokens de design (G)](#onda-7--tokens-de-design-cores-fundos-bordas-spacing-fontes-ícones-animação-a11y)
   - [Onda 8: comandos e atalhos, defaults e overrides (H)](#onda-8--comandos-e-atalhos)
5. [Critérios do FUTURO redesign](#5-critérios-do-futuro-redesign-propostas-não-decisões)
6. [Lacunas honestas e riscos](#6-lacunas-honestas-e-riscos)
7. [Contagem e verificações locais](#7-contagem-e-verificações-locais)

## 1. Como ler e revisar

**Abreviações de caminho** (todas sem credenciais):

| Sigla | Caminho |
|:-|:-|
| `PCA/` | `~/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/` (pi nativo 1.5.2) |
| `IM` | `PCA/modes/interactive/interactive-mode.js` |
| `TUI/` | `~/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-tui/dist/` |
| `PC/` | `~/.pi/agent/npm/node_modules/pi-code/extensions/` (pacote pi-code 1.7.0, já com patches aplicados; **não** existe `npm/node_modules` dentro do repo) |
| `H/` | `~/code/pi-harness/` (repo; `extensions/` espelha `~/.pi/agent/extensions/`) |
| `patches/` | `H/claude-home/patches/pi-code/*.patch` e `H/claude-home/patches/pi-core/` |

**Colunas.** `ID` único e estável (letra da onda + número). `Fonte` = `caminho:linha`; "linha n/c" = arquivo lido mas linha não anotada. `Estado` = disponibilidade vs ativação:

- **N** nativo: código presente no dist do pi 1.5.2 (`IM` etc.); ativo por padrão, salvo nota.
- **H** extensão do harness: arquivo em `H/extensions/` **e** em `~/.pi/agent/extensions/` (listados lado a lado em `ls`), com entrada em `H/publish.list`. Carregamento em runtime **não** foi observado.
- **P** pi-code 1.7.0: `~/.pi/agent/settings.json` lista `npm:pi-code@1.7.0` em `packages`, com `!extensions/mcp/**` excluído. Efeito de patch = "forma aplicada" por dry-run reverso (relato em `/tmp/pi-ui-inventory-patches.md`); 12 patches deram resultado ambíguo.
- **?** não comprovado.
- **só-doc** descrito em documento, sem código conferido.

Em toda linha a coluna **Decisão** nasce como `☐` (pendente). Marque `M` manter, `R` refazer ou `X` remover, mais uma nota. O inventário não propõe resposta.

**Regras de leitura.** Nenhuma célula afirma aparência real (cores, larguras, truncamento): são intenções lidas no código. Termos entre aspas são textos literais do código; conflitos entre idiomas (inglês nativo × português harness) são fatos listados, sem juízo.

## 2. Mapa de camadas

| Camada | O que contribui | Donos principais | Como entra |
|:-|:-|:-|:-|
| **Nativa** (pi 1.5.2 + pi-tui) | Layout base, editor, seletores, /settings, /login, /model, /tree, compactação, header/footer padrão, Markdown, imagens, loader, alt-screen | `IM`, `PCA/modes/interactive/components/*`, `PCA/core/keybindings.js`, `TUI/components/*` | Binário |
| **Pacote pi-code 1.7.0** | question, todo, goal, plan-mode, subagent+fleet-ui, team, notify (OSC/bell), status-line (HUD), thinking, session-title, output-styles, memory, hooks, git-checkpoint (/rewind), MCP (excluído) | `PC/*.ts`, `PC/subagent/**`, `PC/plan-mode/**` | `settings.json` `packages`; patches aplicados por `bin/pi` só com pi-code = 1.7.0 e pi = 1.5.2 (`bin/pi:90-185`, relato dos patches) |
| **Patches** | Reescrevem partes do pi-code e do dist (fleet, plan-section, todo-collapse, hotkeys sem Alt, pulse-dot, interactive-display, send-now) | `H/claude-home/patches/` | `bin/pi` a cada start; falha só avisa (fail-open) |
| **Harness (extensões próprias)** | Header com logo, cromo de tools, indicador de trabalho, título/foco do terminal, editor vim+histórico, /diff, /btw, /copy-code, /keybindings, /puxar, som, sticky-prompt, footer sem stats | `H/extensions/**` | `~/.pi/agent/extensions/` |
| **Tema** | Cores/fundos/syntax: `tokyo-night` (ativo em `settings.json`) e `mono` (só `NO_COLOR`) | `H/themes/*.json` | `settings.json` `theme` |

Sobreposições vistas (dois donos): header (`H/extensions/ui/a11y.ts:46` × `H/extensions/ui-visual/header.ts:78`), indicador de trabalho (`H/extensions/ui/a11y.ts:48` × `H/extensions/ui-visual/working.ts:61`), título (`H/extensions/ui/terminal.ts:51` × session-title do pi-code), footer (`H/extensions/footer-no-stats.ts:20` × `PCA/modes/interactive/components/footer.js`), status-line (HUD do pi-code × widgets de plan/fleet/todo). Qual vence depende da ordem de carga: **não verificada**.

## 3. Docs existentes (preservadas)

Nada abaixo foi movido, substituído ou editado. Este arquivo apenas aponta para eles.

| Doc | Cobre |
|:-|:-|
| `H/claude-home/docs/pi-ui-sota.md` | `?`→hotkeys, `/vim`, `/rename`, NO_COLOR, `PI_REDUCED_MOTION`, título, foco, `/diff`, `/btw`, rewind, todo collapse, sticky-prompt |
| `H/claude-home/docs/pi-terminal-sota-2026-11-13.md` | Histórico Ctrl+R, rascunho Ctrl+S, `/copy-code`, `/keybindings`, Tokyo Night |
| `H/claude-home/docs/pi-interactive-display-2026-11-13.md`, `pi-interactive-parallel-2026-11-13.md` | Display interativo e paralelismo |
| `H/claude-home/docs/pi-agents-ui-teams-sota-2026-11-13.md`, `todo-widget-ui-2026-11-13.md`, `hotkeys-no-alt-2026-11-13.md` | Equipes, todo, regra sem Alt |
| `H/docs/ui-visual-header-background.md` | Fundo cortado em header/resultado de tool (`fit()`) |
| `H/README.md` | Instalação e overlay; não descreve telas |

Sem doc do harness: onboarding, login/logout, settings, seletores de modelo/sessão/árvore, compactação nativa, imagens, mensagens de erro, tokens de tema.

## 4. Checklist por ondas

Cada onda pode ser revisada de forma independente e opcional. Ordem sugerida: 7 (tokens) antes das telas que os consomem; 1 e 2 são o que se vê o tempo todo.

### Onda 1 · Cromo da tela: header, footer, status, título, foco

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| A01 | Header nativo (logo + dicas) | `IM:778,788-790`; `PCA/modes/interactive/components/pi-logo.js` | Logo e instruções compactas/expandidas; texto "Press … to show full startup help". `quietStartup: "header"` em `settings.json` (valor observado) | N; efeito do `quietStartup` no header não verificado | ☐ |
| A02 | Header do harness (logo, versão, atalhos; estado da sessão só no HUD, ver `docs/designs/onda1-cromo/README.md`) | `H/extensions/ui-visual/header.ts:1,76-86` | Substitui o nativo via `setHeader`; não roda em subagente (`PI_CODE_SUBAGENT=1`) nem com `NO_COLOR`; branch lida com `git rev-parse` (timeout 500 ms, l.68) | H | ☐ |
| A03 | Header plano (NO_COLOR) | `H/extensions/ui/a11y.ts:44-46` | Com `NO_COLOR`: tema `mono` na sessão + `plainHeader` | H | ☐ |
| A04 | Footer nativo | `PCA/modes/interactive/components/footer.js`; `IM:426,1679` | Estatísticas e auto-compact | N, substituído por A05 | ☐ |
| A05 | Footer sem estatísticas | `H/extensions/footer-no-stats.ts:20` | `setFooter` remove as estatísticas nativas (o que sobra não foi lido linha a linha) | H | ☐ |
| A06 | Status line / HUD multi-linha | `PC/status-line.ts:348,385,393`; patch `statusline-multiline`, `statusline-provider` | Widget de 2+ linhas abaixo do editor; fallback `setStatus('pi-code-status')` com `labelFooter`; rate-limit descartado ao trocar de provider | P (forma aplicada; multiline ambíguo) | ☐ |
| A07 | Aviso de rate limit 429 | `PC/status-line.ts:598` | `notify` warning "Provider rate limit reached (429)…" | P | ☐ |
| A08 | Status `plan-mode` | `PC/plan-mode/index.ts:158-160` | `⏸ plan` (cor `warning`) no status | P | ☐ |
| A09 | Status `goal` | `PC/goal.ts:310,322` | Texto `accent` com tempo decorrido | P | ☐ |
| A10 | Status de permissões (bypass) | `H/extensions/bypass-permissions/index.ts:37,45` | `⚠ bypass ligado` (cor `warning`) quando ON; nada no modo padrão; `notify` warning/info | H | ☐ |
| A11 | Título do terminal | `H/extensions/ui/terminal.ts:12,20,50-51` | `⠋ …` enquanto trabalha, `✓ …` ao terminar; `●` com movimento reduzido; base = `sessão · pasta` | H | ☐ |
| A12 | Rastreio de foco (DEC 1004) | `H/extensions/ui/terminal.ts:24-29,70` | Consome `\x1b[I`/`\x1b[O` em modo regular; alimenta o notify | H | ☐ |
| A13 | Título de sessão automático | `PC/session-title.ts` (156 linhas) | Conteúdo visual não lido | P / ? | ☐ |
| A14 | Estado da árvore de widgets acima/abaixo do editor | `PC/status-line.ts:348`, `PC/todo.ts:204`, `PC/subagent/fleet-ui/index.ts:85`, `PC/plan-mode/section.ts` | Quatro donos de `setWidget`; ordem vertical e disputa de espaço **não verificadas** | P | ☐ |
| A15 | Banner de projeto não confiável / confiança | `IM:3568-3575,4568`; `PC/internal/project-approval.ts:168` | Aviso nativo + `confirm('Trust this project?')`; `defaultProjectTrust` está em `settings.json` | N / P | ☐ |
| A16 | Avisos de startup e diagnóstico | `IM:577,894-955,1795` | "models.json error", "Migrated credentials…", falha de extensão "Features that load code on demand…" | N | ☐ |
| A17 | Piso de versão | `PC/version-floor.ts:24` | `notify` warning | P | ☐ |

### Onda 2 · Editor, histórico, fila e atalhos

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| B01 | Editor nativo | `IM:2560-2575` (`defaultEditor.onAction`); `TUI/components/editor.js` | Entrada multi-linha; ações por keybindings | N, substituído por B02 | ☐ |
| B02 | Editor do harness (vim opcional) | `H/extensions/ui/editor.ts:136-146,177-180` | `setEditorComponent` só se nenhum outro editor ativo; `/vim` alterna; Esc = normal, `i` = insert; avisos "indisponível" se houver outro editor | H | ☐ |
| B03 | Histórico (Ctrl+R) | `H/extensions/ui/editor.ts:77,161`; `H/extensions/ui/history.ts:199-208` | Overlay `ui.custom`: ↑/↓, Enter, Tab, Backspace, Esc/Ctrl+C | H | ☐ |
| B04 | Rascunho (Ctrl+S) e Ctrl+C→histórico | `H/extensions/ui/editor.ts:78,84` | Ctrl+C com texto guarda no histórico (comentário "↑ dev…" l.84) | H | ☐ |
| B05 | Prompt fixo no topo (sticky) | `H/extensions/sticky-prompt/index.ts:2-12,77` | Só fullscreen; linha flutuante com a última mensagem do usuário; clique rola até ela; depende de campos internos do pi-tui 1.5.2 e vira no-op se mudarem | H | ☐ |
| B06 | Fila de mensagens (steer/follow-up) | `IM:2810-2830,4050-4054,4064,4075` | Digitar durante streaming = steer; durante compactação = "Queued message for after compaction"; erro "Failed to send queued message" | N | ☐ |
| B07 | Desenfileirar (↑ com editor vazio) | `H/extensions/up-dequeue/index.ts:10-24`; keybinding `app.message.dequeue` | Reescreve ↑ em `ctrl+shift+↑` quando editor vazio e há pendência | H + override | ☐ |
| B08 | Enviar agora (Ctrl+Enter / Ctrl+X Ctrl+S) | `patches/pi-core/send-now/runtime.mjs:140,147,148` (relato) | Aborta o agente e `!bash` e envia; marcador verificado em `bin/pi` | P-core | ☐ |
| B09 | Modo bash `!cmd` / `!!cmd` | `IM:2790-2800` | `!!` fora do contexto; aviso "Press Esc to cancel it first" | N | ☐ |
| B10 | Colar imagem (Ctrl+V) | `IM:2585,2623,2641`; `PCA/utils/clipboard-image.js` | Erro "Failed to paste from clipboard" | N | ☐ |
| B11 | Editor externo (Ctrl+G) | `PCA/core/keybindings.js:47` | `app.editor.external` | N | ☐ |
| B12 | Autocomplete de comandos e arquivos | `TUI/components/select-list.js` (nome) | **Não lido**; aparência e limites desconhecidos | ? | ☐ |
| B13 | Hint `?` abre hotkeys | `H/claude-home/docs/pi-ui-sota.md` | só-doc; não achei o ponto no `editor.ts` ao ler | só-doc | ☐ |

### Onda 3 · Transcript, tools, Markdown/code/diff/imagens

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| C01 | Chrome de tools (read/bash/edit/write/grep/find/ls) | `H/extensions/ui-visual/tools.ts:30,83-165,170` | `renderCall`/`renderResult` próprios; preview limitado (`PREVIEW_LINES`), erro em `error`, saída em `toolOutput`, "· truncado" em `warning` | H | ☐ |
| C02 | Corte com fundo preservado (`fit`) | `H/extensions/ui-visual/tools.ts:34-45`; `H/docs/ui-visual-header-background.md` | Evita `ESC[0m` apagar o fundo do Box pai | H | ☐ |
| C03 | Ícones de tool (Nerd Font × Unicode) | `H/extensions/ui-visual/icons.ts:1,31-33,41-44` | `✓`, `✗`, `●`; Nerd com `PI_NERD_FONT=1`/kitty; `PI_ASCII_ICONS`/`NO_COLOR` forçam fallback | H | ☐ |
| C04 | Expandir tools (Ctrl+O) | `PCA/core/keybindings.js:37` | Alterna colapso | N | ☐ |
| C05 | Hide/show thinking (Ctrl+T) e rótulo | `PCA/core/keybindings.js:39`; `H/extensions/ui-visual/working.ts:62` | Rótulo "raciocinando…" quando oculto | N + H | ☐ |
| C06 | Render do tool `subagent` | `PC/subagent/index.ts:423-425`; `PC/subagent/render.ts`, `render-result.ts`; patch `subagent-render` (relato 3.4) | Tag `[scope]`, glifo de estado, árvore `├─ └─ │ ⎿`, hint de expandir, uso em dim | P (forma aplicada) | ☐ |
| C07 | Render do tool `question` | `PC/question.ts:257,271` | `renderCall`/`renderResult` com tema | P | ☐ |
| C08 | Render do tool `todo` | `PC/todo.ts:548,565,582` | `◐` (accent) ao iniciar, `✓` (success) ao concluir | P | ☐ |
| C09 | Mensagem de `goal` | `PC/goal.ts:583` (`registerMessageRenderer`) | Renderer próprio | P | ☐ |
| C10 | Markdown | `TUI/components/markdown.js`; tema `md*` | Cabeçalhos, código, links, citações, listas, hr por tokens de tema (G05) | N | ☐ |
| C11 | Blocos de código e cópia | `H/extensions/dev-commands/copy-code.ts:55-77` | `/copy-code [N]`; seletor "Copiar qual bloco?" | H | ☐ |
| C12 | Syntax highlight | tokens `syntax*` em `H/themes/tokyo-night.json` | Cores por token | N + tema | ☐ |
| C13 | Diff de edição (nativo) | tokens `toolDiffAdded/Removed/Context` | Cores do diff na tool `edit` | N + tema | ☐ |
| C14 | `/diff` interativo com comentários | `H/extensions/ui/diff.ts:180-227,240-259` | Lista de arquivos (↑/↓/Enter), corpo (↑/↓/PgUp/PgDn), comentário por linha; comentários vão ao editor; "Fora de um repositório git" / "Sem mudanças" | H | ☐ |
| C15 | `/btw` (pergunta lateral) | `H/extensions/ui/btw.ts:57-108` | Overlay com Markdown; Enter/Esc fecham; erros "Sem autenticação…", "/btw falhou" | H | ☐ |
| C16 | Imagens no transcript | `PCA/modes/interactive/components/image.js`; `TUI/components/image.js` | Formato e fallback **não lidos** | ? | ☐ |
| C17 | Abrir imagem | `H/extensions/image-open/index.ts:52,60` | `notify` warning em erros | H | ☐ |
| C18 | Limite/clamp de saída de bash | `H/extensions/bash-clamp/index.ts`; `bash-timeout/index.ts` | Efeito visual da truncagem não lido | H | ☐ |
| C19 | Saída de web search/fetch | `PC/web.ts:376,400` | Render não lido | P / ? (`no-web-search.ts` do harness existe) | ☐ |
| C20 | Mensagens de usuário/custom/tool (fundos) | tokens `userMessageBg`, `customMessageBg`, `toolPendingBg/SuccessBg/ErrorBg` | Cores de caixa por estado | N + tema | ☐ |

### Onda 4 · Overlays, seletores, ajuda, settings, modelos, sessão, auth

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| D01 | Contêiner de seletor | `IM:4156` (`showSelector`) | Overlay com `done` | N | ☐ |
| D02 | `/settings` | `IM:4179,4186,4211,4215,4230` | Auto-compact, projeto confiável, Esc Esc | N | ☐ |
| D03 | `/model` | `IM:4444-4475,4494-4501,4531,4539,4590` | Busca opcional; aviso de refresh e de assinatura | N | ☐ |
| D04 | `/scoped-models` | `IM:4653-4689` | Salvar/limpar/reordenar (`app.models.*`; override em ctrl+shift+↑/↓) | N + override | ☐ |
| D05 | `/thinking` | `IM:~4420,4427` | Erro "Unknown thinking level … Available levels"; `PC/thinking.ts` adiciona (não lido) | N + P | ☐ |
| D06 | `/tree`, `/fork`, `/clone` | `IM:4736,4785,4829-4830,2722,2727` | Seletor de mensagens; bloqueado durante compactação | N | ☐ |
| D07 | `/resume`, `/session` | `IM:4902,2707`; `main.js:608` | Seletor de sessão; cwd ausente | N | ☐ |
| D08 | `/trust` | `IM:4568,4564` | Seletor + erro "Could not save project trust" | N | ☐ |
| D09 | `/login`, `/logout` | `IM:5028,5050,5154,5435,2749`; `components/login-dialog.js`, `oauth-selector.js`, `auth-url.js` | Lista de provedores e diálogo; textos finais **não lidos** | N | ☐ |
| D10 | Onboarding primeira execução | `PCA/modes/interactive/components/first-time-setup.js`; `PCA/cli/startup-ui.js:98-132`; `main.js:585-588` | Só em instalação limpa com flag de experimentais; tema → telemetria opt-in; ↑↓/j/k, Enter, Esc. Com `settings.json` presente **não aparece** | N (inativo aqui, por leitura) | ☐ |
| D11 | `/hotkeys` | `IM:2717,5870-5935` | Markdown gerado dos keybindings reais | N | ☐ |
| D12 | `/changelog`, `/export`, `/import`, `/share`, `/bug`, `/copy`, `/name`, `/quit`, `/reload`, `/new` | `IM:2676-2727` (faixa) | Efeitos visuais de cada um não lidos individualmente | N | ☐ |
| D13 | `/keybindings` (editor do arquivo) | `H/extensions/dev-commands/keybindings.ts:34-42` | `ui.editor`; valida; grava com `.bak`; mensagens PT-BR | H | ☐ |
| D14 | `/rename` | `H/extensions/ui/editor.ts:122-131` | Mensagens "Sessão renomeada…" | H | ☐ |
| D15 | `/pi-docs on\|off\|auto` | `H/extensions/pi-docs/index.ts:75-82` | `notify`; uso em inglês | H | ☐ |
| D16 | `/bypass` e Ctrl+Shift+B | `H/extensions/bypass-permissions/index.ts:68-80` | `status`/on/off | H | ☐ |
| D17 | `/puxar` | `H/extensions/puxar.ts:38-85` | Importa sessão; notificações PT-BR | H | ☐ |
| D18 | Tool `question`: fallback select/input | `PC/question.ts:226,686,691` | Fallback `ui.select` + `ui.input("Your answer")`; UI custom principal (ver E01) | P | ☐ |
| D19 | `/output-style` | `PC/output-styles.ts:259-288` | `ui.select('Output style:')`; notificações em inglês | P | ☐ |
| D20 | `/memory`, memória carregada | `PC/memory.ts:469,542,628` | `select` de arquivo; "Memory: N memories loaded" | P | ☐ |
| D21 | `/context` | `PC/context-usage.ts:39-42` | `notify` info com uso do contexto | P | ☐ |
| D22 | `/hooks` e prompts de permissão por hook | `PC/hooks/index.ts:614,717,937-946` | `confirm("Allow … ?")`; resumo de hooks | P | ☐ |
| D23 | Confirmação de imports externos e agentes do projeto | `PC/context-imports.ts:624`; `PC/subagent/modes.ts:82` | `confirm` | P | ☐ |
| D24 | Confirmação de trust (pi-lsp) | `patches/third-party/pi-lsp.patch:469` (relato) | `select` "Trust once / Trust always / Reject"; **instalação não comprovada** | ? | ☐ |
| D25 | `/mcp` e prompts MCP | `PC/mcp/index.ts:354,910` | Excluído por `!extensions/mcp/**` em `settings.json`: comandos/tools desse módulo **não ativos** por esta config; origem do MCP real fora deste inventário | disponível, inativo | ☐ |
| D26 | `/subagents-setup`, `/agents`, `/tasks` | `PC/subagent/routing/command.ts:30-48`; `PC/subagent/index.ts:436-451` | Seleção de modelos; `/tasks` abre lista de runs (rodapé `↑↓ select · enter open · esc close`, relato) | P | ☐ |
| D27 | `/team` | `PC/subagent/team/index.ts:160-180` | `notify` "team mode on/off…" | P | ☐ |
| D28 | `/skills`/skill notices | `PC/skills.ts:175,202,287` | `notify` | P | ☐ |

### Onda 5 · Plan, goal, todo, fleet, status, rewind, compactação

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| E01 | `question` (UI custom) | `PC/question.ts:4-5,157-181` | Lista de opções + editor inline "Type something…" (single) ou checkboxes com espaço (`multiSelect`); `header` ≤12 caracteres; Esc no editor volta às opções, Esc nas opções cancela; contagem regressiva (`countdownSec`, l.157) | P | ☐ |
| E02 | `todo` widget | `PC/todo.ts:159-268,440`; patch `todo-collapse` | Widget persistente acima do editor; Ctrl+Shift+T recolhe a uma linha ("Todos N/M", `✓` quando tudo feito); lista concluída recolhe sozinha; indicadores acima/abaixo | P | ☐ |
| E03 | `/todos` overlay | `PC/todo.ts:588-603,295-296` | `ui.custom`; Esc/Ctrl+C fecham; fora do TUI vira texto simples | P | ☐ |
| E04 | `/plan` e modo plano | `PC/plan-mode/index.ts:158,193-196,273-281,317-382` | `select('Plan mode - what next?')`, `editor('Refine the plan:')`, atalho Ctrl+Shift+P; mensagens em inglês | P | ☐ |
| E05 | Seção de plano (passos) | `PC/plan-mode/section.ts`, `table.ts`; patch `plan-section` (relato 3.2) | ↓/↑, PgUp/PgDn, home/end, espaço (alterna passo), Enter (drawer), ←/→ (colapsar), Esc; ↓ com editor vazio dá foco; patch dá resultado ambíguo | P / ? | ☐ |
| E06 | `/plan-todos` | `PC/plan-mode/index.ts:370-374` | "No todos. Create a plan first with /plan" | P | ☐ |
| E07 | Gate de plano (harness) | `H/extensions/plan-gate.ts` (163 linhas), `completion-gate.ts` | Mensagens de bloqueio; texto não lido | H | ☐ |
| E08 | `/goal` | `PC/goal.ts:570-600` | Painel `ui.custom` no TUI; fora dele, texto de status; `/goal clear` | P | ☐ |
| E09 | Fleet: painel de runs | `PC/subagent/fleet-ui/index.ts:85,110`; `panel.ts:404-477` | Widget com runs; ↓/↑ seleção (↓ só com editor vazio), Enter, →/← expandir, `x` parar, Esc, Ctrl+B background | P | ☐ |
| E10 | Fleet: viewer de run | `PC/subagent/fleet-ui/viewer.ts:360,388` | Breadcrumb, estado, input `> `, navegação irmãos/filhos; rodapé de atalhos | P | ☐ |
| E11 | Fleet: paleta/chrome/view-model | `PC/subagent/fleet-ui/palette.ts`, `chrome.ts`, `view-model.ts`, `runtime-label.ts` | Cores e rótulos de estado; custo/tempo/tokens (relato `zz-panel-main-root`) | P | ☐ |
| E12 | Pulse dot | patch `zzzzzzzzzz-pulse-dot` (relato 3.3) | Spinner trocado por `· • ● ● • ·` (ponto verde pulsante) | P (forma aplicada, untracked) | ☐ |
| E13 | Run (tool `run`) widget | `PC/run/section.ts:114,134` | `setWidget` próprio | P | ☐ |
| E14 | Auto-resume | `H/extensions/auto-resume/index.ts:199` | `notify` warning com a mensagem da decisão | H | ☐ |
| E15 | `/rewind` | `PC/git-checkpoint.ts:516,652-698` | `select('Rewind to checkpoint:')`, "Restore code to that point?" (Sim/Não), notificações; prompts em inglês | P | ☐ |
| E16 | Árvore de conversa (rewind) | `IM:4785`; atalhos `PCA/core/keybindings.js:71-155` | Dobrar/desdobrar (override ctrl+←/→), etiquetas | N + override | ☐ |
| E17 | Compactação automática | `IM:3085-3141,3092,3184,3284,3478-3484` | Indicador, Esc cancela, resumo em componente próprio, aviso de custo | N | ☐ |
| E18 | Compactação em 400k | `H/extensions/compact-at-400k.ts:26,37` | `notify` "Contexto em Nk ≥ 400k: compactando" e erro | H | ☐ |
| E19 | Checkpoints git (avisos) | `PC/git-checkpoint.ts:199,251,260,306,499-508` | Vários `notify` warning/error | P | ☐ |
| E20 | Hooks com mensagem de sistema | `PC/hooks/index.ts:243,311,464-487,805,869` | `notify` warning | P | ☐ |

### Onda 6 · Som, notificação, foco, erros, retries, loading, cancelamento

| ID | Superfície | Fonte | Visual / interações / estados | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| F01 | Notificação de término (OSC 777/99, bell, toast Windows) | `PC/notify.ts:6-15,26-36,55-56,74-102,145` | Só quando "ausente": foco conhecido decide; sem foco usa tempo desde o último input; canais respeitam `preferredNotifChannel` | P (patch `notify-focus` forma aplicada) | ☐ |
| F02 | Som local de término | `H/extensions/sound-notify/index.ts:2-8,15,22,31,38,45` | `canberra-gtk-play` → `pw-play` → bell em `/dev/tty`; `PI_SOUND_NOTIFY=0` desliga; não toca em subagente nem `pi -p` | H | ☐ |
| F03 | Indicador de trabalho | `H/extensions/ui-visual/working.ts:7,41-42,61-88` | Frames braille com acento (80 ms); `●` fixo sem movimento; re-render a cada 1 s | H | ☐ |
| F04 | Indicador de trabalho (a11y) | `H/extensions/ui/a11y.ts:48` | `●` com `PI_REDUCED_MOTION` | H | ☐ |
| F05 | Loader nativo | `PCA/modes/interactive/components/loader`, `bordered-loader`; `TUI/components/loader.js`, `cancellable-loader.js` | Não lido em detalhe | N | ☐ |
| F06 | Canal de mensagens | `IM:1721,1878,2406-2409` | `showStatus/Warning/Error`; "Shortcut handler error" | N | ☐ |
| F07 | Retries de API | `settings.json`: `retry` (enabled, 10, 2000 ms, teto 60000 ms) | Apresentação do retry ao usuário **não localizada** | N, ? | ☐ |
| F08 | Cancelamento | `IM:3087,3107,3110,2790`; `PCA/core/keybindings.js:14` | Esc cancela compactação/bash; Ctrl+C limpa/sai | N | ☐ |
| F09 | Erros em português × inglês | trechos de D, E e F | Mistura de idiomas nas mensagens ao usuário | fato observado | ☐ |
| F10 | Alt-screen / fullscreen | `TUI/tui-alt-screen.js`, `alt-screen-search.js`; keybinding `tui.altScreen.previousPrompt` | Overrides em `keybindings.json`; fluxo não lido | N | ☐ |

### Onda 7 · Tokens de design: cores, fundos, bordas, spacing, fontes, ícones, animação, a11y

> **Aplicado (2026-11-14):** ver `docs/designs/onda7-tokens/README.md`. A tabela abaixo é o retrato de antes da onda; as decisões e o estado atual estão no README da onda.

| ID | Superfície | Fonte | Observação | Estado | Decisão |
|:-|:-|:-|:-|:-|:-|
| G01 | Tema `tokyo-night` | `H/themes/tokyo-night.json` | 26 variáveis (`vars`) e 56 chaves em `colors`; `export`: `pageBg`, `cardBg`, `infoBg`. Ex.: `bg #1a1b26`, `fg #c0caf5`, `commentA11y #6d76a3`, `borderQuiet #5f688e` (valores de contraste **não medidos**) | ativo (`settings.json`) | ☐ |
| G02 | Tema `mono` | `H/themes/mono.json` | 56 chaves, sem `vars`; usado só com `NO_COLOR` (`H/extensions/ui/a11y.ts:44`) | H | ☐ |
| G03 | Fundos de estado | `colors`: `selectedBg`, `searchMatchBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg` | 7 chaves de fundo | tema | ☐ |
| G04 | Bordas | `colors`: `border`, `borderAccent`, `borderMuted`, `mdCodeBlockBorder`, `mdQuoteBorder` | Estilo de borda vem do componente, não do tema | tema | ☐ |
| G05 | Tokens Markdown e syntax | `colors`: `md*`, `syntax*`, `toolDiff*` | Consumidos por C10/C12/C13 | tema | ☐ |
| G06 | Scrollbar | `colors`: `scrollbarTrack`, `scrollbarThumb` | Uso por `TUI/components/scroll-view.js` não lido | tema | ☐ |
| G07 | Spacing / padding | `editorPaddingX` etc. | Não achado em `settings.json`; padrão nativo não lido | ? | ☐ |
| G08 | Tipografia | — | Não há controle: a fonte é do terminal; só ícones e largura (G09) | n/a | ☐ |
| G09 | Ícones | `H/extensions/ui-visual/icons.ts` (47 linhas); glifos soltos em E/F | Nerd Font opcional; Unicode de largura simples; emoji `🔒` em A10 | H | ☐ |
| G10 | Animação | `H/extensions/ui-visual/working.ts`, `H/extensions/ui/terminal.ts:12`, patch pulse-dot | Três animações paralelas: braille (indicador), braille de 10 quadros (título), pulse dot (fleet) | H + P | ☐ |
| G11 | Movimento reduzido | `H/extensions/ui/a11y.ts:48`; `terminal.ts:50` | `PI_REDUCED_MOTION` → `●` | H | ☐ |
| G12 | NO_COLOR | `H/extensions/ui/a11y.ts:44-46`; `ui-visual/icons.ts:43` | Tema mono, header plano, ícones ASCII; efeito só na sessão | H | ☐ |
| G13 | Contraste/leitor de tela | `commentA11y`, `borderQuiet` (nomes) | Existem tokens "A11y", mas **nenhuma medição de contraste** foi feita aqui | ? | ☐ |
| G14 | Largura/truncagem | `H/extensions/ui-visual/tools.ts:34-45,116`; `truncateToWidth` em vários overlays | Estratégia de responsividade de terminal estreito **não verificada** | H | ☐ |

### Onda 8 · Comandos e atalhos

Defaults nativos em `PCA/core/keybindings.js` (linha entre parênteses). Overrides do usuário em `~/.pi/agent/keybindings.json` (8 chaves: lidas por inteiro). Colisões: **não inventadas**; só ficam registradas como "a conferir" quando uma tecla aparece em mais de uma fonte.

| ID | Tecla / comando | Default / fonte | Override ou extensão | Nota (sem conflito inventado) | Decisão |
|:-|:-|:-|:-|:-|:-|
| H01 | Ctrl+C | `app.clear` (l.14) | Editor do harness guarda texto no histórico (`H/extensions/ui/editor.ts:84`) | Duplo toque sai (`IM` hotkeys) | ☐ |
| H02 | Ctrl+D / Ctrl+Z | `app.exit` (l.15) / `app.suspend` (l.17) | — | Z sem efeito no Windows | ☐ |
| H03 | Shift+Tab | `app.thinking.cycle` (l.21) | — | — | ☐ |
| H04 | Ctrl+S | `app.thinking.save` (l.25) | Rascunho em `H/extensions/ui/editor.ts:78`; send-now usa Ctrl+X Ctrl+S (`runtime.mjs:140`) | **A conferir**: mesma tecla em 2–3 fontes; resolução não observada | ☐ |
| H05 | Ctrl+P / Shift+Ctrl+P | `app.model.cycleForward/Backward` (l.29,33) | `cycleBackward` = `ctrl+shift+,` (override) | — | ☐ |
| H06 | Ctrl+L | `app.model.select` (l.36) | — | Na árvore, `app.tree.editLabel` usa ctrl+l (l.78-82) | ☐ |
| H07 | Ctrl+O / Ctrl+T | `app.tools.expand` (l.37) / `app.thinking.toggle` (l.39) | Ctrl+O citado em `subagent-render.patch:413` | — | ☐ |
| H08 | Ctrl+N | `app.session.toggleNamedFilter` (l.43) | — | — | ☐ |
| H09 | Ctrl+G | `app.editor.external` (l.47) | — | — | ☐ |
| H10 | Ctrl+X | `app.message.copy` (l.51) | send-now usa Ctrl+X como prefixo (`runtime.mjs:148`) | **A conferir** | ☐ |
| H11 | Alt+Enter | `app.message.followUp` (l.55) | override `ctrl+q` | Regra de docs: atalhos sem Alt | ☐ |
| H12 | Alt+↑ | `app.message.dequeue` (l.59) | override `ctrl+shift+up`; up-dequeue reescreve ↑ | — | ☐ |
| H13 | Ctrl+V | `app.clipboard.pasteImage` (l.63) | override igual ao default | Redundante | ☐ |
| H14 | Ctrl+↑ | `tui.altScreen.previousPrompt` | override `ctrl+up` | Default não lido | ☐ |
| H15 | Árvore: ctrl+←/→ | `app.tree.foldOrUp/unfoldOrDown` (l.71,75 usa alt/ctrl) | override `ctrl+left`/`ctrl+right` | — | ☐ |
| H16 | Ctrl+Shift+↑/↓ | `app.models.reorderUp/Down` (override) | Mesma tecla Ctrl+Shift+↑ também em `app.message.dequeue` (override) | **A conferir**: contextos diferentes (seletor × editor) | ☐ |
| H17 | Ctrl+Shift+T | `PC/todo.ts:440` | — | — | ☐ |
| H18 | Ctrl+Shift+P | `PC/plan-mode/index.ts:382` | — | — | ☐ |
| H19 | Ctrl+Shift+B | `H/extensions/bypass-permissions/index.ts:80` | — | — | ☐ |
| H20 | Ctrl+B | `PC/subagent/fleet-ui/panel.ts:404` | — | background do fleet | ☐ |
| H21 | Ctrl+R | `H/extensions/ui/editor.ts:77` | — | Sem `registerShortcut` de propósito (l.76) | ☐ |
| H22 | Ctrl+Enter | `patches/pi-core/send-now/runtime.mjs:147` | — | Em muitos terminais é igual a Enter (não verificado aqui) | ☐ |
| H23 | Comandos nativos | slash commands de `IM` (ver D) | — | Lista nominal em `/tmp/pi-ui-inventory-native.md` §2.7 (contagem não conferida) | ☐ |
| H24 | Comandos harness (9) | `/diff`, `/btw`, `/vim`, `/rename`, `/copy-code`, `/keybindings`, `/puxar`, `/pi-docs`, `/bypass` | — | 9 nomes | ☐ |
| H25 | Comandos pi-code | `/goal /plan /plan-todos /todos /tasks /agents /team /subagents-setup /rewind /hooks /memory /context /output-style` (`PC/mcp` excluído) | — | 13 nomes | ☐ |

## 5. Critérios do FUTURO redesign (propostas, não decisões)

Proposta para orientar a revisão; só valem depois do aceite do usuário.

1. Uma única fonte de verdade por superfície (resolver donos duplos da seção 2) antes de qualquer estilo.
2. Tokens primeiro (Onda 7): nenhuma cor literal em componente; contraste medido, não presumido.
3. Os dois temas (`tokyo-night`, `mono`) e `NO_COLOR`/movimento reduzido continuam funcionando; terminais estreitos e sem Nerd Font têm fallback.
4. Atalhos sem Alt; nenhuma tecla redefinida sem tabela de colisão verificada contra os defaults reais.
5. Um idioma por classe de mensagem (decisão do usuário), consistente entre nativo, pacote e harness.
6. Mudanças em pi-code só via patches versionados ou extensões; um patch por responsabilidade, com verificação de presença no start (hoje só 3 marcadores).
7. Verificação visual real (tmux/captura em larguras definidas) exigida antes de declarar uma tela redesenhada; testes e gates seguem a regra do repositório.
8. Cada item deste arquivo recebe `M/R/X` antes de entrar em plano de implementação.

## 6. Lacunas honestas e riscos

- **Nenhuma verificação visual.** Cores, larguras, truncamento, sobreposição de widgets e comportamento real do TUI não foram observados.
- **Não lidos:** corpos de login/OAuth, `showTreeSelector`, `showSessionSelector`, `image.js`, `select-list`, `loader`, `session-title.ts`, `thinking.ts`, `plan-gate.ts`, `completion-gate.ts`, `bash-clamp`, `web.ts`, `scroll-view`, `keybindings.js` l.79-175 em detalhe, `PCA/docs/*.md`.
- **Patches ambíguos:** 12 dos pi-code deram "NEITHER" no dry-run (relato `/tmp/pi-ui-inventory-patches.md`); a forma real de fleet, plan-section e interactive-display é **desconhecida**. Falha de patch só avisa.
- **Ativação dos módulos H:** presença do arquivo ≠ carregamento comprovado; ordem de carga desconhecida.
- **MCP:** `!extensions/mcp/**` desativa o módulo do pi-code; de onde vem o MCP visível ao usuário não foi investigado.
- **Árvore suja:** `todo-collapse.patch` e vários patches/arquivos estão modificados ou untracked; o inventário reflete o disco em 2026-11-13, não um commit.
- **Relatos de segunda mão:** itens marcados "(relato)" vêm de `/tmp/pi-ui-inventory-patches.md` e `/tmp/pi-ui-inventory-native.md`; arquivos efêmeros, linhas de patch não reconferidas nesta rodada.
- **Números de linha** valem para os arquivos instalados hoje; atualização de pi (1.5.2) ou pi-code (1.7.0) os invalida.

## 7. Contagem e verificações locais

- **147 itens**, IDs únicos (0 duplicados): A 17, B 13, C 20, D 28, E 20, F 10, G 14, H 25.
- Âncoras do índice: 14 links internos. Caminhos `H/…` e `PC/…` citados existem em disco (checados com `[ -e ]`). Caminhos `patches/…` abreviados correspondem a `H/claude-home/patches/pi-code/` e `H/claude-home/patches/pi-core/` (existem).
- Não executado: pi, testes, tmux, `patch`; linhas do `PCA/` (`IM:…`) e dos patches não foram reconferidas nesta rodada (vêm de `/tmp/pi-ui-inventory-*.md`). Nenhum exemplo do documento foi executado.
