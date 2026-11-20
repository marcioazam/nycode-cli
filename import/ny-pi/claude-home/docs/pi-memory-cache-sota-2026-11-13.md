# Memória e cache SOTA no pi (2026-11-13)

## Objetivo e aceitação
Reduzir o custo de cache do pi sem perder acerto, e escolher a memória SOTA para o harness (config antes de
extensão/MCP nova). Aceitação (remedição com `bin/cache-misses.sh` após 2–3 dias de uso):
1. perdas totais (cacheRead = 0) na faixa 3–30 min caem ≥ 50%;
2. custo do aquecimento < custo de perda que ele evita;
3. sem piora nas faixas ≤ 3 min e > 30 min;
4. veredito por candidato de memória/cache com fonte primária; nada instalado sem ganho medido.

## Custo e qualidade (rules/harness-economy.md)
Diagnóstico local sem custo de API além de sessões curtas em `claude-haiku-5-5` (< US$ 1). Correções esperadas: config
ou ajuste mínimo de extensão, zero bytes novos sempre carregados. Teto potencial: ~US$ 33 de US$ 345 (faixa 3–60 min).

## Medição base (`bin/cache-misses.sh 2026-11-11`, 2026-11-13)
- 4.457 chamadas, US$ 349,5: leitura de cache 160,1 (46%), gravação 127,2 (36%), saída 62,2 (18%).
- Aquecimento (`cache_warm`): 93 eventos, US$ 5,15, só leitura (cacheWrite 0).
- Perdas totais no meio da sessão (56, US$ 63,8 = 18%):

| pausa | n | US$ | com aquecimento na pausa |
|---|---|---|---|
| ≤ 3 min | 22 | 22,21 | 0 |
| 3–30 min | 21 | 24,68 | 0 |
| 30–60 min | 7 | 8,54 | 0 |
| > 60 min | 6 | 8,38 | 1 |

- Antes das perdas ≤ 3 min: troca de modelo, entrar/sair do modo plano, compactação, `context_edit` do usuário.
- Primeira chamada de cada sessão: 32, US$ 6,7 (~48K de prefixo), inevitável.
- Em todas as 27 perdas de 6–51 min (mesmo modelo) não houve aquecimento, embora a economia do pi
  (`pi-ai/dist/cache-warming.js`: probabilidade 0,15 × custo da perda − custo do aquecimento ≥ US$ 0,05) mande aquecer
  acima de ~100K tokens. E cacheRead = 0 indica que nem o prefixo de 1h (`extensions/prefix-cache-1h`) foi lido.

## Hipóteses (a verificar)
- H1: o aquecimento para com "conversation context changed": `sdk.js:213` exige identidade de cada mensagem; uma
  extensão que substitui mensagens após o turno o derruba.
- H2: o processo do pi terminou na pausa (`pi -c` depois); aí o aquecimento não tem como rodar.
- H3: o prefixo (tools + system) muda entre turnos ou no reinício (índice da `memory`, linhas do SessionStart,
  `mcp_servers`, ferramentas do modo plano), invalidando também o cache de 1h.

## Passo 2: aquecimento (H1 confirmada, corrigida)
- E2E (tmux, `claude-haiku-5-5`, `/tmp/warm-e2e`): um turno e `/session` já mostrava
  `Status: Inactive (conversation context changed)` em menos de 1 min.
- Instrumentação temporária do `cacheContextIsCurrent` (revertida): a mensagem que perde a identidade é a
  `custom` `claude-hook-context` (hook UserPromptSubmit do dispatcher), igual à original exceto `timestamp`. Causa:
  `_refreshFinalizedContext` troca `agent.state.messages` pela projeção da sessão, e `sessionEntryToContextMessages`
  recria custom_message/resumos (`createCustomMessage(..., entry.timestamp)`); o isCurrent compara por `===`.
  Bug do upstream (pi 1.5.2 = `latest` no npm em 2026-11-13); toda sessão com hook de contexto perdia o aquecimento.
- Tentativa descartada: memoizar a projeção por entrada (passou no teste de identidade, falhou no E2E: a 1ª troca
  é da mensagem viva pela projetada).
- Conserto: `patches/pi-core/cache-warm-identity.mjs` troca o `===` por `piSameContextMessage` (mesmo papel e campos,
  fora `timestamp`, que não vai ao provedor) no bundle e em `core/sdk.js`; o wrapper `~/.local/bin/pi` aplica quando
  falta (grep do marcador; idempotente; avisa se não casar após update).
- TDD: `bin/tests/cache-warm-identity.test.ts` falhou antes (release sem o conserto) e passa depois (3/3: semântica
  da equivalência, release consertada, apply idempotente + `node --check`). E2E depois do conserto pelo wrapper:
  `Status: Decision in 4m 6s (15% continuation probability, expected savings $0.000 < $0.050 -> stop)` (contexto
  pequeno do Haiku: parar é a decisão econômica correta). Aquecimento real em contexto grande: verificado na remedição.
- Rollback: tirar o bloco `pi_dist` do wrapper e reinstalar a release (`pi update`) ou restaurar `core/sdk.js` e o
  chunk `chunk-VEJDBY3O.js`.

## Passo 3: prefixo (instrumentado; análise na remedição)
- Perdas totais desde o `prefix-cache-1h` (2026-11-12 21:55Z): 7 na sessão principal. 2 após compactação (gap 0–1 min),
  2 após sair do modo plano para executar (`plan-mode-execute`), 1 no início de `/goal` (gap 20 min), 2 só com
  `message:user` entre as chamadas (gap 1 e 47 min). Com cacheRead = 0 nem tools/system (≈48K, 1h) foram lidos.
- Teste rápido (Haiku, tmux): entrar no modo plano **não** quebra o cache (tools/system iguais no payload, histórico
  intacto, cacheRead 47.764): o pi manda a troca de ferramentas como mensagem no meio da conversa.
- Sonda temporária `~/.pi/agent/extensions/cache-prefix-probe/` (só hashes e índices em
  `~/.cache/pi-cache-probe/<data>.jsonl`, sessão principal): por requisição, se tools/system mudaram e o primeiro
  bloco de mensagem divergente. Na remedição, cruzar cada perda com a sonda para achar o gatilho (compactação,
  execução do plano, `/goal`) e decidir o conserto. A sonda é removida no passo 6.

## Passo 4: pesquisa (2026-11-13; Perplexity + Keenable, páginas lidas com `web_fetch`)
| Item | Fonte primária lida | Veredito |
|---|---|---|
| Preços de cache Anthropic | <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>: Opus 5.5 $4 / escrita 5m $5 / 1h $8 / leitura $0,20 (0,05×); Sonnet 5.5 $2/$2,50/$4/$0,10; Haiku 5.5 ≤100K $0,10/…/$0,01; Fable 5.2 $8/$10/$16/$0,20 (0,025×) | Tabela do pi (`pi-ai/dist/providers/data/anthropic.json`) bate nos 4 modelos; a economia do aquecimento usa preço certo. Nada a mudar. |
| TTL e invalidação | mesma página: TTL conta do início da requisição; leitura renova sem custo; hash cumulativo tools → system → messages; 4 breakpoints | Confirma o desenho atual (`prefix-cache-1h` em tools/system, 5m no resto). Nada a mudar. |
| Context editing (`clear_tool_uses`, `clear_thinking`) | <https://platform.claude.com/docs/en/build-with-claude/context-editing>: beta `context-management-2025-06-27`; limpar resultados "invalidates cached prompt prefixes" | Rejeitado: troca leitura barata (0,05×) por nova escrita; nossa perda é de cache, não de janela. |
| Compactação no servidor | mesma página só remete à página própria | Rejeitado por ora: o pi já compacta (`PI_COMPACT_AT=250000`); trocar exigiria extensão de provedor. Reavaliar só se a remedição mostrar perdas pós-compactação relevantes. |
| Memória em arquivos vs. busca/wiki | <https://www.anthropic.com/research/components-of-agent-memory> (2026-11-06): diretório de memória sobe CL-Bench de 0,655→0,838 (Opus 5.5); poucos arquivos curtos venceram centenas; regra "só registrar falhas" piorou (−0,234 Opus 5) | Mantém as três camadas atuais (memory tool do pi-code, knowledge vault, /docs): já são arquivos curtos com índice. |
| Memória em grafo (MOOSEDev, arXiv 2608.13662) | resumo do Keenable: completude e negação muito acima de mem0/notas, mas 78K–167K tokens vs ~35K | Rejeitado: custo 2–5× por consulta, paridade em recuperação simples. |
| Extensões de memória do pi: `openpi-memory`, `jo-inc/pi-mem`, `jayzeng/pi-memory`, `tickernelz/pi-memory`, `ArtemisAI/pi-mem` (AGPL, SQLite+Chroma) | READMEs no GitHub | Rejeitadas: duplicam o memory tool do pi-code; as que injetam por turno (`pi-mem`, `jayzeng` modo per-turn) quebram o cache; nenhuma tem ganho medido. |
| Bug do aquecimento upstream | <https://github.com/earendil-works/pi/issues/10956> (aberta, mitsuhiko atribuído, "still present" até main 64c96d0 pós-1.5.2; correções propostas não mescladas, inclusive comparação por `isSameContextMessage`) | Mesma causa do passo 2. Manter o patch local; o wrapper avisa (saída 2) quando o upstream mudar o trecho, e aí remover o patch se a correção oficial entrar. Sem comentário externo (não autorizado). |

## Passo 5: correções mínimas
Nenhuma além do passo 2: a pesquisa não achou config que reduza as perdas restantes. Os gatilhos do passo 3
(compactação, execução do plano, `/goal`) só ganham conserto se a remedição com a sonda os confirmar.

## Plano
1. [DONE:1] Este registro e `bin/cache-misses.sh`.
2. [DONE:2] Diagnóstico e conserto do aquecimento.
3. [DONE:3] Diagnóstico do prefixo: sonda instalada; gatilhos fechados na remedição.
4. [DONE:4] Pesquisa web e vereditos de memória/cache.
5. [DONE:5] Correções mínimas com rollback (só o passo 2).
6. Remedição após 2–3 dias; checagens; plan-reviewer; knowledge vault.

## Checkpoint
Passos 1–5 feitos. Próximo: passo 6, remedição a partir de 2026-11-15 com `bin/cache-misses.sh 2026-11-13`
(aceitação: perdas 3–30 min −50%, aquecimento custa menos que economiza, sem regressão nas outras faixas),
cruzar com a sonda e removê-la.

## Passo 6, prévia (2026-11-13 16h, ~1 dia de dados; a remedição formal continua em 2026-11-15)
- `bin/cache-misses.sh 2026-11-13`: perdas de 3–30 min = **0** (antes: 21, US$ 24,68 em ~2 dias); ≤ 3 min = 13
  (US$ 10,96); 30–60 min = 1; > 60 min = 4. Aquecimento: 62 vezes, US$ 2,83.
- Gatilhos (`bin/telemetry/cache_probe_join.py`, novo, testes `test_cache_probe_join.py` 3/3):

  | gatilho | n | US$ |
  |---|---|---|
  | compactação | 5 | 3,13 |
  | troca de modelo | 3 | 4,55 |
  | `tools_changed` (logo após `plan-mode`) | 3 | 1,29 |
  | provedor (prefixo idêntico, sem mudança local) | 2 | 2,42 |
  | sessão reaberta | 1 | 0,75 |
  | `unknown` (antes da sonda existir) | 4 | 4,14 |

- Candidato a conserto: a saída do modo plano do pi-code restaura as ferramentas como `[...savedTools, ...late]`
  (`extensions/plan-mode/index.ts:120`). Isso muda o array de ferramentas e invalida o cache inteiro. Decidir na
  remedição se compensa um patch local (restaurar na ordem original) contra ~US$ 0,4 por troca. Compactação e troca de
  modelo são inevitáveis.
- Agendamento: `~/.config/systemd/user/pi-cache-remeasure.timer` (2026-11-15 09:00, `Persistent=true`) roda
  `bin/telemetry/cache-remeasure.sh`, grava `docs/cache-remeasure-2026-11-15.txt` e avisa via `notify-send`. Depois:
  aplicar a aceitação acima, remover a sonda e o timer (`systemctl --user disable --now pi-cache-remeasure.timer`).

## Rollback
Cada correção lista o seu; `bin/cache-misses.sh` é só leitura.
