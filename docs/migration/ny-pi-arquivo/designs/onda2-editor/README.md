# Onda 2 · editor, histórico e fila

**Status: aplicado (2026-11-14), sem commit.** Proposta com antes/depois: `proposta.html` (os “depois” dela são mocks; `previa.png` é o print da proposta). Capturas reais do que foi aplicado: `real-*.png` (reproduzir: `node docs/designs/onda2-editor/check.mjs`).

## Objetivo
Composer, histórico e fila minimalistas e fáceis de entender: tudo perto de onde se digita, cada estado diz como sair dele, estado nunca é só cor, uma gramática só (`❯`, réguas finas, dicas com `·`, português).

## Decisão do dono (2026-11-14)
Primeiro pediu um exemplo sem aplicar nada (proposta). Depois: “revisar se não tem mais nada SOTA, criar um plano e aplicar”.

## Auditoria (o que a pesquisa mostrou além da proposta)
| Padrão visto em 2+ produtos | Situação aqui | Decisão |
|---|---|---|
| Dica contextual quando há rascunho e o agente trabalha (Codex “tab to queue message”, Crush) | não existia | **entrou**: `⏎ entra no próximo passo · ctrl+⏎ envia agora` |
| Fila com limite e resumo do excesso (Gemini 3 + “+N more”, Codex 3 linhas) | lista sem limite | **entrou**: 5 itens e `… mais N` |
| Esc na busca preserva o rascunho (Codex, Gemini, Amp) | já era assim | sem mudança |
| Escopo sessão / projeto / todas (Claude Code) | já existia | só o visual |
| Preview do item selecionado no histórico (Claude Code fullscreen, Warp) | não existe | **fora**: mudaria a altura do painel a cada seta; `⏎` já marca prompt de várias linhas |
| Gerência por item da fila: apagar, reordenar, enviar um (Warp, opencode) | só “editar tudo” (↑) | **fora**: a API de extensão do pi 1.5.2 só expõe `hasPendingMessages()`; exigiria patch no core |
| Placeholder no campo vazio (Gemini, Warp) | dicas já estão no header (Onda 1) | **fora**: repetiria informação |
| Autocomplete com a mesma gramática | nativo do pi | **fora**: patch no core, ganho pequeno |

## Plano e resultado
| # | Item | Antes | Depois | Onde |
|---|---|---|---|---|
| 1 | Histórico Ctrl+R (B03) | texto solto no centro, `[sessão]`, `>` sem cursor, “Nenhum prompt encontrado” | embaixo, largura inteira, entre réguas; cursor, `Buscar nos prompts`, `1 de N`, trecho casado em destaque; `● sessão`; vazio diz o motivo e `Tab amplia a busca` | `extensions/ui/history.ts`, âncora em `editor.ts` |
| 2 | Fila (B06–B08) | `Steering:` / `Follow-up:` e dica em inglês, tudo no mesmo cinza | `Na fila · N` + `↑ editar · ctrl+⏎ enviar agora`; itens numerados com `no próximo passo` / `ao terminar`; limite de 5 | `extensions/up-dequeue/index.ts` (`restyleQueue`, `attachQueueView`) |
| 3a | Rascunho (B04) | `✎ rascunho` | `rascunho guardado · ctrl+s devolve` (curto: `rascunho`) | `extensions/ui/editor.ts` |
| 3b | Ctrl+C com texto | some em silêncio | `apagado · ↑ recupera` até a próxima tecla | idem |
| 3c | Shell (B09) | só a cor da régua | `shell` / `shell · fora do contexto` na régua de baixo | idem |
| 3d | Vim (B02) | `NORMAL` / `INSERT` sobre a régua | só `NORMAL`; insert é o padrão e fica em silêncio | idem |
| 3e | Rascunho com o agente ocupado | nada | `⏎ entra no próximo passo · ctrl+⏎ envia agora` (curto: `⏎ entra na fila`) | idem |
| 4 | Prompt fixo (B05) | — | mantido | — |
| 5 | Autocomplete (B12) | — | não aplicado | — |

## Contratos de teste que mudaram (antigo → novo)
- Título `Histórico de prompts` + `[sessão]` → `── Histórico` + `● sessão`.
- `1 arquivo(s) ignorado(s)` → `1 arquivo ignorado` / `N arquivos ignorados`.
- Linha selecionada `→ texto` → ` ❯ texto`.
- Vim em insert mostrava `INSERT` → não mostra nada.

## Riscos e limites conhecidos
- **Fila**: a lista é do pi nativo. `attachQueueView` embrulha o `render` do 2º filho do TUI (contêiner de pendências no 1.5.2) e reescreve só linhas que casam `Steering:` / `Follow-up:` / `↳`. Se o pi mudar o texto ou a ordem, nada casa e a lista nativa aparece intacta.
- **Histórico**: o painel abre na base da tela e cobre o status; o composer continua visível logo acima, com o cursor dele (dois cursores na tela enquanto o painel está aberto).
- `ctrl+⏎` depende do patch `send-now` aplicado por `bin/pi`; num pi sem o patch a dica aparece e a tecla não faz nada.
- `extensions/` é o que o pi do usuário carrega (`~/.pi/agent/extensions` são symlinks para cá): a mudança vale para toda sessão nova.
- `extensions/ui/editor.ts` e o teste dele também receberam, no mesmo período, mudanças de outra sessão (compatibilidade Claude Code, `claude-compat/`); as duas convivem no arquivo.

## Evidência
- `node --experimental-strip-types --test extensions/ui/test/*.test.ts extensions/up-dequeue/index.test.ts extensions/sticky-prompt/sticky.test.ts`: 89 passam, 0 falham.
- Capturas reais (kitty em Xvfb, pi 1.5.2, provider fake, tema `tokyo-night`): `real-historico.png`, `real-historico-vazio.png`, `real-rascunho.png`, `real-apagado.png`, `real-shell.png`, `real-fila.png`.
- Não executado: `scripts/test_install.sh`, suíte dos patches do pi-code, recaptura da galeria, `NO_COLOR` e largura estreita em captura real (cobertos só por teste unitário), vim `NORMAL` em captura real.

## Pendências
- Galeria: `04`, `31`, `112`–`118` e o inventário (B03, B04, B06) mostram o visual antigo.
- Fontes da pesquisa: fim de `proposta.html`.

## Rollback
Desfazer à mão os trechos desta onda (não usar `git checkout` em `editor.ts` nem no teste dele: levaria junto o trabalho da outra sessão). `history.ts`, `test/history.test.ts` e `up-dequeue/*` só têm esta onda mais a troca de tecla já existente em `up-dequeue`.
