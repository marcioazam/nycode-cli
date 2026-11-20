# Transferência Claude Code → pi: economia e assertividade (2026-11-12)

Pedido: verificar o que ainda vale trazer do `~/.claude` para o pi por custo x benefício, com pesquisa web e
benchmarks. Escopo aprovado: tudo, com gates; teto pago US$ 10 (pesquisa ≤ 2,5; eval limpeza ≤ 2; eval catálogo ≤ 4,5;
reserva 1). Sem entrega git (`~/.pi/agent` não é repositório).

## Medições de partida (sessões do pi, 2026-11-10 → 2026-11-12, só agregados)
- US$ 236 no total; Opus 5.5 = US$ 180 (76%), 2.296 chamadas.
- Contexto por chamada (Opus): p50 161K, p90 336K, máx 401K; > 250K: 682 (29%); > 300K: 400.
- 6 compactações, todas a ~400K; contexto na 1ª chamada depois: 67-89K (quase tudo reescrito no cache).
- Gravação de cache por turno (Opus): p50 1,1K, média 6,2K.
- Caracteres da conversa: resultados de ferramenta 6,24M (64%), assistente 3,36M, usuário 0,09M.
- Cache 1h: 60 chamadas após pausa de 5-60 min regravaram 6,86M tokens (~US$ 33 que o 1h pouparia); o resto das
  gravações (10,7M) pagaria +60% (~+US$ 32). Empate → fora.

## Candidatos e gates
| # | Candidato | Origem no Claude | Gate |
|---|---|---|---|
| 3 | Compactar a 250K | `context-compaction-2026-11-08.md` (300K adotado; ótimo modelado 250K com restart 125K) | modelo recalculado com o restart do pi (~80K); config + `pi -p` |
| 4-6 | Limpeza de resultados de ferramenta antigos | context editing / microcompact (pesquisa R1) | simulador ≥ 10% líquido em sessões > 150K; eval pareada sem regressão, razão ≤ 1,0 |
| 7 | Catálogo de skills enxuto | rodada 4 (corte por telemetria, não por ranking; `skillOverrides` name-only) | eval de roteamento sem pass→fail, precisão ≥ |
| 8 | MCPs atrás (SOTA) | scan de currency | changelog + 1 chamada por servidor |

## Rollback
- Compactação: `PI_COMPACT_AT=400000` no wrapper e `python3 ~/.pi/agent/scripts/compaction-400k.py`; backups em
  `backups/transfer-2026-11-12/` (wrapper, settings.json, compact-at-400k.ts).
- Limpeza: `PI_CONTEXT_CLEARING=0` ou mover `extensions/context-clearing/` para os backups.
- Catálogo: tirar `disable-model-invocation: true` das skills listadas (cópias dos SKILL.md nos backups).

## knowledge vault consultado
- `Billion-Context-vs-Auto-Compact-2026-11` L30: a alavanca é o tamanho do restart, não a janela; o modelo de custo
  por turno vem dali.
- `skills-curation-criteria` L298: zero uso não autoriza apagar; 20 de 24 skills sem caso de roteamento → o gate do
  passo 7 só cobre skills que têm caso; as demais exigem a regra "não exigida por ninguém" e ficam em `/skill:`.

## Checkpoint
- [DONE:1] Registro criado, knowledge vault consultado, backups em `backups/transfer-2026-11-12/`.
- [DONE:2] Pesquisa (perplexity-scout: Perplexity + keenable; web-scout: parallel, exa, paper_search; US$ 0,88 de 2,5).
  Fontes lidas por URL; data de acesso 2026-11-12.
  | Afirmação | Fonte | Efeito no plano |
  |---|---|---|
  | Limpar resultados de ferramenta invalida o prefixo em cache; `clear_at_least` existe para a limpeza valer a regravação | platform.claude.com/docs/en/build-with-claude/context-editing | simulador cobra regravação a 1,25× a partir da 1ª mensagem limpa |
  | Context editing: +29% de desempenho, −84% de tokens num eval de busca de 100 turnos (Anthropic, 2025-09-29) | claude.com/blog/context-management | métrica de tokens, não de US$ |
  | Observation masking: metade do custo do agente cru, solve rate igual ou maior que resumo LLM (arXiv 2508.21433) | arxiv.org/abs/2508.21433 | sem compactação nem cache no baseline |
  | **Compressão de saída de ferramenta no Claude Code: −38,4% de tokens, +6,8% de custo faturado; r = 0,15 entre tokens e custo; muda a trajetória (mais turnos) e piorou patches no SWE-bench Go** | arxiv.org/abs/2607.12161 (lido no abstract) | gate do passo 4 mede US$ com cache, não tokens; o passo 6 compara custo por sucesso |
  | Tool-result clearing é "a forma mais leve e segura de compactação"; degradação é gradiente, não penhasco | anthropic.com/research/effective-context-engineering-for-ai-agents | apoia compactação/limpeza, sem número |
  | Context Rot: desempenho cai com o tamanho da entrada em 18 modelos (Claude 4 incluso) | trychroma.com/research/context-rot | qualitativo; nenhum número 150-400K para Claude 5.x verificado |
  | Tool Search: Opus 4 49→74%, Opus 4.5 79,5→88,1%; −85% de tokens com 58 ferramentas (interno, Anthropic) | anthropic.com/engineering/advanced-tool-use | o pi já usa `tool_search` para MCP |
  | RAG-MCP: todas as ferramentas no prompt 13,6% vs 43,1% com recuperação (preprint, uma tarefa) | arxiv.org/pdf/2505.03275v1 | sinal de que catálogo grande custa acerto; é sobre schemas, não skills |
  | Claude Code: lista de skills limitada a 1% da janela; corta descrições das menos invocadas; `disable-model-invocation` tira a descrição do contexto | code.claude.com/docs/en/skills | o pi não tem orçamento; o corte manual do passo 7 é o equivalente |
  | Opus/Sonnet 5.5: leitura de cache **0,05×**, escrita 5 min 1,25×, 1h 2× (Opus 5.5: $4 / $5 / $8 / $0,20) | platform.claude.com/docs/en/build-with-claude/prompt-caching | confirma o empate do cache 1h (1h = +60% na escrita) |
  Lacunas: nenhum número de acurácia de Claude 5.x entre 150K e 400K verificado; defaults de context editing só por
  trecho; métodos e modelos do 2607.12161 não lidos no PDF; nenhum benchmark de "número de skills × acerto".
- [DONE:3] Compactação 400K → 250K.
  - Compactação medida (6 eventos): resumo com entrada sem cache de 133-177K e saída de 3,5-5,8K, US$ 0,61-0,80 cada;
    reinício 67-89K regravado a 1,25×. Crescimento por turno: p50 1.120, média 2.994 (n = 2.297).
  - Replay das sessões Opus 5.5 (`/tmp/compact_replay.py`; leitura 0,05×, escrita 5 min 1,25×, resumo = 0,4 × contexto
    a preço cheio + 5K de saída + reinício de 80K), custo de entrada vs 400K: 150K −7,7% (49 compactações), 200K −11,2%
    (29), **250K −9,8% (21)**, 300K −5,7% (16), 400K US$ 139,77 (9). Escolhido 250K: 1,4 ponto do ótimo com 8
    compactações a menos que 200K (cada uma perde detalhe). Economia estimada ≈ US$ 13,7 na janela (≈ 5,8% do total).
  - Aplicado: wrapper `: "${PI_COMPACT_AT:=250000}"`; `scripts/compaction-400k.py` padrão 250000 e corrigido para não
    sobrescrever modelos com janela ≤ limite + 16384 (antes, uma janela de 256K ganharia reserve 6.000 e compactaria
    depois do padrão do pi); 231 overrides (Opus 5.5: reserve 750.000); resto do settings.json idêntico ao backup.
    `compact-at-400k.ts` padrão 250000 (nome histórico mantido); context-economy (`checkpoints.md`, `agent-context.md`,
    `compaction_restart.py`) atualizados; item 2 de `pi-cost-benefit-2026-11-11.md` marcado aplicado.
  - Verificado: `pi -p` com Haiku → `OK`, exit 0. Qualidade após compactação não medida (risco aceito pelo plano).
- [DONE:4] Simulador da limpeza: **reprovado**, então os passos 5 e 6 caem. Por isso o simulador ficou em Python e
  está guardado como evidência em `backups/transfer-2026-11-12/clear_sim.py`; o `policy.ts` compartilhado não foi
  escrito, para não deixar código morto. Modelo: chamadas Opus 5.5, compactação a 250K, resultado de ferramenta =
  chars/2,75, stub de 30 tokens, exclusões do plano. O cache vale até o resultado limpo mais antigo, e tudo depois dele
  é regravado a 1,25×. A compactação acontece depois, porque o contexto fica menor. 85 sessões, 11 acima de 150K
  (US$ 114,58 de entrada).
  | Gatilho | Manter | Mínimo limpo | Δ custo (sessões > 150K) | Eventos |
  |---|---|---|---|---|
  | 80K | 4 | 20K | +5,4% | 62 |
  | 80K | 4 | 40K | −0,7% | 25 |
  | 120K | 8 | 20K | +6,3% | 48 |
  | 150K | 4 | 80K | **−1,9% (melhor)** | 7 |
  | 160K | 8 | 40K | +1,6% | 19 |
  | 200K | 4 | 80K | −0,4% | 6 |
  A grade completa está na saída do script. O melhor caso dá −1,9%, longe da meta de 10%. O modelo ainda ignora o custo
  de trajetória: o agente relê o que foi limpo e faz mais turnos. O arXiv 2607.12161 mediu isso no Claude Code: −38,4%
  de tokens e +6,8% de custo. Causa: com leitura de cache a 0,05×, reenviar resultados antigos custa pouco, e cada
  limpeza regrava o contexto a partir do ponto limpo a 25× o preço de leitura. A compactação a 250K também encurta os
  trechos em que a limpeza poderia render.
- [DONE:5] Não executado. A extensão `context-clearing` não foi criada porque o gate do passo 4 reprovou.
- [DONE:6] Não executado pelo mesmo motivo. Os US$ 2 dessa eval voltam para a reserva.
- [DONE:7] Catálogo de skills: 3 skills passaram a só-usuário, com gate aprovado.
  - Dados de uso em 30 dias: Claude (`~/.claude/telemetry/tool-use.jsonl{,.1}`, `tool == Skill`, 89 skills usadas) e
    pi (`read` de `skills/<n>/SKILL.md` nas sessões). 82 skills visíveis no pi, 26 com 0 uso nos dois harnesses.
  - Filtro "ninguém exige" (`rg` no CLAUDE.md, nas rules, nos agentes, nos commands e nas outras skills; a tabela de
    roteamento do `agent-routing` não conta como exigência) e sem caso de roteamento positivo: sobraram
    **mcp-builder, wizard e insecure-defaults**. O `insecure-defaults` continua acessível por `/insecure-defaults-audit`,
    que lê a skill pelo caminho.
  - Ficaram fora: as 7 gsap-* (citadas pela `web-ui-craft`, a `gsap-core` tem 2 casos), `containerization` (4 casos),
    `validate-data` (citada pela `sdd-workflow`), `design-taste-frontend` e `hallmark` (citadas pela `web-ui-craft`; no
    Claude são name-only, mas o pi não tem name-only) e as demais citadas por rules ou agentes. Lição do knowledge vault L298:
    uso zero não autoriza esconder.
  - Aplicado: `disable-model-invocation: true` nas 3, e a linha do `agent-routing` passou a marcá-las como só-usuário.
    Prompt do 1º turno: 48.534 → 47.904 tokens (−630 por turno, na sessão e em todo filho).
  - Gate pareado no Opus 5.5, k=1, mesmo dia: `catalog-pre-20261112T181850` × `catalog-post-20261112T182011`
    (`.keep`), com 5 casos vizinhos e negativos (route-security-01, route-ho3-sec-en, route-ho5-threat-en,
    route-grego-neg-01, route-sota-neg-01). Passaram 4/5 em cada braço, 0 melhores e 0 piores, razão de custo 0,978:
    aprovado (não pior; n pequeno). O `route-ho3-sec-en` falha nos dois braços porque o modelo respondeu direto, sem
    skill nem agente; o defeito é anterior e está fora de escopo. Gasto US$ 3,20 (1,61 + 1,60).
  - Ganho estimado: ~US$ 0,9 por janela de 2 dias, contando leituras no Opus, escritas por sessão e filhos. Pequeno e
    reversível.
- [DONE:8] MCPs.
  - Os números do aviso "Updates" do SessionStart eram do scan de 2026-11-09 e estavam velhos: fetch e
    package-version-check já rodavam 2026.11.4 e 1.2.39, e o computer-use-linux já estava em 0.7.52.
  - Últimas versões estáveis em 2026-11-12 (PyPI/npm): `mcp-server-fetch` 2026.11.11, `package-version-check-mcp`
    1.2.40, `@agent-sh/computer-use-linux` 0.7.53.
  - `mcp-server-fetch` 2026.11.4 → **2026.11.11**: corrige 2 falhas (GHSA-3rxj-6jhw-qfv7, IPv6 site-local tratado como
    público na guarda de SSRF; GHSA-f9hh-cmx9-2f23, robots.txt contornado por `//` e `..`). Notas do release
    modelcontextprotocol/servers v2.4.0; proveniência no PyPI pela publicação confiável `release.yml` do mesmo repo.
  - `package-version-check-mcp` 1.2.39 → **1.2.40**: só dependências (fastmcp 4.1.6, cachetools 8, cosign-installer,
    mise), conforme a comparação de tags no GitHub; proveniência no PyPI pela `ci-cd.yml` do repo.
  - Aplicado: pins em `~/.config/mcp/mcp-gateway.json` (backup em `backups/transfer-2026-11-12/mcp-gateway.json`) e
    `systemctl --user restart mcp-gateway.service`. **O gateway é compartilhado com o Claude Code**, então a correção
    vale para os dois. O restart derrubou por alguns segundos as conexões de fetch, obsidian e paper-search das sessões
    abertas.
  - Verificado: os processos rodam `==2026.11.11` e `==1.2.40`; `fetch(https://example.com)` respondeu;
    `get_latest_package_versions` respondeu; `mcp-smoke.py` deu ok em fetch, obsidian, paper-search, playwright e
    perplexity (inicialização, tools/list e rejeição de Host forjado).
  - Fora de escopo, encontrado: `mcp-smoke.py` falha em "playwright: per-client tab isolation" duas vezes seguidas.
    Esse serviço não foi tocado.
  - `computer-use-linux` fica em 0.7.52. A 0.7.53 saiu há ~5 h (2026-11-12 17:59 UTC) e troca o parser de teclado do
    GNOME (kbvm no lugar de libxkbcommon). Espera de 3 dias antes de adotar uma versão nova que muda input de teclado;
    reavaliar em 2026-11-15.
  - Node 24 → 26 do computer-use-linux: sem mudança. O `computer-use-linux.js` só lança o binário nativo
    (`computer-use-linux-linux-x64`) e o pacote exige `node >=18`, então trocar o runtime não muda o comportamento.
- [DONE:9] Rejeitados e adiados, com os números.
  | Item | Veredito | Números |
  |---|---|---|
  | Cache 1h (`PI_CACHE_RETENTION=long`) | rejeitado | 60 chamadas após pausa de 5-60 min regravaram 6,86M tokens (~US$ 33 que o 1h pouparia); o 1h encarece todas as outras gravações (10,7M) em 60%, +US$ 32. Escrita 1h = 2× contra 1,25× (prompt-caching docs) |
  | Patch de TTL só para o prefixo | **aplicado na rodada 2** (extensão, sem patch) | ver "Fechamento, rodada 2" |
  | Limpeza de resultados de ferramenta (context editing) | rejeitado (passo 4) | melhor caso −1,9% contra a meta de −10%; arXiv 2607.12161: −38,4% de tokens, +6,8% de custo no Claude Code |
  | Esconder as 5 `lsp_*` | rejeitado | o system prompt do harness manda usá-las (regras `lsp_*`); ~0,7K tokens por turno |
  | Regra P1 `pkill -f` do Claude | **aplicado na rodada 2** (negação no `guard.py`) | ver "Fechamento, rodada 2" |
  | Checkpoint antes da compactação (PreCompact) | rejeitado | a nota pós-compactação do dispatcher e a regra "Long tasks" já cobrem |
  | Tirar o catálogo de skills dos filhos | **rejeitado na rodada 2**, medido | ver "Fechamento, rodada 2" |
  | `route_hint.py` | rejeitado (mantido) | dicas seguidas em ~38% sem controle (`pi-hooks-port.md`) |
  | gsap-*, `containerization`, `validate-data`, `design-taste-frontend`, `hallmark` como só-usuário | rejeitado agora | citadas por outra skill ou com caso de roteamento positivo; o pi não tem `name-only` |
- [DONE:10] Fechamento.
  - Checks:
    - `check-instructions.py`: 22 arquivos, 0 problemas, 39.745 B.
    - `check-agents.py`: 53 OK.
    - `structure.py` em `extensions`: 0 achados.
    - `structure.py` em `claude-home`: 6 achados anteriores, nenhum em arquivo deste plano (backup do impeccable,
      scripts do hallmark e do impeccable, `docs/pi-instructions.sources`).
    - Testes do `compaction_restart.py`: 5 passaram.
    - Sintaxe ok: wrapper (`sh -n`), script de compactação (`py_compile`), extensão (import com strip-types →
      `function`).
  - Não rodaram:
    - `node --test` da extensão de limpeza e do simulador TS: não existem, porque o passo 4 reprovou.
    - Qualidade depois da compactação a 250K: medida depois, ao vivo (ver "Fechamento das pendências").
    - Telemetria de uma semana (`pi_telemetry.py cost --since 7`): acompanhamento opcional da economia real, não
      é condição de aceite.
  - knowledge vault: seção anexada em `Resources/Tool-Evaluations/Billion-Context-vs-Auto-Compact-2026-11.md`
    (id `pi-transfer-compaction-clearing-2026-11-12`).
  - Gasto: pesquisa US$ 0,88 + eval do catálogo US$ 3,20 + medições do prefixo com Haiku < US$ 0,02 = **≈ US$ 4,10 de
    10**.
  - Sem entrega git.

## Fechamento das pendências (2026-11-12, meta "terminar tudo sem pendências, gaps ou bugs")
| Pendência | Resolução | Evidência |
|---|---|---|
| Compactação a 250K só verificada na config; retenção não medida | **Verificada ao vivo** | Haiku 5.5 (janela 1M, reserve 750K) leu 18 arquivos de 44 KB. `compaction_start` com reason `threshold`; `compaction_end` com tokensBefore 253.688. O resumo (3.223 chars) manteve os dois fatos plantados no 1º prompt (`ZEBRA-4417`, `orion.toml`). Na sessão continuada (`--continue`), sem ferramentas, a resposta foi "ZEBRA-4417; orion.toml; 18 partes". US$ 0,31 |
| `computer-use-linux` 0.7.53 adiado | **Atualizado** (0.7.52 → 0.7.53) | O PR #460 é fail-closed, com testes golden contra libxkbcommon e nenhuma issue aberta depois do release. O instalador confere sha256 dos 3 binários. `doctor` sem blockers; `windows` 4, `apps` 13. Handshake MCP stdio: serverInfo 0.7.53, 19 ferramentas, `list_windows` sem erro. Reversão: `npm i -g @agent-sh/computer-use-linux@0.7.52` com o npm do Node 24 |
| `mcp-smoke.py`: "playwright per-client tab isolation" FAIL | **Bug real, corrigido** | Causa: o `mcp-playwright.service` (alterado em 2026-10-30 para `--cdp-endpoint`) perdeu o `--isolated` do desenho de 2026-10-23 (`~/.claude/docs/mcp-gateway-centralization-2026-10-23.md` L14). Em `coreBundle.js` (`@playwright/mcp` 0.0.85), sem `isolated` cada cliente recebe `browser.contexts()[0]`. Reproduzido com Chrome ligado: o cliente B tomou a aba do cliente A (os dois listavam só SMOKE-B). Correção: `--isolated` no ExecStart (backup `backups/transfer-2026-11-12/mcp-playwright.service`), seguido de daemon-reload e restart; o smoke completo saiu com exit 0 e "ok playwright: per-client tab isolation". Troca aceita: os contextos isolados não herdam os cookies do perfil `google-chrome-cdp`; o desenho original já era assim |
| Smoke culpava o isolamento quando o Chrome estava desligado | **Corrigido** | `Client.tool` levanta erro quando o resultado é `isError` ou "### Error". Com o Chrome desligado, a mensagem passou a ser "...browser_navigate: Error: ... ECONNREFUSED 127.0.0.1:19222". O Chrome headless que eu subi (`chrome-debug --headless=new`, PIDs 990009/990013) foi encerrado; antes não havia Chrome na 19222 |
| `route-ho3-sec-en` falhava | **Bug de roteamento, corrigido** | Os 4 casos de autorização falhavam (`authz-pre-20261112T…`: 0/4). O modelo investigava sozinho, sem carregar `security-audit`. A descrição da skill ganhou o gatilho "whether a user, caller or anonymous client can read, change or delete data or reach actions they should not (authentication bypass, authorization, IDOR, data exposure), even when asked as a question" (backup `security-audit-SKILL.md`). Resultados em `authz-post-*`: ho-idor, ho3 e ho4 passaram com a v1; ho2-authz-en falhou na v1 e passou com a v2 (`authz-post2-*`). Total 4/4 contra 0/4. Os vizinhos e negativos não mudaram: route-security-01, route-grego-neg-01, route-ho5-threat-en (`threat-modeling`) e o negativo route-ho2-neg-pt ("401 vs 403", sem skill). k=1; ho-idor, ho3 e ho4 não foram rerodados com a v2, que só acrescenta 3 palavras ao gatilho. US$ 3,94 (1,16 + 2,29 + 0,49) |
| Passo 4 do `codegraph` (plano anterior) não seguido | **Revertido** | 0 de 2 execuções o seguiram: o modelo nem carrega a skill para "o que a mudança pode quebrar" (Opus 5.5 em dusk-api, US$ 0,76). Registro em `pi-workflows-review-2026-11-12.md`, seção Correção |
| Números do replay mudaram na revisão (−9,8% → −11,0% a 250K) | Explicado | As sessões novas entraram no replay; 250K continua a 1-1,4 ponto do ótimo (200K) |

Gasto total do plano de transferência: US$ 4,10 + 0,31 + 3,94 + 0,76 = **US$ 9,11 de 10**.

### `structure.py` em `claude-home`: os 6 achados não são código próprio
Nenhum dos 6 achados está em arquivo deste plano, e todos caem nas exclusões da regra (dependência vendorizada,
backup, snapshot):
- `skills/impeccable/scripts/live-browser.js` (13.872 linhas): upstream pbakaus/impeccable 4.8.2 (optional)
  (`pi-skill-adaptation.md` L110).
- `skills/hallmark/scripts/sloplint.mjs` (4.426), `sloplint-render.mjs` (1.283) e o diretório `scripts` com 14 (optional)
  arquivos: upstream nutlope/hallmark @ 52328cb (`~/.claude/docs/design-skills-2026-11-04.md` L15).
- `.backups/impeccable-4.5.0-*/scripts/live-browser.js`: backup da versão anterior.
- `docs/pi-instructions.sources/` (11 arquivos): cópias fiéis das fontes do Claude que o `check-instructions.py`
  usa para detectar divergência (`--diff` e `--accept-sources`). Não são executadas.

## Fechamento, rodada 2 (2026-11-12)
O avaliador do `/goal` apontou riscos que ficaram abertos na rodada 1. Esta rodada fecha cada um e também os três
itens que estavam "adiados".

| Item | Resultado | Evidência |
|---|---|---|
| Sessões com `--isolated` não herdam os logins do perfil CDP | É o comportamento de projeto, não um bug; o procedimento ficou documentado | Teste ao vivo com um servidor local que grava cookie: depois do login, o cliente A vê `COOKIE[sess=abc123]` e o cliente B vê `COOKIE[none]`. A unit diz "an isolated context per client", e a skill manda "Default to an isolated context". `browser-testing-with-devtools/references/playwright-cdp.md` agora explica: faça o login dentro do contexto da própria tarefa, ou use o perfil `bh-chrome` (browser-harness) quando a sessão precisa persistir. Corrigi a versão citada (0.0.83 → 0.0.85) e a linha de comando. |
| A qualidade depois da compactação só tinha sido testada com 2 fatos | Benchmark de compactações encadeadas: **12/12** | Foram 12 fatos de tipos diferentes: codinome, porta, decisão com motivo, caminho, pessoa, proibição, versão, limite, causa de bug, horário, cliente e flag. Plantei os fatos ao longo de 4 rodadas, com leituras de milhares de linhas no meio. Usei limite de 60K e `keepRecentTokens` 8K (via `.pi/settings.json` do projeto, com `--approve`) e o Haiku 5.5 como resumidor. Houve **8 compactações** encadeadas, com tokensBefore entre 61K e 86K. Na 5ª rodada, sem ferramentas, o modelo listou os 12 valores exatos e disse que vinham do resumo. Custo: US$ 0,06. Como o Opus resume melhor que o Haiku, esse resultado é um piso. |
| Bug achado: a rede de segurança `compact-at-400k.ts` não compactava no `pi -p` | **Corrigido** | Reprodução: com `PI_COMPACT_AT=30000`, o contexto de um `pi -p` chegou a 102K sem compactar. O processo termina logo depois do `agent_end`, e o `ctx.compact()` chamado sem await se perde. Pôr o await dentro do `agent_end` trava: o processo ficou parado até o `timeout`, porque a compactação espera o run terminar. A correção usa `agent_settled` (sessão ociosa) com await: a compactação ocorreu (tokensBefore 102.542), o processo saiu com exit 0, e o `-c` seguinte respondeu a partir do resumo. Afeta só modelos fora dos `modelOverrides`. Backups da rodada 2 (guard, testes, extensão, `codegraph`, `playwright-cdp.md`, `papel-aceita-tudo.md`): `backups/transfer-2026-11-12/round2/`. |
| Roteamento de autorização: avaliado com k=1, e 3 casos não tinham rodado na v2 da descrição | **4/4 na v2** | `authz-v2-20261112T185550`: `route-ho-idor`, `route-ho3-sec-en` e `route-ho4-sec-pt` passaram com 1.0, por US$ 0,83. `route-ho2-authz-en` já tinha 1.0 na v2 (`authz-post2`). |
| Eval do catálogo fraca (4/5) | **5/5** | A única falha (`route-ho3-sec-en`) vinha do bug de roteamento de autorização. Ela passa em `authz-v2`, que rodou com as 3 skills já escondidas. |
| `codegraph`: o passo 4 do `impact.js` foi revertido porque nunca era seguido, e a skill não era carregada | Roteamento **corrigido**; passo 4 **rejeitado** | `graph-pre-20261112T185550`: `route-impact-01` teve 1.0 e `route-ho4-graph-en` teve **0.0**. O modelo chamou `codegraph_callers` sem ler a skill e respondeu "None" sem o `codegraph_status`, que a skill exige antes de uma resposta negativa. A descrição ganhou "which functions call or reach X, what a change or commit could break … even when asked as a plain question" e ficou com 413 caracteres. `graph-post-20261112T185920`: `route-ho4-graph-en` passou para **1.0**, e o caso negativo `route-ho4-neg-en` (renomear uma variável, sem Skill) manteve **1.0**. Custo: US$ 0,63 + 0,58. O passo 4 (entregar o impacto ao `test-reviewer` e checar 5 arestas) fica rejeitado. O núcleo do `/impact` (impacto mais checagem com `rg`/LSP) já está nos passos da skill, e a delegação acrescenta um run Sonnet por pergunta sem ganho medido. |
| P1 `pkill -f` (estava adiado) | **Aplicado** como negação no `guard.py` | Reproduzido ao vivo nesta sessão: um `pgrep -f` com saída para `xargs kill` matou o próprio shell (exit 143). Pelo TDD, `test_guard.TestSelfKill` deu 6 falhas antes da regra e passou depois, e o mutante `matches_self → False` foi pego com 6 falhas. Ao vivo, o guard bloqueou `pkill -f zz-nonexistent-proc-zz` com a mensagem, e a forma com colchete rodou. Na eval `pkill-guard-20261112T190815`, `cap-pkill-selfmatch-01` passou com **1.0** (US$ 0,29); o modelo usou um padrão ancorado com colchete, que o guard deixou passar. Depois apareceu um falso positivo: texto citado num heredoc foi bloqueado ao gerar este registro. Foi corrigido com `mask_text`, que ignora heredoc não executado por shell e o conteúdo entre aspas. Isso ganhou 5 casos de teste e 2 mutantes pegos (detalhes em `docs/pi-hooks-port.md`). |
| TTL de 1h só no prefixo (estava adiado porque "exige patch") | **Aplicado** como extensão, sem patch | O hook `before_provider_request` reescreve o payload, então não há patch para manter. `extensions/prefix-cache-1h/index.ts` põe `ttl: 1h` nos marcadores de tools e system. Só age na sessão interativa principal: fica fora do `pi -p` e dos subagentes, cujo prefixo raramente é reusado depois de 5 min e pagaria 2×. O replay (`/tmp/ttl_prefix_sim.py`) cobriu 2.533 chamadas Opus 5.5 em 1,9 dias, contando o reuso entre sessões do mesmo cwd. A economia é de US$ 9,90 em 60 retomadas de 5 a 60 min, menos US$ 1,25 de 18 gravações a 2×: **US$ 8,66 líquidos, 5,1% do custo de cache, ≈ US$ 4,45/dia**. No A/B ao vivo (Haiku 5.5, pausa de 330 s, message threads ligadas), com 1h a 2ª chamada teve cacheRead 34.655 e cacheWrite 413; sem 1h, cacheRead 0 e cacheWrite 35.394. O custo total foi US$ 0,00741 contra 0,00888. Testes em `bin/tests/prefix-cache-1h.test.ts`: os 3 passam, e os mutantes "marcar mensagens" e "ligar nos filhos" foram pegos. Para reverter: `PI_PREFIX_CACHE_1H=0` ou apagar o diretório. |
| Catálogo de skills nos filhos (estava adiado para "medir no pi antes") | **Rejeitado**, com medição | Em 154 runs de filhos, só 4 leram uma `SKILL.md` (2 do general-purpose e 2 do swarm-worker); nenhum dos 87 runs de leitores leu. Desde que os modelos foram fixados, houve 25 runs de leitores com Sonnet/Haiku 5.5 (US$ 5,06). O catálogo, de ~10,7K tokens, custou ≈ US$ 0,69 nesses runs (13,7%), ≈ US$ 0,35/dia. Os writers precisam do catálogo. Nos leitores, o desenho do Claude dá o Skill a todos de propósito (`~/.claude/agents`, `tools: … Skill`), e tirar o catálogo exigiria uma eval pareada da qualidade dos revisores, que o teto não cobre. Pela regra da casa (sem evidência pareada, não adota), fica rejeitado. |

Gasto da rodada 2 no plano de transferência: US$ 0,83 (authz-v2) + 0,29 (pkill) + ≈ 0,15 (Haiku: benchmark, A/B
de TTL e reproduções). O plano fecha em **≈ US$ 9,62 de 10**. Os testes do `codegraph` (US$ 0,76 da rodada 1, mais
0,63 e 0,58) pertencem ao plano de workflows (`/impact`), que fecha em **US$ 5,01 de 5**. O estouro de US$ 0,01 vem
do teto do runner, que só é conferido depois de cada caso. Os dois planos somam US$ 14,63 de 15.
