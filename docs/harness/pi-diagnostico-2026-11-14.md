# Diagnóstico: erros e execuções internas visíveis no pi (2026-11-14)

Pedido do dono: mostrar no pi o máximo do que hoje some (erros internos do pi, modelo, hooks, harness), com desenho em
harmonia com o que existe, gerenciável e observável pelo programador.

## Objetivo e aceite

1. Toda falha das fontes da tabela abaixo vira um registro com severidade, fonte, tipo, mensagem de uma linha e detalhe
   completo (nunca cortado).
2. O rodapé mostra a contagem de não vistos (`✕ n · ▲ n`); some quando o painel é aberto ou a lista é limpa.
3. Falha que hoje não aparece em lugar nenhum (console, wrapper, hooks próprios, sink global) gera um aviso de uma linha
   só na primeira ocorrência; repetição só soma `×n`.
4. `/diagnostico` abre o painel: lista mais nova primeiro, filtro por severidade, Enter abre o detalhe (rolável até o
   fim), `s` silencia ou reativa a entrada, `l` limpa a lista, caminho do log no rodapé.
5. Cada ocorrência vai para `~/.pi/agent/diag/diag.jsonl` (campos OTel), com segredos redigidos e rotação em 1 MiB.
6. `PI_DIAG=0` desliga tudo (rollback); subagentes e modo print não são tocados.
7. Nada muda no texto enviado ao modelo nem no comportamento de falha existente (quem permitia continua permitindo).

## Mapa do que some hoje (verificado em pi 1.5.2 / pi-code 1.7.0)

| fonte | hoje | captura |
|---|---|---|
| `ctx.ui.notify` de qualquer extensão (hook error do pi-code, MCP, etc.) | linha transitória, sem histórico | embrulha `notify` do `uiContext` compartilhado (`runner.js:359`, `ctx.ui` devolve o mesmo objeto) |
| `console.warn` / `console.error` (≈40 sítios do pi-code: config de hooks e MCP, refresh; `core/event-bus.js:14`) | stderr atrás da TUI | embrulha `console.warn/error` enquanto há UI |
| retry automático do modelo | o erro vermelho é escondido (`avisos/runtime.mjs` `retryInicio`); sucesso não deixa rastro | `retryInicio`/`retryFim` chamam o sink global |
| erro final do modelo (`message_end`, `stopReason=error`) | visível no chat | registra (sem aviso extra) |
| `tool_execution_end` com `isError` | visível no chat | registra (sem aviso extra) |
| `session_compact_failed` | chat ou só status | registra |
| exceção não capturada | stderr depois de `ui.stop`, `crashes.json`, aviso uma vez no próximo start | `uncaughtExceptionMonitor` grava FATAL; `crashes.json` das últimas 24 h entra no painel sem aviso |
| wrapper `bin/pi` (patch que não aplica, `apply.mjs \|\| true`) | stderr antes da TUI | `pi_warn` escreve também na caixa de entrada |
| `guard.py` (exceção interna → permite), `graph_context.py` (`except: pass`), `hook-dispatch.sh` (checagem de launchers expira) | stderr ou nada | escrevem na caixa de entrada |

Fora desta entrega (precisa de patch no pi-code ou no núcleo): stderr completo e execuções bem-sucedidas de hooks de
terceiros (`hooks/decisions.ts:162-181` só repassa a 1ª linha; o aviso agora fica no histórico), rejeições engolidas de
hooks notify-style (`hooks/index.ts:403,449,788,804`), erros de handler/carga de extensão como registro (já aparecem no
chat por `showExtensionError`), catches silenciosos do `subagent/`.

## Contratos

Registro em memória: `{ ts, ultimo, sev, fonte, tipo, msg, detalhe?, n, visto, silencioso }`.
`sev` usa o SeverityNumber do OTel: 9 INFO, 13 WARN, 17 ERROR, 21 FATAL. Glifo: `✕` (≥17), `▲` (13), `✓` (9).
Chave de agrupamento: `fonte|tipo|msg`. No máximo 200 registros em memória.

Sink global (patches e extensões): `globalThis[Symbol.for('pi-harness:diag')]?.({ sev, fonte, tipo, msg, detalhe? })`.

Caixa de entrada (processos externos): arquivo `$PI_DIAG_INBOX` (o wrapper exporta
`~/.pi/agent/diag/inbox-<pid>.tsv`), uma linha por evento, `sev<TAB>fonte<TAB>tipo<TAB>msg[<TAB>detalhe]`; tab e
quebra de linha dentro de um campo viram `\t` e `\n` literais. A extensão lê do último offset em `session_start`,
`tool_execution_end`, `turn_end`, `agent_settled` e ao abrir o painel. Caixas com mais de 7 dias são apagadas no start.

Log: `<agentDir>/diag/diag.jsonl`, uma linha por ocorrência:
`{"ts":"ISO","severityNumber":17,"severityText":"ERROR","source":"…","error.type":"…","body":"…","detail":"…","session":"…","pid":1}`.
Acima de 1 MiB vira `diag.jsonl.1` (uma geração). Falha de escrita nunca lança.

Redação (antes da memória e do arquivo): `sk-…`, `gh[pousr]_…`, `Bearer …`, e valor depois de
`api_key|token|secret|password|authorization` viram `«redigido»`.

Mapeamento de severidade: `notify` error/warning/info → 17/13/9; `console.error`/`warn` → 17/13; tool com erro → 13
(tratado: o modelo recebe); erro final do modelo → 17; compactação falhou → 17 (13 se `willRetry`); retry em curso →
13, retry esgotado → 17; exceção não capturada → 21.

## Desenho (harmonia com `/avisos`, `hook-msgs`, `ui-visual/icons.ts`)

- Vocabulário de estado do dono: `▲` atenção, `✓` feito, `✕` erro; cores `warning`, `success`, `error`; texto em pt-BR.
- Rodapé: `ctx.ui.setStatus('diag', '✕ 2 · ▲ 3 · /diagnostico')`, só com não vistos de sev ≥ 13.
- Aviso de primeira ocorrência: `{fonte}: {msg}` pelo `notify` original (warning ou error).
- Painel: moldura do `PainelAvisos` (régua `── Diagnóstico ── ● tudo  erros  avisos ──`, `❯` + `selectedBg` na linha
  escolhida, régua de fecho). Linha: `HH:MM  ✕  fonte  msg  ×n`. Detalhe aberto com a barra `│` do `hook-msgs`.
  Vazio: `Nenhum erro ou aviso nesta sessão`. Rodapé: `↑↓ escolher · enter detalhe · tab filtro · s silenciar · l limpar
  lista · esc fechar` e, na linha seguinte, `registro completo: ~/.pi/agent/diag/diag.jsonl`.

### Depois da revisão de UX (`ux-reviewer`, 2026-11-14; substitui o que diverge acima)

- Altura: o pi-tui corta o overlay em 70% da tela. O painel recebe `altura()` e nunca passa dela; com o detalhe
  aberto, ↑↓ rolam uma linha e PgUp/PgDn uma página, com `… n linhas acima/abaixo`; a linha de meta fica no topo.
- Glifos por `icon()` (`ui-visual/icons.ts`), com o conjunto ASCII; informação (sev 9) usa `tool` em dim, não `✓`.
- Cabeçalho estreito: `── Diagnóstico ── ● <aba> ──`. Abaixo de 50 colunas a linha omite a fonte.
- `s` alterna silenciar/reativar e a dica acompanha. Abre em `erros` quando há erro não visto.
- Não tratado (anterior a esta entrega): `/avisos` fixa `✕ ▲ ✓` sem alternativa ASCII.

## Atalhos no azul do tema (pedido do dono, 2026-11-14)

Antigo: a dica `alt+o abre` / `ctrl+o fecha` das linhas do transcript saia inteira em `dim`. Novo: a tecla usa
`accent` (o azul de pi-claro, pi-escuro e pi-noite) e o verbo segue em `dim`, por `dicaTecla()` em
`ui-visual/icons.ts`. Sítios: `hook-msgs/index.ts` (hook, gate, subagente, run), `ui-visual/tools.ts` (run e
subagente) e `plan-gate.ts`. Teste ajustado: `ui-visual/test/tools.test.ts:755` normalizava a dica por
`ctrl\+`; o tema falso de marcas (`<accent>…</c>`) alarga a linha e a dica chega cortada, então o padrão aceita o
corte (`ct(?:rl\+)?`). Teste novo em `hook-msgs/index.test.ts` afirma `accent` na tecla e `dim` no verbo. As dicas
dos painéis (`/avisos`, `/diagnostico`, `/comandos`) não mudaram.

## Pesquisa (2026-11-14; Perplexity + Keenable/Parallel/Exa, páginas lidas)

- Claude Code: erro não bloqueante de hook mostra só a 1ª linha do stderr; o resto vai para o debug log
  (code.claude.com/docs/en/hooks). `/doctor`, `/mcp`, `--debug` (code.claude.com/docs/en/debug-your-config).
- Gemini CLI: console de detalhes por F12, `ui.errorVerbosity` (geminicli.com/docs/cli/keyboard-shortcuts,
  geminicli.com/docs/troubleshooting). Codex: diagnósticos em armazenamento local limitado
  (github.com/openai/codex docs/install.md). opencode: log em arquivo com caminho descobrível
  (opencode.ai/docs/troubleshooting).
- clig.dev: agrupar erros iguais, reescrever para humanos, log de depuração em arquivo.
- VS Code UX (api/ux-guidelines/notifications): uma notificação por vez, sem repetir, link para os detalhes.
- OTel: faixas de SeverityNumber (specs/otel/logs/data-model), `error.type` de baixa cardinalidade
  (semconv/general/recording-errors), `exception.message` pode ser sensível (semconv/exceptions/exceptions-logs).
- Não verificado: convenções GenAI do OTel (movidas de repositório, em desenvolvimento); não usadas.

## Custo e qualidade

Custo por execução: zero byte sempre carregado; um `statSync` por tool call; um `appendFileSync` por ocorrência.
Qualidade comprada: falhas do harness deixam de ser silenciosas. Nenhum gate ou controle foi enfraquecido.

## Rollback

`PI_DIAG=0`, ou remover `extensions/diagnostico` do `publish.list` e o link. Os produtores só escrevem quando
`PI_DIAG_INBOX` existe e o sink global é opcional (`?.`).

## Checkpoint

- [x] Lane A: `extensions/diagnostico/` + testes
- [x] Lane B: produtores (`bin/pi`, hooks, `avisos/runtime.mjs`) + testes
- [x] `publish.list` + links só desta entrega (o `install.sh --link --apply` também trocaria dois arquivos alheios)
- [x] Verificação e revisão de UX (uma rodada de correção)
- [ ] Commit: não feito; a árvore tem trabalho não commitado de outras frentes nos mesmos arquivos

## Evidência (2026-11-14, `env -u PI_CODE_SUBAGENT`)

- `node --experimental-strip-types --test extensions/diagnostico/test/*.test.ts`: 41 de 41.
- `extensions/hook-msgs/index.test.ts`: 15 de 15. `extensions/ui-visual/test/*.test.ts`: 100 passam, 1 skip.
  `claude-home/bin/tests/plan-gate.test.ts`: 20 de 20. `extensions/avisos/test`: 54 de 54.
  `claude-home/bin/tests/avisos-core`: 76 de 76.
- `python3 -m unittest test_guard test_graph_context test_impeccable_gate`: 37 OK. `dispatch/test_dispatch`: 32 OK.
- `sh -n bin/pi` e `bash -n hook-dispatch.sh`: limpos. `structure.py`: nenhum achado nos diretórios desta entrega.
- Ponta a ponta no pi real (tmux, `~/.local/bin/pi --no-session`): o `notify` de outra extensão entrou no painel
  (o `ctx.ui` é mesmo compartilhado); uma linha na caixa de entrada gerou o aviso `✕ wrapper: …`, o painel abriu em
  `erros`, o detalhe mostrou `token=«redigido»` e o `diag.jsonl` recebeu a linha com os campos OTel; o crash de
  `crashes.json` apareceu como anterior.
- `bash claude-home/bin/tests/pi-ui-final-gate.sh`: sai com 1; 9 checks passam e 6 falham (1 cobertura da extensão
  `ui`, 8 `structure.py`, 9 `check-instructions`, 10 a 12 pilha de patches do pi-code). Nenhum desses domínios foi
  tocado aqui, mas não há linha de base medida antes da mudança: tratar como não verificado.
- Não executado: wrapper de ponta a ponta com um patch real falhando; cobertura por arquivo; retry real do modelo.
