# Faixa logs (relatório bruto do subagente, 2026-11-19)

**Status: complete**, com cobertura degradada: não há índice codegraph, então usei rg, jq e awk. Apaguei meus arquivos de rascunho em /tmp, e nada sob ~/.pi, ~/.claude ou o repositório foi alterado.

**Janela dos dados.** `diag.jsonl.1` e `diag.jsonl` cobrem 2026-11-16T08:59 a 2026-11-19T07:02 UTC, 1.137 eventos não-INFO. Eventos anteriores a 11-16 foram rotacionados e perdidos. Os traces só começam em 11-19T01:14, quase tudo depois do corte de 11-18T22:00. "48h" abaixo é desde 11-17T07:04. "Pós" é depois de 11-18T22:00.

## 1. Erros e avisos por tipo
| tipo | total | 48h | pós | primeira/última | exemplo | causa provável |
|---|---|---|---|---|---|---|
| bash timeout acima do teto | 75 | 71 | 24 | 11-16 08:59 / 11-19 01:38 | `bash: timeout de 3000s acima do teto de 1800s…` | harness: briefs de git-delivery (50), gate-runner (6) e swarm-worker pedem 2.000–3.600 s (3000 s ×36); recusa em `extensions/bash-timeout/index.ts:35`, teto `:22` |
| read ENOENT `$CLAUDE_CONFIG_DIR/docs/agent-contract.md` | 101 | 98 | 35 | 11-16 18:30 / 11-19 02:18 | `ENOENT … '~/code/pi-harness/$CLAUDE_CONFIG_DIR/docs/agent-contract.md'` | harness: variável literal que o `read` não expande. swarm-worker 41, gate-runner 15, plan-reviewer 12, security-reviewer 7, Explore 7 |
| guard: rm recursivo forçado | 41 | 41 | 33 | 11-17 13:33 / 11-19 03:39 | `Bloqueado pelo guard: rm recursivo forçado` | harness: `claude-home/hooks/guard.py:205`; swarm-worker 29, web-platform-engineer 4, plan-reviewer 4 |
| guard: pkill -f que casa com o próprio shell | 10 | 9 | 4 | 11-16 / 11-19 02:59 | `Bloqueado pelo guard: pkill -f com padrão…` | guard em ação (comportamento correto, mas o agente repete) |
| 429 rate_limit_error | 143 | 71 | 21 | 11-16 17:22 / 11-19 05:10 | `…would exceed your account's rate limit` | externa: cota da conta |
| "quota exceeded", auto-resume | 65 | 56 | 17 | 11-16 17:23 / 11-19 05:10 | `quota exceeded (account usage limit; auto-resume…)` | externa: cota |
| ChatGPT/Codex usage limit | 15 | 11 | | 11-16 / 11-19 | `You have hit your ChatGPT usage limit (plus plan)` | externa: cota |
| Compactação falhou (Codex limit) | 6 | 1 | 0 | 11-16 16:01 / 11-18 21:03 | `Compaction failed: Summarization failed: Codex error…` | externa: cota |
| EAI_AGAIN api.anthropic.com | 30 | 26 | 26 | 11-16 09:28 / 11-19 02:18 | `Connection error.: getaddrinfo EAI_AGAIN api.anthropic.com` | externa: rede/DNS. As 26 pós-corte são do mesmo surto |
| retry "falha no pi" | 17 | 16 | 16 | 11-16 15:55 / 11-19 00:01 | `falha no pi` | externa, junto da rede |
| retry "sem conexão" | 6 | 2 | 0 | 11-16 / 11-18 19:53 | `sem conexão com o provedor` | externa |
| hook Status timeout (5 s) | 29 | 27 | 23 | 11-16 15:55 / 11-19 02:18 | `Status · node · timeout · N ms` | máquina sobrecarregada (hipótese); hook `Status` do harness |
| detector tool-travada | 22 | 21 | 10 | 11-16 14:33 / 11-19 02:58 | `tool bash rodando há 10 min` | bash 15, subagent 5, question 2 |
| detector modelo-lento | 15 | 13 | 7 | 11-16 13:12 / 11-19 03:11 | `modelo anthropic/claude-sonnet… levou N s` | provedor lento |
| detector tool-em-laço | 8 | 7 | 3 | 11-16 08:59 / 11-19 01:19 | `tool bash falhou N vezes seguidas` | consequência de timeout e ENOENT |
| Plan mode: comando bloqueado | 12 | 12 | 8 | 11-17 20:10 / 11-18 23:24 | `Plan mode: command blocked (not allowlisted)` | comportamento esperado |
| Traceback / Command timed out | 7 / 14 | 7 / 12 | 3 / 4 | 11-16 / 11-19 | `Command timed out after N seconds` | comandos dos próprios agentes |

Falso positivo de classificação: cerca de 100 WARN `tool:bash` têm como corpo a saída normal do comando, não erro. Exemplos: `(no output)`, a saída de `uptime`, código-fonte e `✔ launcher lists…`.

## 2. Latência (traces desde 11-19T01:14)
| ferramenta | n | p50 | p95 | observação |
|---|---|---|---|---|
| bash | 1.158 | 198 ms | 115 s | máx. 1.200 s |
| read | 125 | 6 ms | 118 ms | |
| subagent | 22 | 40 ms | 136 s | máx. 210 s |
| write | 6 | 33 ms | 42 ms | amostra pequena |
| edit | 2 | 50 ms | 50 ms | amostra mínima |
| MCP | 0 | | | nenhum span de MCP nos traces |

- **Top 10 chamadas lentas:** são todas `bash`, entre 11-19T01:59 e 03:00, de 305 s até 1.200 s (1.200 s, 1.017 s, 900 s, 742 s, 731 s, 600 s, 541 s, 411 s, 345 s, 305 s).
- **Chat:** p50 3,6 s, p95 18,7 s, máx. 122 s.
- **Span `pi.hook Status`:** sempre 0 ms em 3.549 amostras, mas o diag registra timeouts do mesmo hook. A instrumentação do span não mede a duração real.

## 3. Falhas repetidas (≥5 vezes)
- **Timeout > 1800 s:** git-delivery (50), gate-runner, swarm-worker e web-platform-engineer.
- **`$CLAUDE_CONFIG_DIR` literal no `read`:** swarm-worker, gate-runner, plan-reviewer, security-reviewer e Explore.
- **`rm -rf`:** swarm-worker (29), web-platform-engineer e plan-reviewer.
- **Laço de tool:** 8 ocorrências.

## 4. MCP por servidor
- **Exa:** 402 de créditos, 5 `web_search_exa` e 1 `web_fetch_exa`, de 11-17T14:19 a 11-18T22:52. Houve também 1 alerta "mcp__exa__web_search_exa falhou N vezes seguidas".
- **Keenable:** `Tool mcp__keenable__search_web_pages not found`, 1 vez (perplexity-scout). Está declarado como direto, então pode ser falha de registro.
- **Outros:** 1 `target_blocked` num fetch. Não achei 429, timeout ou login de MCP.
- **`~/.pi/agent/mcp.log`:** só youcom, info, parado em 11-15.

## 5. Custo
| modelo | turnos | out/turno | cacheRead/turno |
|---|---|---|---|
| opus-5-5 | 474 | 858 | 151 mil |
| sonnet-5-5 | 861 | 471 | 75 mil |
| fable-5-2 | 72 | 1.594 | 133 mil |

- **Cache:** a leitura é alta e o input sem cache é baixo, então não há sinal de cache miss. `cache_creation` não é registrado (zero), logo o custo de escrita é desconhecido.
- **Compactação:** 4 spans `session_compact`, todos por `threshold`, mais 6 falhas por cota.
- **Retries:** 23 `modelo/retry`.
- **Nenhum custo em dólar medido.**

## 6. Higiene
- **Tamanhos:** sessions 522 MB (34 arquivos), checkpoints 382 MB (1.871 diretórios, 1.755 com `logs`), diag 7,9 MB. `cache/` e `tmp/` não existem.
- **Inbox:** 29 arquivos, 672 KB. 26 têm PID morto, o mais antigo de 11-14. Só 3 PIDs estão vivos (1917162, 2194111, 3935857).
- **Rotação:** o diag rotaciona em 1 MiB e guarda uma só geração (`extensions/diagnostico/registro.ts:30,47`), o que faz o histórico sumir em cerca de 3 dias. Não há rotação para inbox, checkpoints e sessions.
- **Telemetria de 11-16:** `currency.json` tem 14 pacotes defasados, 4 ausentes e 0 erros. O scan de skills (`plugin-skills.txt`) cobriu 444 skills, com 524 achados (15 críticos e 14 altos). Não li os achados.

## F1–F6 do perf-sota.md
| F | ainda ocorre depois de 11-18T22:00? |
|---|---|
| F1 | Não evidenciado. `edit` 50 ms e `write` 33 ms, mas com n=2 e n=6. |
| F2 | **Sim**, 35 ocorrências. Os `.md` dos agentes no repositório já dizem `~/.pi/...` (modificados, sem commit). O `$CLAUDE_CONFIG_DIR` literal deve vir do brief do pai ou de uma cópia viva fora do repositório. Não confirmei a origem. |
| F3 | **Sim**, 24 recusas e 3 laços. O teto continua em 1800 s. |
| F4 | Não avaliável nos logs (era medição de CPU). |
| F5 | Parcial. `question` já está isenta em `trilha.ts:138`, e o último alerta de `question` foi 11-18T15:09. O subagent também está isento, mas houve 5 alertas de subagent no total. |
| F6 | Não avaliável nos logs. |

A nota sem defeito do ny-pi continua valendo: 429, compactação por cota, Exa 402 e timeouts do hook de status.

## 7. Defeitos do harness evidenciados pelos logs
1. `$CLAUDE_CONFIG_DIR` literal no `read` (101 vezes, 35 pós-corte): corrigir o brief e não depender de expansão.
2. Briefs pedem timeout acima de 1800 s: 75 recusas (git-delivery 50).
3. swarm-worker tenta `rm -rf` (29 bloqueios) sem alternativa. O guard está certo, mas o agente repete o comando.
4. Agentes repetem `pkill -f` bloqueado (10).
5. O diag registra a saída normal do bash como WARN (cerca de 100 eventos).
6. O span `pi.hook Status` sempre com 0 ms (3.549 amostras), embora o diag registre timeouts do mesmo hook.
7. `cache_creation` não é registrado nos spans `chat`.
8. O diag guarda só 1 geração (~3 dias), e inbox, checkpoints e sessions não têm rotação.
9. 26 inbox órfãos (PID morto) nunca são limpos.
10. Tool em laço (8 ocorrências) não interrompe a causa: o detector só avisa.
11. Bash de 20 minutos ou mais (top 10 todos acima de 5 min) rodando em primeiro plano, apesar do aviso de usar `run start`.
12. `mcp__keenable__search_web_pages not found`, 1 vez, em perplexity-scout.
13. Agentes insistem no Exa após o 402 (6 falhas e 1 "falhou N vezes").
14. Hook `Status` com timeout de 5 s (29 vezes, 23 pós-corte), provavelmente por carga da máquina.

**Causas externas:**
- 429 e cota da conta: 143 e 65.
- Limite do ChatGPT/Codex: 15.
- Compactação falhando por cota: 6.
- EAI_AGAIN e retries de rede: 30 + 17 + 6.
- Exa 402 (créditos).
- Fetch bloqueado pelo alvo.

**Não cobri:**
- Os conteúdos de sessions e checkpoints.
- Os tokens de turnos de subagentes, separados dos da sessão principal.
- A origem exata do `$CLAUDE_CONFIG_DIR` literal.
- Os achados individuais do scan de skills.
