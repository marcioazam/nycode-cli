# Onda 8 · comandos e atalhos — “Uma porta para tudo”

**Status: em execução (2026-11-14), sem commit.** Mock avaliado: `docs/ui-ux-gallery/proposta-onda8.html`.

## Objetivo
Comandos e atalhos (H01–H25 de `docs/ui-ux-inventory.md`) fáceis de achar e entender, em pt-BR, com visão de gestão das teclas: o que faz, de onde vem, onde colide.

## Decisões do dono
- 2026-11-14 “executar” a proposta da Onda 8.
- 2026-11-14 **paridade Claude Code vence a regra “sem Alt”**: Alt+P (modelo), Alt+T (raciocínio), Alt+Enter (nova linha), Ctrl+L (redesenha), Ctrl+T (tarefas), Ctrl+P/N (↑/↓) e Ctrl+S (rascunho) ficam como em `docs/claude-code-keybindings.md`. **Superado:** o mapa de teclas “sem Alt” do mock (Alt+P→Ctrl+L, Alt+T→Ctrl+T, sem Alt+Enter) e a regra de `claude-home/docs/hotkeys-no-alt-2026-11-13.md` (optional) para essas teclas. As “colisões” Ctrl+L, Ctrl+N, Ctrl+C e Ctrl+X do mock são intencionais (Claude/send-now) e passam a ser mostradas como “intencional”, não como conflito.

## Viabilidade (lida no código, pi 1.5.2)
- Comando nativo roda antes de extensão e nome repetido não substitui (Onda 4): `/hotkeys` nativo continua existindo.
- `ctx.ui.addAutocompleteProvider(current => …)` embrulha o provider de `/`: dá para trocar rótulo/descrição, ordenar, esconder duplicatas; não há separadores de grupo no `SelectList` (o grupo vai no texto).
- `KeybindingsManager` (injetado em `ctx.ui.custom`) expõe `getResolvedBindings`, `getDefinition`, `getConflicts`; lista vazia em `keybindings.json` desfaz uma tecla (`docs/keybindings.md`).
- Atalhos de extensão não têm API pública de listagem: o catálogo do harness os declara.

## Plano (extensão nova `extensions/comandos/`, desligada com `PI_COMANDOS=0`)
| Unidade | O que faz | Aceite |
|---|---|---|
| U1 catálogo | comandos (grupo, descrição pt-BR, aliases) e ações de tecla (rótulo pt-BR, contexto, origem padrão/seu/extensão/harness, intencional) | todo comando de `slash-commands.js`, pi-code e harness tem grupo e descrição; teste falha se um comando carregado ficar sem entrada |
| U2 paleta `/` | provider que, com `/` sozinho, mostra recentes (3) e depois grupos na ordem do mock; descrição “Grupo · texto · tecla”; duplicatas de intenção viram um item com “também /x” | `/` mostra recentes no topo; `/name` some quando `/rename` existe e continua funcionando digitado; filtro nativo segue |
| U3 painel `?` | `?` com editor vazio abre folha pt-BR (Essenciais, Ver, Sessão) com as teclas EFETIVAS; qualquer tecla fecha; imprimível volta ao editor | teclas vêm do `KeybindingsManager`; sem a extensão, `?` cai no `/hotkeys` |
| U4 `/atalhos` | folha com ação · tecla · origem · marca (⚠ conflito real, ⌥ usa Alt, “intencional”); filtro ao digitar; Enter = detalhe; `r` = nova tecla com checagem de colisão no mesmo contexto, grava `keybindings.json` com `.bak` e recarrega; última linha “Editar JSON (avançado)” = `/keybindings` | conflito só quando duas ações do mesmo contexto têm a mesma tecla efetiva e não estão na lista de intencionais |
| U5 Ctrl+S | `app.thinking.save: []` (a tecla já era capturada pelo rascunho) em `claude-compat/shortcuts.ts` e no `keybindings.json` do usuário | `/atalhos` não mostra mais conflito em Ctrl+S |
| U6 textos | `/help` e `/claude-help` apontam `?` e `/atalhos`; linha `? (vazio)` da matriz | testes de texto |

## Verificação (uma vez, no fim)
Testes `node --experimental-strip-types --test` das extensões tocadas; vermelho→verde do catálogo e do conflito; capturas reais (`check.mjs`, kitty + pi + provider falso) de `/`, `?`, `/atalhos`; `structure.py`; leak/ref checks do repo.

## Checkpoint
- [x] U1–U6 implementadas (2026-11-14): `extensions/comandos/` (catalog, paleta, painel, atalhos, teclas, index), ponte `?` em `ui/editor.ts`, `app.thinking.save: []` em `claude-compat/shortcuts.ts` e no `keybindings.json`, textos de ajuda e docs.
- [x] capturas reais (2026-11-14, `node docs/designs/onda8-comandos/check.mjs`; HOME e agent temporários, `keybindings.json` real intacto): `real-paleta`, `real-paleta-filtro`, `real-painel`, `real-painel-fecha`, `real-atalhos`, `real-atalhos-detalhe`, `real-atalhos-captura`, `real-recentes` (.png nesta pasta)
- [x] revisão (2026-11-14): code-reviewer (1 achado baixo corrigido + 2 notas aplicadas); gate (360 testes, 359 ok, 1 skip intencional preexistente em ui-visual/theme-contrast mono; typecheck: 3 erros preexistentes em ui-visual, 0 nos arquivos da Onda 8; structure 0 violações; check-refs e check-leaks com achados preexistentes fora da Onda 8)

### Resultado
- Vermelho observado: sem os módulos, todos os testes de `comandos` falharam com `ERR_MODULE_NOT_FOUND`; com os módulos e sem a U5, `Ctrl+S: conflito real antes da U5…` falhou (`app.thinking.save` ainda `['ctrl+s']`) e passou após a U5 (conflito `app.thinking.save × rascunho` some).
- Verde: 182 testes (`comandos` + `ui` + `claude-compat` + `dev-commands` + `folha`), 0 falhas; `structure.py` sem achados; `pi-typecheck` sem erro nos arquivos tocados (erros preexistentes só em `ui-visual`).
- Desvios/lacunas: (1) arquivo extra `teclas.ts` (limite de 7 arquivos respeitado); (2) o evento `input` não dispara para comandos nativos/de extensão, então os recentes vêm de `ctx.ui.onTerminalInput` (Enter com `/cmd` no editor; ordem de disparo antes do editor não verificada em TUI real); (3) a paleta lê `keybindings.json` por cima dos padrões do pi para mostrar a tecla (não recebe o `KeybindingsManager`); (4) Ctrl+B (fleet) × `tui.editor.cursorLeft` aparece como conflito real; (5) `docs/claude-code-compat.md` teve a linha `? (vazio)` regenerada (teste da matriz).

### Resultado das capturas reais (2026-11-14)
- `real-paleta`: `/` lista “Conversa · …” com aliases (“também /clear /reset”) e tecla (Ctrl+X em copy); 1/36. `real-paleta-filtro`: `/ren` → só `rename` (“Sessão · Renomeia… · também /name”); o filtro nativo casa o nome, não a descrição (`/renom` não acha nada).
- `real-painel`: `?` com editor vazio abre o painel pt-BR (Essenciais/Ver/Sessão) com as teclas efetivas. `real-painel-fecha`: a letra digitada fecha o painel e aparece no editor.
- `real-atalhos`, `real-atalhos-detalhe`, `real-atalhos-captura`: lista por contexto; detalhe (tecla, origem, padrão); `r` + Ctrl+O mostra “Ctrl+O já é “Expandir saída das ferramentas” neste contexto. s substitui · esc cancela”; Esc sem gravar. `real-recentes`: após `/rename teste`, `/` mostra `rename` e `atalhos` como “Recente” no topo.
- Defeito achado e corrigido (vermelho→verde em `ui/test/editor.test.ts`): a letra devolvida pelo painel entrava no editor mas sem redesenho (só aparecia na tecla seguinte); `ui/editor.ts` agora chama `requestRender()`.
- Ctrl+B do fleet: `fleet-ui/panel.ts` só o consome com o editor focado e subagente em primeiro plano; no catálogo passou ao contexto novo “Painel de subagentes” e não acusa mais conflito com `tui.editor.cursorLeft` (teste em `comandos/test/atalhos.test.ts`, vermelho→verde; o teste da lista usa agora um conflito de usuário real em vez do Ctrl+B).
- Testes (comandos+ui+claude-compat+dev-commands+folha, uma execução): 192, 191 verdes, 1 falha fora desta unidade: `claude-compat/test/shortcuts.test.ts` “Shift+Tab e Ctrl+C permanecem nativos” (`app.thinking.cycle` entrou em `CLAUDE_KEYBINDINGS` por outra edição concorrente em `shortcuts.ts`). Os testes de `ui` ganharam a cópia de `claude-compat/fleet.ts` (novo import de `editor.ts`).
- `.githooks/pre-commit`: `docs/*` está na lista de meta permitidos (passa o path; depois roda `check-leaks.sh --staged` no conteúdo); `check.mjs` e PNGs de `docs/designs/**` não precisam estar em `publish.list`.

### Resultado da rodada de correção (2026-11-14)
- Defeitos (capturas reais): (1) painel listava “Raciocínio Ctrl+T” e “Tarefas Ctrl+T”, “Trocar modelo Ctrl+L” e “Redesenhar Ctrl+L”; (2) `/atalhos` abria em “Cursor para cima”.
- Correção 1: `ExtAction.unless` (catálogo) + `extAtivas(kb)` (`teclas.ts`): `ext.redraw` (Ctrl+L), `ext.tasks` (Ctrl+T) e `ext.up` (Ctrl+P) só existem quando o pi não tem a tecla em `app.model.select` / `app.thinking.toggle` / `app.model.cycleForward` (mesma regra de `ui/editor.ts`); somem do painel, da lista e dos conflitos. `painelGrupos` ainda descarta tecla repetida. Com `CLAUDE_KEYBINDINGS`: Alt+P, Alt+T, Ctrl+L redesenhar, Ctrl+T tarefas; sem eles: Ctrl+L modelo, Ctrl+T raciocínio, sem redesenhar/tarefas.
- Correção 2: `/atalhos` ordena em seções “Atenção: conflitos e Alt” → “Ações do app” → “Harness e extensões” → “Edição e movimento do editor” → seletores/sessões/modelos/árvore/tela cheia/subagentes; régua “N ações · X conflitos · Y com Alt”; Alt de paridade Claude (`PARIDADE_ALT`) marcado “⌥ usa Alt · intencional”, fora da seção de atenção; rodapé “↑↓ escolher · ⏎ detalhe · esc fechar · digite para filtrar”.
- Vermelho: 4 testes novos falharam antes (ext.redraw/ext.tasks/ext.up presentes sem a regra; ordem; resumo); verde depois. Total: 196 testes (comandos+ui+claude-compat+dev-commands+folha), 0 falhas.
- `check.mjs` agora copia `~/.pi/agent/keybindings.json` (optional) (só leitura) para o agent dir temporário. Capturas reabertas: `real-painel` (sem tecla repetida; Alt+T, Alt+P, Ctrl+L Redesenhar, Ctrl+T Tarefas), `real-atalhos` (resumo “103 ações · 0 conflitos · 4 com Alt”, abre em Ações do app: Trocar modelo, raciocínio…), `real-atalhos-detalhe` (Alt+P, origem seu, padrão Ctrl+L), `real-atalhos-captura` (colisão com Ctrl+O), `real-paleta`, `real-paleta-filtro` (/ren → rename), `real-recentes` (rename, atalhos no topo), `real-painel-fecha` (x no editor).
- Rodada final (2026-11-14): `/keybindings` virou entrada própria em Configuração (não é mais alias de /atalhos; `/help` já era entrada própria), Ctrl+C cancela a captura como Esc, `session_shutdown` limpa a ponte e o `.catch` do painel não relança com ctx obsoleto; vermelho 3 testes (+1 teste de alias atualizado) → verde 122/122 (comandos+ui), `check.mjs` ok (paleta 1/37, captura sem regressão).
