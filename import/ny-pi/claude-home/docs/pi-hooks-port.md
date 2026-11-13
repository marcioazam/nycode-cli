# Hooks do `~/.claude` no pi: porta por custo x benefício (2026-11-11, quarta rodada)

Pedido do usuário (2026-11-11): trazer os hooks do `.claude` para o pi, adaptar e melhorar cada um, ler um a um e
terminar sem bugs, pendências ou gaps. Restrição dada no meio da tarefa: **"não coloque o que não for custo x
benefício e o que não valer"**. Este registro atualiza a tabela da terceira rodada em `pi-instructions.md`.

Critério: entra o hook que muda o comportamento do modelo ou protege o usuário a um custo medido pequeno. Fica fora o
que só observa (há equivalente offline em `bin/telemetry/pi_telemetry.py`, lido das sessões) ou que não mostrou
efeito nos dados do Claude.

## Decisão por hook (lidos um a um)

Fontes: `~/.claude/settings.json` (`hooks`), `~/.claude/hooks/**` e os hooks dos plugins **ligados** em `enabledPlugins`.

| Hook do Claude | Decisão no pi | Por quê (evidência) |
|---|---|---|
| `hook-dispatch.sh` SessionStart: nota pós-compactação, repo, `/tmp`, launchers MCP, updates, scan de skills, lint do knowledge vault | **portado** `hooks/dispatch/hook-dispatch.sh` | roda 1 vez por sessão; a nota pós-compactação é a regra de retomada do CLAUDE.md. Launchers lidos de `~/.pi/agent/mcp.json`: o `harness_currency.py --missing` do Claude lê `.claude.json` e, com o `CLAUDE_CONFIG_DIR` do pi, acusava 14 servidores "faltando" |
| `hook-dispatch.sh` PostToolUse: aviso de teste editado, alerta de injeção, nota do Perplexity, lembrete do knowledge vault, lembrete de entrega git | **portado** (mesmo script) | texto só quando o gatilho casa; 4,5 ms ± 0,3 por chamada de ferramenta (hyperfine, 30 execuções) |
| Sensor de exclusão de cobertura (PostToolUse Edit/Write; só no pi, 2026-11-12) | **novo** no mesmo script (`edit_sensors`) | na eval `pi-outcome-k2` o agente pôs `pragma: no cover` (doces-ou-travessuras: TRAVESSURA, `coverage-pragma`); o sensor devolve o lembrete do contrato na hora, sem bloquear; teste `test_coverage_exclusion_sensor` (vermelho antes, verde depois) |
| `hook-dispatch.sh` auditoria (`audit.jsonl`, notify-send) | **fora** | só observa; `pi_telemetry.py audit` reconstrói das sessões; o guard já nega o catastrófico |
| `hook-dispatch.sh` ledger + `claims/cade_o_print.py` (Stop) | **fora** | no Claude, 85 julgamentos e 0 avisos ao modelo (modo feedback nunca ligado; 51 `unknown`); `pi_telemetry.py claims` faz o mesmo julgamento offline |
| `hook-dispatch.sh` PreToolUse (worktree preflight) | **nativo do pi-code** | `subagent/worktree.ts` falha a execução fora de um checkout Git; nenhum agente do pi declara `isolation` |
| `route_hint.py` + `route_hints.json` (UserPromptSubmit) | **fora** | no Claude está ligado, mas "seguida" é só coincidência: mediana ~38% (multiagent 7%, reliability 12%), sem par controle; no goal8 o modelo ignorou a skill indicada em 10 de 10 casos; custa até 1200 caracteres por prompt que casa e 26 ms; o pi já lista skills e agentes no prompt |
| `subagent_telemetry.py`, `tool_use_telemetry.py`, `lib/telemetry_io.py` | **fora** | só observam; o SubagentStop do pi não traz usage; `pi_telemetry.py tools|subagents|cost` lê tudo das sessões |
| `plan/plan_gate.py` | `extensions/plan-gate.ts` (terceira rodada) | cumpre a decisão de 2026-11-08 |
| `sound-notify.py` | `extensions/sound-notify/index.ts` (terceira rodada) | 1 processo por turno interativo |
| `graph_context.py` | `hooks/graph_context.py` (segunda rodada) | linhas `Graph:`/`knowledge vault:` |
| `context-mode-cache-heal.mjs`, hooks do plugin context-mode | **não se aplica** | o pi não usa context-mode |
| plugin impeccable (SessionStart, PostToolUse Edit\|Write, Stop) | **portado com gate** `hooks/impeccable_gate.sh hook` | só roda em projeto com `PRODUCT.md`, `DESIGN.md` ou `.impeccable/` na raiz; fora deles ~5 ms por Edit/Write e nada mais (no Claude roda e cria `.impeccable/` em todo projeto). `impeccable hooks status` diz "not wired" (compara o comando exato do pacote) e o `context` pede um `detect` manual no fim. Medido: o pedido continua mesmo numa simulação fiel do Claude (comando exato, `CLAUDE_ENV_FILE`, `IMPECCABLE_SESSION_ID`, `CLAUDECODE`, `CLAUDE_PROJECT_DIR`), e o pi-code não implementa `CLAUDE_ENV_FILE`; o custo é um `detect` por trabalho de design, então fica aceito |
| plugin ponytail (SessionStart, SubagentStart, UserPromptSubmit) | extensão `vendor/ponytail/pi-extension` + `PONYTAIL_SUBAGENT_MATCHER` no `settings.json` | os filhos herdam o modo do pai e só os agentes writers recebem as regras (~1870 tokens por turno a menos nos outros), como no Claude |

## Registro em `claude-home/settings.json`

| Evento | Hooks |
|---|---|
| PreToolUse `Bash\|Edit\|Write\|Read` | `guard.py` |
| SessionStart `startup\|resume\|clear\|compact` | `graph_context.py`, `dispatch/hook-dispatch.sh`, `impeccable_gate.sh hook` |
| SubagentStart `*` | `graph_context.py` |
| PostToolUse | `*` dispatcher; `Edit\|Write` `impeccable_gate.sh hook` |
| Stop | `ralph-loop`, `impeccable_gate.sh hook` (30 s) |
| `env` | `PONYTAIL_SUBAGENT_MATCHER` (lista de writers do Claude) |

O pi-code roda os eventos de ferramenta também nos filhos do `subagent` (`PI_CODE_SUBAGENT=1`) e pula neles
SessionStart, Stop e UserPromptSubmit, como o Claude (`extensions/hooks/index.ts`, `inSubagentChild`); os lembretes de
marco e entrega são só da sessão principal.

## Achados

- **stdin de hook é socket no pi-code** (Node `child_process` com `pipe`): `$(</dev/stdin)` reabre `/proc/self/fd/0`
  e falha com ENXIO, o script via `{}` e saía calado. Correção: `IFS= read -r -d '' payload`. Os testes entregam o
  stdin por `socket.socketpair()` (red 25/38 antes da correção, green depois).
- Payloads reais do pi-code 1.7.0 em `hooks/fixtures/pi-code-1.7.0/`, usados pelos testes do dispatcher.
- O `subagent` devolve a conversa do filho em `tool_response.details.results[].messages`, útil se um dia o
  julgamento de claims voltar a rodar ao vivo.

## Evidência

- Testes: `hooks/` (guard, graph_context, impeccable_gate) e `hooks/dispatch` verdes; ponytail `npm test` 30/30;
  shellcheck limpo; `check-instructions.py` 0 problema; `structure.py` sem achados em `hooks/`, `bin/` (dividido em
  `telemetry/`, `hud/`, `tests/`) e `vendor/ponytail/pi-extension`. Saídas na conversa da tarefa.
- E2E `pi -p` (Sonnet 5.5): notas de SessionStart, "Test file edited", achado `[gradient-text]` do impeccable num
  projeto com `PRODUCT.md`, lembretes de knowledge vault e entrega depois de `git commit`; stderr do pi vazio. Ponytail:
  Explore "No", general-purpose "Yes" para "PONYTAIL MODE ACTIVE" no prompt.
- Pesquisa MCP: Perplexity em https://code.claude.com/docs/en/hooks e https://code.claude.com/docs/en/hooks-guide
  (`additionalContext`, `async`, `if`, `SessionStart.source`); Keenable na doc de hooks do pi-code e em pacotes
  alternativos (`pi-hooks`, `pi-claude-hooks`); fonte de verdade: código instalado do pi-code 1.7.0.
- Vigilância: `check-instructions.py` vigia cada fonte acima (as não portadas também, com o motivo) e o inventário de
  hooks do Claude (`settings.json` + plugins ligados); hook novo em `~/.claude/hooks` é acusado.

## Rollback

Remover as entradas do `settings.json`; os scripts ficam inertes sem registro. Ponytail: `PONYTAIL_SUBAGENT_MATCHER`
vazio volta a injetar em todo subagente.

## `guard.py`: `pkill -f`/`pgrep -f` que matam o próprio shell (2026-11-12)
Porta como hook da proposta P1 do Claude (`~/.claude/docs/harness-audit-2026-11-09.md`, que lá virou uma linha de
regra). A regra de economia diz que um requisito sem exceção pertence a um hook, então aqui é uma negação no guard.

- Falha: a ferramenta `bash` roda `bash -c "<comando>"`, e um padrão `-f` que aparece no próprio comando casa com o
  shell e o mata. No Claude foram 216 erros e 153 saídas 144 em 1.668 chamadas. No pi aconteceu de novo ao vivo em
  2026-11-12 (exit 143).
- Regra: `pkill -f`/`--full`, ou `pgrep -f` cuja saída vai para `kill` (`| xargs kill`, `kill $(...)` ou crases), é
  negado quando o padrão casa com o comando inteiro. A negação vale também sob bypass. A mensagem manda usar o
  colchete (`'[c]hrome'`) ou o PID salvo. `pgrep -f` só de leitura e `pkill` sem `-f` continuam liberados.
- Testes: `test_guard.TestSelfKill` (3 testes, 15 casos na 1ª versão, 20 depois do ajuste abaixo). Primeiro deram 6 falhas sem a regra, depois passaram; o
  mutante `matches_self → False` foi pego com 6 falhas. A suíte inteira tem 20 testes, mais os do `dispatch`, tudo
  OK. Ao vivo nesta sessão: `pkill -f zz-nonexistent-proc-zz` foi bloqueado com a mensagem; a forma com colchete
  rodou (exit 1).
- Custo: 0 tokens sempre carregados (a mensagem só aparece quando a regra dispara); uma regex a mais por chamada
  `bash`.
- Falso positivo corrigido no mesmo dia: o `pgrep -f … | xargs kill` era procurado no texto bruto, então um
  heredoc que só citava o padrão (este registro, gerado por `python3 - <<EOF`) foi bloqueado. Agora `mask_text`
  apaga o corpo do heredoc, exceto quando quem o lê é um shell (`bash <<EOF`, onde o texto roda), e o conteúdo
  entre aspas, mantendo o tamanho. O padrão continua sendo comparado com o comando inteiro, porque o `bash -c`
  carrega tudo. Ganhou 5 casos de teste (4 de liberação e 1 de negação com `bash <<EOF`). Os mutantes "mascarar
  todo heredoc" e "não mascarar" foram pegos (1 e 4 falhas).
  ponytail: o conteúdo entre aspas depois de `bash -c` também é mascarado, um falso negativo raro.
