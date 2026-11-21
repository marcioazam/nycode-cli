# Onda 6 · notificação, erros e loading

**Status: aplicado e ligado no pi local (2026-11-14), sem commit.** O dono respondeu “Pode executar” à recomendação: 1b, 2, 3, 4, 5a, 5b, 5c e o painel (6) entraram; o item 7 (demais textos nativos em português) fica para depois. Antes/depois: `proposta.html`; evidência real: `real-*.png` (gerados por `check.mjs`).

## Objetivo
O que o pi diz enquanto trabalha, quando falha, quando é interrompido e quando termina com o usuário longe (F01–F10) fica minimalista e fácil de achar e entender: um lugar por tipo de sinal, todo erro com próxima ação, urgência honesta, estado nunca só por cor, um idioma.

## Aceite (da proposta)
- Cada ID F01–F10 tem defeito atual, proposta e seção na tabela “Visão geral”.
- Cada mudança diz onde mexe (extensão, patch no pi-code, patch no core), o risco e a recomendação.
- Cada afirmação sobre outro produto ou norma aponta a fonte e se a página foi lida ou só apareceu em busca.

## Auditoria do estado atual
| # | Defeito | Evidência |
|---|---|---|
| 1 | Erro do provedor mostra `Error: 400:` + JSON cru em inglês e uma frase genérica sobre `/bug`; não diz o que fazer | `images/12-erro-provider.png` |
| 2 | Durante o retry o erro já aparece em vermelho, antes de se saber se a nova tentativa resolve; a linha do retry é em inglês | `images/13-retry-429.png` |
| 3 | Esc durante o retry gera `Error: Retry failed after 1 attempts: Retry cancelled` em vermelho | `images/14-retry-cancelado.png` |
| 4 | Esc no meio da resposta gera `Operation aborted` em vermelho, igual a uma falha | `images/32-cancelado.png` |
| 5 | Prefixos `Warning:` / `Error:` em inglês antes de corpo em português; a cor é a única outra pista | `images/87-notificacoes.png` |
| 6 | Notificação é sempre `Pi` / `Ready for input`: não diz qual sessão nem se terminou ou falhou | `reports/sinais.txt`; pi-code `extensions/notify.ts:160` |
| 7 | Som único em todo fim de turno; só desliga por `PI_SOUND_NOTIFY=0` | `extensions/sound-notify/index.ts`; `reports/f02-som.txt` |
| 8 | Não há lugar para rever avisos nem para ajustar notificação e som | — |
| 9 | Loaders nativos (compactação, resumo de branch) usam texto e gramática diferentes do indicador do harness | pi `status-indicator.js`, `interactive-mode.js` (mapa do código, abaixo) |

Sem defeito: indicador de trabalho (F03, F04), já redesenhado na Onda 1; regra “só notifica quando ausente” (patch `notify-focus`).

## Mapa do código (lido em 2026-11-14)
- Indicador: `extensions/ui-visual/working.ts` (extensão; `setWorkingIndicator`, `setWorkingMessage`).
- Notificação: pi-code 1.7.0 `extensions/notify.ts` (`:55` regra de ausência, `:75` OSC 777, `:79-81` OSC 99, `:155-161` disparo em `agent_settled`).
- Som: `extensions/sound-notify/index.ts` (extensão).
- Retry: `core/agent-session.js:3193-3210`; texto em `interactive-mode.js:3151-3170`. Os eventos `auto_retry_*` não existem nos tipos de extensão: só patch.
- Canal de mensagens: `interactive-mode.js:3224` (`showStatus`), `:3930` (`showError`), `:3935` (`showWarning`). Extensões só têm `ctx.ui.notify`, que vai para a conversa.
- Interrupção: `interactive-mode.js:2989`, `:3107`, `:3110`; `assistant-message.js:167-172`.

## Decisões pendentes do dono
Tabela “O que decidir” em `proposta.html`. Resumo da recomendação: aplicar 1b, 2, 3, 4, 5a, 5c; investigar 5b antes; 6 depois de 3 e 5; 7 depois.

## Plano de execução e contratos
Duas faixas com arquivos disjuntos; um gate no fim; nada é ligado no pi do usuário (`publish.list` + `install.sh --link --apply`) antes do gate.

| Faixa | Itens | Arquivos |
|---|---|---|
| A · patch no core | 2, 3, 4 | `claude-home/patches/pi-core/avisos/{apply.mjs,runtime.mjs}`, `claude-home/bin/tests/avisos-core/*`, `bin/pi` (só o bloco novo) |
| B · extensão | 1b, 5a, 5b, 5c, 6 | `extensions/avisos/**`, `extensions/sound-notify/index.ts`, `claude-home/bin/tests/sound-notify.test.ts`, `claude-home/patches/pi-code/zzzzzzzzzzz-notify-owner.patch` (+ teste ao lado) |
| integração (sessão principal) | — | `publish.list`, teste de paridade da tabela de causas, links, capturas reais, este README |

### Tabela de causas (contrato único; A e B copiam estes textos)
Entrada: o texto do erro como o pi o mostra (`Error: <status>: <json>` ou texto livre). Ordem de teste: status HTTP no início; depois palavras-chave.

| id | Casa com | `rotulo` (régua, notificação, painel) | `titulo` (1ª linha do erro) | `acao` (3ª linha) |
|---|---|---|---|---|
| `limite` | 429, `rate_limit`, `rate limit` | limite de uso do provedor | O provedor está limitando o uso | ↑ traz o pedido de volta · /model troca de modelo |
| `conta` | 401, 403, `authentication`, `unauthorized`, `permission_error` | conta não reconhecida pelo provedor | O provedor não reconheceu a sua conta | /login entra de novo |
| `pedido` | 400, 404, 413, 422, `invalid_request` | pedido recusado pelo provedor | O provedor recusou o pedido | ↑ traz o pedido de volta · /bug relata ao pi |
| `fora` | 5xx, `overloaded` | provedor fora do ar | O provedor está fora do ar | ↑ traz o pedido de volta |
| `rede` | `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `fetch failed`, `network`, `socket` | sem conexão com o provedor | Sem conexão com o provedor | ↑ traz o pedido de volta |
| `outro` | o resto | falha no pi | Algo falhou no pi | /bug relata ao pi |

`codigo` = `<status> <type>` quando existirem (ex.: `429 rate_limit`); `mensagem` = campo `message` do JSON quando houver, senão o texto original sem o prefixo `Error:`.

### Configuração (`avisos.json` no diretório do agente do pi, ao lado de `settings.json`)
```json
{ "avisar": ["terminou", "precisa", "erro"], "som": ["precisa", "erro"], "canal": "sistema", "progresso": true }
```
`canal`: `sistema` | `sino` | `ambos` | `desligado`. Arquivo ausente ou inválido = estes padrões. `PI_SOUND_NOTIFY=0` continua calando todo som. `PI_TERM_PROGRESS=1|0` força o progresso na aba; sem ela, só liga em Ghostty (`TERM_PROGRAM=ghostty`) e Windows Terminal (`WT_SESSION`).

### Contratos que mudam (antigo → novo)
- Som: tocava em todo fim de turno → só nos eventos listados em `som` (padrão: `precisa`, `erro`).
- Notificação: `Pi` / `Ready for input`, emitida pelo `notify.ts` do pi-code conforme `preferredNotifChannel` → emitida por `extensions/avisos` (título `sessão · pasta`, corpo por evento, canal em `avisos.json`); o `notify.ts` se cala quando a extensão anuncia que é a dona (evento `pi-harness:notify-owner`). Sem a extensão, o comportamento antigo volta sozinho.
- Textos nativos de retry, erro e interrupção → os da `proposta.html` (seções 2, 3, 4).

## Pesquisa
Rodadas: `perplexity-scout` (Perplexity + Keenable, Exa, Parallel), `web-scout` (leitura direta de código e docs), `Explore` (código local). As duas rodadas web terminaram **incompletas** (orçamento de leituras). Fontes e o que foi lido de fato: fim de `proposta.html`.

Lacunas, não verificadas em fonte primária:
- Apple HIG: páginas Feedback, Alerts e Writing (o leitor devolveu página vazia). Lidas: Progress indicators e Managing notifications.
- Suporte a OSC 9;4 fora de Ghostty e Windows Terminal (kitty, WezTerm, iTerm2, VTE).
- Texto de erro e de interrupção de Codex, Gemini CLI, Amp e Crush; os fatos de opencode, Warp, Crush e a config de notificação do Codex vieram só de trecho de busca.
- No código local: se o pi-code expõe o momento de “pergunta aberta / pedido de permissão” para a notificação (item 5b); comportamento de Ctrl+C; valores de retry.

## O que entrou
- **Patch no core do pi 1.5.2** (`claude-home/patches/pi-core/avisos/{apply,runtime}.mjs`, bloco em `bin/pi`): retry `▲ <rótulo> · nova tentativa em Ns · N de M · esc cancela`; erro em 3 linhas; `■ interrompido por você…`; `■ novas tentativas canceladas por você · N de M`; prefixos `▲`/`✕`. Rollback: `node claude-home/patches/pi-core/avisos/apply.mjs <dist> --revert` (byte a byte, sidecar em `dist/.pi-harness-backups/avisos/`). Falha de escrita desfaz tudo e sai com 2.
- **Supersede (2026-11-14, pedido do dono):** a linha `■ interrompido por você` deixou de ser cinza: marcador e frase em `error`, nota em `dim`, faixa `toolErrorBg` (o fundo de erro das ferramentas; pares medidos ≥ 4.5 em `theme-contrast.test.ts`). Prova: `docs/designs/onda7-tokens/real-{escuro,claro}-interrompido.png` (`check-int.mjs`).
- **Extensão `extensions/avisos`**: dona do fim de turno (notificação `sessão · pasta`, som só em `precisa`/`erro`, OSC 9;4, painel `/avisos` com recentes e ajustes, `avisos.json` no diretório do agente). `sound-notify` passa a tocar só quando a avisos pede; sem ela, comportamento antigo.
- **`zzzzzzzzzzz-notify-owner.patch`**: o `notify.ts` do pi-code se cala quando a avisos se anuncia. Os dois hunks ficam fora do contexto do `notify-focus.patch` (a primeira versão quebrava o teste de reversão dele).
- 5b: `precisa` dispara no evento `pi-code:question:v1`. Pedido de permissão ficou de fora: não há evento de extensão.
- Tentativas canceladas com Esc não contam como erro: o `agent_settled` chega com `aborted=false`; o runtime do core deixa a marca `Symbol.for('pi-harness:retry-cancelado')`, que a extensão consome.

## Diferenças em relação à proposta
- Painel: compactação automática aparece como `▲ Contexto compactado sozinho · de 182k tokens`. O evento `session_compact` não traz o tamanho de depois; o `→ 41k` do mock não foi inventado.
- Painel: erro aparece como `Parou com erro · <rótulo>`, sem “depois de N tentativas” (a extensão não recebe a contagem).
- Toast nativo do Windows não replicado; em `win32` sai OSC 777.

## Verificação
- `proposta.html` aberta em Chrome headless a 1366 px (escuro) e 390 px (claro).
- Testes (2026-11-14, árvore sem commit, dist real já com os avisos): `node --experimental-strip-types --test claude-home/bin/tests/avisos-core/*.test.ts claude-home/patches/pi-code/*.test.ts` 174/174; avisos-core + send-now + `extensions/avisos/test` + `sound-notify.test.ts` 172/172; `extensions/ui` + `ui-visual` passam. Cobertura de linhas: `apply.mjs`/`runtime.mjs` 100%, `sound-notify/index.ts` 100%, `extensions/avisos/*` ≥ 87% (medida antes dos dois últimos ajustes, não refeita). `structure.py`: sem achados. `bash -n bin/pi` ok.
- Revisão independente (`code-reviewer`): sem defeito alto; 3 achados médios/baixos corrigidos (escrita parcial do apply, `aborted` do `agent_settled`, duas linhas cinza no Esc) e paridade de `causa()` ampliada.
- Captura real (`node docs/designs/onda6-avisos/check.mjs`, kitty em Xvfb, provider fake): `real-erro`, `real-retry`, `real-retry-cancelado`, `real-retry-esgotado`, `real-interrompido`, `real-canal`, `real-painel-recentes`, `real-painel-ajustes`.
- Vermelho do gate fora desta onda (não corrigido): `async-default-routing.test.ts` (módulo não resolvido na cópia em /tmp), `check-refs.py` (24 referências de outras frentes), `check-leaks.sh` (cache local `.impeccable/` e fixtures de outras frentes).
- Não executado: notificação e som reais (testes usam saída injetada); OSC 99 em kitty com foco real, OSC 9;4 em Ghostty/Windows Terminal; `forced-colors`, leitor de tela; `scripts/test_install.sh` subcaso de rede.

## Riscos conhecidos
- `bin/pi`: enquanto a pilha de patches do pi-code não reverte inteira (hoje não reverte, com ou sem o patch desta onda: há patches de outras frentes em `~/.pi/agent/claude-home/patches/pi-code` que não aplicam), cada início avisa “does not apply”. Pré-existente.
- Reverter o send-now depois de aplicado sobre os avisos leva junto os avisos de `interactive-mode.js` e do chunk; o `bin/pi` reaplica no início seguinte (com teste).
- “↑ traz o pedido de volta” depende do histórico nativo do editor; sem prova ponta a ponta.
- Atualização do pi (≠ 1.5.2) ou do pi-code (≠ 1.7.0): os patches são pulados e os textos nativos voltam; se só o `notify-owner` faltar, `notify.ts` e avisos notificam os dois.
