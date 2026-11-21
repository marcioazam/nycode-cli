# Terminal do pi SOTA: UI, comandos e features (2026-11-13)

Pedido: "Deixar toda UI, comandos e Features SOTA do Terminal do Pi, use outros CLI Harness e pegue tudo que há de
melhor, pesquise na web e deixe SOTA para desenvolvimento. Cor padrão Tokyo Night". Decisões do usuário nesta tarefa
(question, 2026-11-13): "Manter exclusões" (sem paleta de comandos, sem HUD compacto, som de fim de turno sem
mudança, como em `pi-ui-sota.md`); Codex: "Separar de vez" (feito, ver `pi-agent-fleet-2026-11-12.md`, "Separação
total do Codex").

Base: a rodada de UI de 2026-11-12 (`pi-ui-sota.md`) já entregou `?` atalhos, `/vim`, `/diff`, `/btw`, rewind
unificado, título com spinner, foco OSC 1004, NO_COLOR e movimento reduzido; a frota de subagentes está em
`pi-agent-fleet-2026-11-12.md`. Esta rodada cobre o que ainda falta frente aos outros harnesses.

## Pesquisa (acesso 2026-11-12/13)

Três `perplexity-scout` (Perplexity + Keenable, páginas lidas com `web_fetch`) e um Explore local.

| Fonte | O que trouxe |
|:-|:-|
| https://code.claude.com/docs/en/interactive-mode.md | Ctrl+R busca no histórico; Ctrl+S guarda o rascunho; ↑ depois de Ctrl+C devolve o rascunho apagado (v2.1.288+); `/copy [N]` com seletor de blocos de código (commands.md) |
| https://code.claude.com/docs/en/commands.md | `/keybindings`, `/code-review`, `/context`, `/usage`, `/rewind`, `/btw`, `/diff` |
| https://learn.chatgpt.com/docs/developer-commands.md?surface=cli | Codex: Ctrl+R histórico, `/keymap`, `/diff`, Enter direciona e Tab enfileira, Esc Esc edita e bifurca |
| https://learn.chatgpt.com/docs/config-file/config-reference.md | Codex `tui.keymap`, `tui.notifications`, `tui.terminal_title` |
| https://antigravity.google/docs/features/ | `/diff` com comentários por linha que direcionam o agente; `/keybindings`; `/statusline` |
| https://cursor.com/docs/cli/using | Ctrl+R revisa mudanças e `i` acrescenta instruções |
| https://ampcode.com/docs/cli/keybindings | Ctrl+R histórico; Enter direciona; edição da fila |
| https://opencode.ai/docs/keybinds/ | `prompt_stash`, leader key, which-key |
| https://geminicli.com/docs/cli/themes.md | Gemini CLI traz "Tokyo Night" embutido |
| https://raw.githubusercontent.com/folke/tokyonight.nvim/main/lua/tokyonight/colors/storm.lua, `night.lua`, `groups/treesitter.lua` (sha256 `a96775b3…`, `a8d87bf7…`, `c0a7fc81…`) | paleta oficial Night e mapeamento de sintaxe |
| local: kitty 0.45.0 `/usr/lib/kitty/kitty/progress.py`, `window.py:1144-1156` | kitty aceita OSC 9;4 |

Inventário do pi (Explore, `/tmp/sota-cli/pi-inventory.md`): já existem `@` arquivos, `!`/`!!` shell, colar
imagem, editor externo (Ctrl+G), fila (Ctrl+Q) e direcionamento (Enter), Tab, desfazer, busca no transcript em
fullscreen, `/tree`, `/fork`, `/clone`, `/rewind`, `/context`, `/btw`, `/diff`, `/vim`, `/plan`, `/goal`, revisão
(`/review-pr`, `/code-review`, `/diff-review`). pi 1.5.2 é a última versão publicada (npm `latest`).

## Lacunas e decisão

| Lacuna (quem tem) | Decisão |
|:-|:-|
| Busca no histórico de prompts com Ctrl+R (Claude, Codex, Amp) | U1 |
| Guardar o rascunho com Ctrl+S (Claude, OpenCode) e devolver o rascunho apagado por Ctrl+C (Claude) | U1 |
| Comentários por linha no `/diff` que viram instrução ao agente (Antigravity, Cursor) | U2 |
| Tokyo Night em tudo: sintaxe e markdown no mapeamento oficial; `sticky-prompt` com cor fixa 256; HUD com laranja fixo `38;5;208` | U3 |
| Copiar um bloco de código da última resposta (Claude `/copy` com seletor) | U4 `/copy-code [N]` |
| Editar atalhos por comando (Claude `/keybindings`, Codex `/keymap`, Antigravity) | U4 `/keybindings` |
| Paleta de comandos (Amp, OpenCode), HUD compacto, som | fora: decisão do usuário |
| Shell em segundo plano com `/shells` (Claude Ctrl+B, Gemini, Codex `/ps`) | fora: exigiria ferramenta nova fora do matcher `Bash` do `guard.py` e custo fixo de schema por turno; `nohup … &` já funciona pelo `bash` guardado |
| Progresso OSC 9;4 na aba do kitty | fora: o template de aba do usuário (`kitty.conf:75`) não mostra progresso e o título já tem o spinner |
| Voz, handoff para nuvem, `/teleport`, worktree por flag | fora: sem infraestrutura local ou o wrapper é de outra sessão |

## Aceite observável

U1 (`extensions/ui/editor.ts`, novo `extensions/ui/history.ts`):
- Ctrl+R no editor abre "Histórico de prompts"; digitar filtra (todas as palavras, sem caixa); ↑↓ escolhe; Enter
  põe o prompt no editor sem enviar; Esc fecha sem mudar o editor; Tab troca o escopo sessão → projeto → todas.
  Mais recentes primeiro, sem repetidos, quebras de linha mostradas como `⏎`.
- Leitura limitada: ≤300 arquivos de sessão mais novos, arquivo >128 MB pulado, ≤5000 prompts, cache por caminho,
  mtime e tamanho; arquivo ilegível é contado e pulado, nunca derruba o pi.
- Ctrl+S: editor com texto → guarda e limpa; vazio com guardado → devolve; os dois → troca. A borda mostra que há
  rascunho guardado.
- Ctrl+C com texto: o texto entra no histórico do editor antes de limpar (↑ devolve); com o editor vazio o Ctrl+C
  segue o fluxo nativo.
- Sem `registerShortcut` (Ctrl+R e Ctrl+S são atalhos de seletores do pi e gerariam "[Extension issues]" no início).

U2 (`extensions/ui/diff.ts`): no diff de um arquivo há linha-cursor; `c` comenta a linha (Enter salva, Esc cancela,
vazio apaga); linhas comentadas ganham marca; número da linha nova para `+`/contexto e da antiga para `-`; ao fechar
com comentários, o editor recebe a lista "`arquivo:linha` — comentário" (acrescentada ao texto existente) e um aviso
diz que Enter envia (durante um turno, Enter direciona o agente).

U3: `themes/tokyo-night.json` com palavra-chave `purple`, operador `blue5`, link `teal`, marcador de lista `blue5`,
código inline `green` (treesitter.lua:36,56,60,65,76) e válido no `loadThemeFromPath` do pi; `sticky-prompt` com cores
do tema (`selectedBg`/`text`), sem cor com NO_COLOR; HUD `config.json` com `colors` em hex da paleta Night.

U4 (novo `extensions/dev-commands/`): `/copy-code [N]` copia o bloco N (ou o único, ou escolhe numa lista) da última
resposta com `copyToClipboard`; `/keybindings` abre `keybindings.json` no editor do pi, valida JSON (objeto; valores
string ou lista de strings; id desconhecido vira aviso), grava com `.bak` e recarrega.

Todos: ≤800 linhas por arquivo, ≤7 arquivos de código por diretório, TypeScript sem enum/namespace, `import type`,
imports relativos com `.ts`, comentários dos testes em português, ≥80% de linhas por arquivo novo ou tocado.

## Grafo de unidades

| Unidade | Arquivos (donos exclusivos) | Depois de |
|:-|:-|:-|
| U1 | `extensions/ui/editor.ts`, `extensions/ui/history.ts`, `extensions/ui/test/editor.test.ts`, `extensions/ui/test/history.test.ts` | - |
| U2 | `extensions/ui/diff.ts`, `extensions/ui/test/diff.test.ts` | - |
| U3 | `themes/tokyo-night.json`, `extensions/sticky-prompt/*`, `claude-home/plugins/claude-hud/config.json` | - |
| U4 | `extensions/dev-commands/**` | - |

Sem arestas: nenhuma unidade importa arquivo de outra. Uma onda, 4 escritores em paralelo; verificação única no fim.

## Custo e qualidade

Zero bytes sempre carregados (nada em CLAUDE.md, rules, skills, agentes ou schema de ferramenta). Por execução: só
listeners de teclado e comandos; Ctrl+R lê sessões só quando aberto (com cache). Compra os atalhos de edição que os
três maiores harnesses têm, revisão de diff que fala com o agente e o tema oficial em toda a TUI.

## Rollback

Apagar `extensions/ui/history.ts` e `extensions/dev-commands/`; restaurar `editor.ts`, `diff.ts`, `sticky-prompt/`,
`tokyo-night.json` e o `config.json` do HUD das cópias em `~/.cache/pi-terminal-sota/backup/` (estado anterior a esta rodada).

## Checkpoint

- [x] Pesquisa e inventário
- [x] Separação do Codex (registro no doc da frota)
- [x] U1 · U2 · U3 · U4 (4 `swarm-worker` em paralelo, arquivos disjuntos)
- [x] Gate único: `bin/tests/terminal-sota/gate.sh` (12 checks)
- [x] E2E no tmux: `bin/tests/terminal-sota/e2e.sh` (9 checks, pi interativo real, 1 chamada de modelo)

## Evidência (2026-11-13)

- 1ª rodada (gate-runner): gate 1, E2E 0 (9/9). Falhas: 5 testes de UI, cobertura duplicada, cor do tema.
- Defeito real achado pelos testes (red observado): `lineRefs` não avançava o número antigo nas linhas de contexto
  (esperado `-velha`=11, obtido 10). Corrigido em `diff.ts` (contexto avança os dois lados); green na rodada seguinte.
- Testes corrigidos por estarem errados (não para passar):
  - `diff.test.ts` "erro ao carregar": `render(40)` truncava porque as marcas do tema falso (`[selectedBg]<toolDiffContext>`)
    ocupam 31 colunas e ANSI real tem largura zero; agora `render(80)`.
  - `diff.test.ts` "comentar não faz nada": `/comentar/` casava a dica fixa "c comentar"; agora `/comentar a:/` (o prompt).
  - `history.test.ts`: filtro sem caixa "TR" casa "quaTRo" de fato; esperado passa a `['tres','quatro']`.
  - `copy-code.test.ts`: o texto "(1 linhas)" era erro de concordância (visto no E2E); contrato novo "(1 linha)".
  - gate: `loadThemeFromPath(p, 'dark')` pedia 256 cores (2º parâmetro é o modo de cor) → `'truecolor'`; esperado de
    `syntaxKeyword` era o RGB de `magenta` (#bb9af7) e o oficial é `purple` #9d7cd8 (treesitter.lua:36, storm.lua:27);
    cobertura agora pega o maior valor por arquivo, porque cada teste copia o módulo para o próprio tmp (limite inferior
    da união real).
- Estrutura: os scripts ficaram em `bin/tests/terminal-sota/`. `bin/` e `bin/tests/` estavam com 8 arquivos de código
  cada (limite 7) por `cache-misses.sh` e `tests/cache-warm-identity.test.ts`, da tarefa `pi-memory-cache-sota`
  (outra sessão, não tocada). Conserto por domínio, no padrão de `bin/structure/`: o importador `/puxar` foi para
  `bin/puxar/{puxar.py,test_puxar.py}`; consumidores atualizados (`extensions/puxar.ts:18`, `docs/pi-commands.md`,
  memória `pi-commands-port`). Prova: `test_puxar.py` 15 OK antes e depois; `structure.py` `findings: []` em `bin/` e
  `extensions/`; RPC `/puxar /tmp/perfil-inexistente-e2e` devolve `perfil … não existe` (`puxar.py:411`, caminho novo).
- Rodada final sobre a árvore exata: `gate.sh` GATE_EXIT=0 (12/12: UI 62/62, dev-commands 15/15, sticky 7/7,
  cobertura por arquivo 98,7–100%, tema e HUD válidos, estrutura sem achados, check-agents 53 OK,
  pi_harness_check error=0, check-instructions 0 problemas, RPC com `/copy-code`, `/keybindings`, `/diff` e
  `skill:cua-driver` vindo de `~/.cua-driver/skills/cua-driver/SKILL.md`, `~/.agents/skills` vazio) e `e2e.sh` (optional)
  E2E_EXIT=0 (9/9). Sem tmux nem tmp residuais; área de transferência restaurada pelo trap.
- Não executado: o `harness-check` do Codex (fora de escopo por decisão do usuário; a passagem dos itens
  `cua-driver:*` lá é inferida do código, `catalog.py:52` e `structure.py:143`, não observada).

> Atalhos: trocados em 2026-11-13 para não usar Alt — ver `hotkeys-no-alt-2026-11-13.md`.
