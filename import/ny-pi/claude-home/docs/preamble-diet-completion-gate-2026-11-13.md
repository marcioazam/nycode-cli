# Dieta do preâmbulo + gate de conclusão (2026-11-13)

Origem: `docs/research/2026-11-13-pi-harness-sota-nov.md` (itens 1 e 2). Aprovado pelo usuário em 2026-11-13
("faça isso"), com o A/B estimado em US$ 20, que vale como teto.

## Objetivo
1. Cortar o preâmbulo fixo: 37.351 tokens de `cacheRead` na 1ª requisição da sessão principal. Componentes:
   CLAUDE.md + rules 41,6 KB, catálogo de 79 skills ~40 KB, roster de 54 agentes ~12,7 KB.
2. Gate de conclusão: se houve edição de código sem checagem depois, bloquear o encerramento uma vez por turno.

## Aceitação (regra v3, `~/.claude/evals/README.md`)
- Mesmos 12 casos de outcome de `harness-sota-audit-2026-11-12.md`, k2, `claude-opus-5-5`, pi 1.5.2 e pi-code
  1.7.0 fixados nos dois braços; OFF (harness atual) e depois ON (dieta + gate), em sequência.
- ON sem verdict `worse` em run pass; razão de custo mediana ON/OFF ≤ 1,20 (esperado < 1); cada flip pass→fail
  explicado; tokens fixos da 1ª requisição menores.
- Nenhuma regra obrigatória enfraquecida: o que sai do carregamento fixo vira on-demand com gatilho explícito
  sempre carregado, ou já existe na skill dona.
- Checagens do harness verdes: check-instructions, check-agents, testes de hooks, teste da extensão, structure.

## Custo esperado e o que compra
- Custo: A/B ≈ US$ 18,5 (≈ 9,2 por braço). Por execução: o gate é 1 handler em processo e O(n) sobre o ramo
  no fim do turno, sem LLM; custa 1 turno extra só quando bloqueia.
- O que compra: −20 a −30% de tokens fixos por requisição, também nos subagentes, e por isso menos TTFT. O gate
  ataca a falha de "concluir sem verificar" (evidência: gate 1→11 de 12; LangChain +13,7 pp).

## Plano
1. [DONE:1] Backup `backups/preamble-diet-2026-11-13/before.tgz`; pins conferidos.
2. Braço OFF em segundo plano (harness intocado).
3. Staging em `/tmp/preamble-stage/`: rules on-demand, dedupe do CLAUDE.md, descrições de skills e agentes, gate.
4. Ao fim do OFF: aplicar o staging, rodar as checagens e o smoke do gate, depois o braço ON.
5. Decisão por regra v3; em caso de reprovação, rollback com `tar xzf before.tgz` + remoção da extensão.

## Rollback
`cd ~/.pi/agent/claude-home && tar xzf backups/preamble-diet-2026-11-13/before.tgz` e
`rm ~/.pi/agent/extensions/completion-gate.ts`; `rules-ref/` pode ficar (não é carregado).

## O que mudou
- `rules/{research-and-tools,docs-and-knowledge,harness-economy}.md` → `rules-ref/` (sob demanda). Gatilho
  sempre carregado em CLAUDE.md, Evidence and tools; referências atualizadas no CLAUDE.md, `hooks/dispatch/` (nota +
  teste), `agent-routing`, `agent-systems`, `agent-systems-auditor`, `bin/telemetry/pi_telemetry.py`, `safety.md` e
  `check-instructions.py` (valida `rules-ref/` como "ondemand", fora da conta do carregamento fixo).
- Descrições: 60/79 skills visíveis ≤ 250 chars (74.945 → ~15,8 KB) e 52/54 agentes ≤ 140 chars (16.945 → 6.169 B).
- `~/.pi/agent/extensions/completion-gate.ts` + `bin/tests/gates/completion-gate.test.ts` (11 testes).
- CLAUDE.md + rules carregados sempre: 39.761 → 26.310 B (check-instructions).

## Checkpoint
- 15:05 backup; OFF lançado (`diet-off-20261113T150341`).
- OFF parou em 14 runs (14/14 PASS, US$ 5,75): a sessão pi-lite paralela editou `skills/plan-workflow` (skill oculta)
  e o run.py acusou drift. Base = OFF k1 completo (12 casos) + 2 repetições, mais o histórico P1 de 2026-11-12 (22/22).
- Staging aplicado; checagens: instructions 0 problemas, agents OK (54), hooks OK, completion-gate 11/11,
  plan-gate 13/13, no-context-files 3/3, structure extensions 0 achados.
- Smoke ao vivo (Haiku, `pi -p`): editou `m.py` sem checar; o gate disparou e o modelo declarou a verificação adiada.
- ON lançado (k2, teto 11, total ≤ US$ 20).

## Resultado (`diet-on-20261113T151109` vs `diet-off-20261113T150341`, claude-opus-5-5, pi 1.5.2, pi-code 1.7.0)
| métrica | OFF | ON |
|---|---|---|
| run pass | 14/14 (12 casos; histórico P1 2026-11-12: 22/22) | 22/22 (12 casos; 2 casos têm execução única nos dois braços) |
| tokens do prompt na 1ª requisição (mediana) | 47.965 | 36.965 (−23%) |
| custo mediano por caso, razão ON/OFF | — | 0,83 (0,66–1,08; n = 12) |
| gate disparou | — | 4 runs (out-lsp-tf-syntax ×2, out-lsp-proto-dup ×2) |

- Nenhum flip pass→fail. Com o gate, o tf-syntax trocou o contador de chaves e o LSP sem servidor ("no diagnostics
  recorded") por um parser HCL real (`uv run --with python-hcl2`): verificação melhor, ~+10 s, custo igual
  (0,25 vs 0,24).
- Gasto: US$ 5,75 (OFF) + 7,33 (ON) = US$ 13,08 de US$ 20.
- Limites: n pequeno (MDE ≈ 25 pp, então o pass só prova que não houve regressão grande); OFF é k1 em 10 casos; os
  casos de outcome não exercitam busca web nem roteamento de knowledge vault, que agora dependem do gatilho de `rules-ref/`.
  Os 30 tokens da nota `Graph:` e a skill `plan-workflow` (sessão paralela) são iguais nos dois braços.

## Revisão (plan-reviewer: complete, 3 lacunas menores corrigidas depois do A/B)
- O `CHECK` agora é ancorado por segmento de comando, atrás de wrappers (`uv run`, `python3 -m`, `npx`, `timeout`,
  env), via `isCheckCommand`. Antes, `rg pytest` ou `cat eslint.config.js` contavam como checagem.
- `node --experimental-strip-types --test` passou a contar como checagem.
- Limite documentado: o sucesso vem do `isError`, então `cmd | tail` e um `gate-runner` vermelho contam como checagem.
- Testes: 13/13. O braço ON rodou com o regex anterior (mais permissivo); a mudança só tira falsos "passou".

## Follow-up (2026-11-13, aprovado: itens 1–3)
### 1. Routing nos casos de risco (`diet-route-20261113T152936`, k1, Opus 5.5)
Foram escolhidos 16 casos de busca web, knowledge vault e skills com descrição encurtada. A rodada parou em 12 por drift: a
sessão paralela editou `eval:cases/outcome.jsonl`. Resultado: 9 PASS, 3 FAIL.
- `route-research-01`: artefato de nota. O agente leu `rules-ref/research-and-tools.md` e o SKILL.md do
  `perplexity-urls` por `bash sed`, não por `read`, então o shim não registrou Skill. Em comportamento cumpriu:
  Perplexity + Keenable + fonte primária. Isso também mostra que o gatilho de `rules-ref/` funciona.
- `route-news-01` (esperava ferramenta de notícias Brave/Octen) e `route-fastapi-01` (esperava `engineering-standards`):
  falham igual no braço OFF. O OFF foi feito com o harness anterior via `PELO_PI_BIN` → cópia do wrapper com
  `CLAUDE_CONFIG_DIR` num snapshot (`before.tgz`) e `PI_COMPLETION_GATE=0`; payload 133,5 KB contra 101,7 KB no ON.
  Rodadas: `diet-route-off-20261113T153608` (k1, parou por drift `plugins:installed`) e `diet-route-on2-20261113T153703`
  (segunda repetição ON): ambos FAIL nos dois braços, então são falhas pré-existentes, não da dieta.
- Gasto: US$ 3,79 + 0,80 + 0,54 = 5,13. Total da tarefa: US$ 18,21 de US$ 20.

### 2. Composição dos 36.694 tokens da 1ª requisição (payload capturado em `before_provider_request`, 2,77 B/token)
| parte | bytes | ~tokens |
|---|---|---|
| catálogo de skills (80 visíveis; ~60 B/skill só de `<location>`) | 30.530 | 11.000 |
| CLAUDE.md + safety.md | ~26.500 | 9.600 |
| ferramentas (20) | 24.370 | 8.800 |
|   AskAntigravity (177 chamadas no histórico; fica) | 5.306 | 1.900 |
|   `mcp__keenable__search_web_pages` (direta) | 4.679 | 1.700 |
|   subagent + question | 4.892 | 1.800 |
| roster de agentes (54) | 7.798 | 2.800 |
| ponytail (A/B: poupa mais do que custa) | ~5.000 | 1.800 |
| base do pi (tools/rules/docs/mcp_servers) | ~4.700 | 1.700 |
- Alavancas restantes, que precisam de aprovação e de A/B de routing:
  - 41 das 80 skills visíveis tiveram ≤ 2 usos em ~2 meses (15,4 KB ≈ 5,5k tokens). Opção: ocultar as de uso nulo e
    agrupar famílias, como as 8 `gsap-*` (2,8 KB) atrás de uma entrada. Isso exige mudar a regra "skill oculta só
    por `/skill:`".
  - Keenable diferida: ~1,7k tokens por requisição, em troca de um `tool_search` nas sessões com busca.
  - O roster não tem flag de ocultação no pi-code (`subagent/agents.ts`); egm-*/impeccable-* só sairiam com patch.
- Piso realista com o desenho atual: ~30k tokens (−18%).

### 3. `prefix-cache-1h` e `cache-warm-identity` contra o `cacheWarming` nativo
Não são redundantes; ficam.
- `cache-warm-identity` é o que faz o aquecimento nativo funcionar: sem ele, toda sessão com hook de contexto perde o
  aquecimento (issue upstream #10956 aberta; `latest` no npm = 1.5.2 em 2026-11-13).
- `prefix-cache-1h` cobre o que o nativo não cobre:
  - pausas de 30–60 min (o nativo para em 30 min);
  - contextos pequenos, em que o nativo decide não aquecer (ganho esperado < US$ 0,05);
  - reinício do processo (`pi -c`).
- Conta em Opus 5.5 com o prefixo de 37k: +US$ 0,11 por sessão na gravação 1h; cada pausa de 5–60 min evitada
  economiza ~US$ 0,18.
- A remedição marcada para 2026-11-15 em `pi-memory-cache-sota-2026-11-13.md` (passo 6) decide com dados reais.

### 4. Antigravity só com Google e Keenable sob demanda (pedido do usuário, 2026-11-13)
- `~/.pi/agent/extensions/google-only-agy/index.ts`: fora de modelo Google (provider `antigravity`/`google*` ou id (optional)
  `google/`/`gemini`), tira `AskAntigravity`, `antigravity` e `agy_*` do conjunto ativo em `session_start` e
  `model_select`; com Google, devolve. O provider continua registrado, para o `/model` achar o Gemini.
  `PI_AGY_TOOLS=always` volta ao antigo. Testes: `bin/tests/gates/google-only-agy.test.ts` (3/3).
- `mcp.json`: Keenable sem `toolExposure` (todo diferido). O texto "Keenable é direta" saiu do CLAUDE.md,
  `providers.md`, `evidence-research`, `research-scout`, `soteiros-auditor`, `claim-verifier`, `web-scout` e do
  comentário do wrapper. Backups em `backups/preamble-diet-2026-11-13/*.pre-keenable` e `mcp.json.before`.
- Medido (1ª requisição, `pi -p`, Haiku): 36.694 → 32.740 tokens (−10,8%); payload 101,7 → 90,9 KB.
  Ferramentas ativas: Claude sem nenhuma agy; `antigravity/claude-opus-4-6-thinking-cli` com `AskAntigravity` e
  `antigravity`; `PI_AGY_TOOLS=always` com as duas.
- Smoke Keenable (Haiku): `tool_search`, depois `search_web_pages`, depois `fetch_page_content`; tudo OK.
- Checagens: instructions 0 problemas, agents OK (54).
- Efeito colateral aceito: "ask gemini" numa sessão Claude não tem mais a ferramenta; é preciso trocar para um modelo
  Google ou usar `PI_AGY_TOOLS=always`.
- Rollback: apagar a extensão; `cp backups/preamble-diet-2026-11-13/mcp.json.before ~/.pi/agent/mcp.json`; restaurar
  os `*.pre-keenable`.

### 5. Hubs de skills (recomendação "versão segura", aprovada pelo usuário em 2026-11-13)
- `gsap-core` virou hub das 7 `gsap-*`, e `emil-design-eng` virou hub de `review-animations` e `improve-animations`. As
  irmãs têm `disable-model-invocation: true`; o hub lista o caminho de cada uma. Script idempotente:
  `backups/skill-hubs-2026-11-13/apply.py`.
- CLAUDE.md: uma skill oculta roda por `/skill:` ou quando uma skill visível, o brief de um agente ou uma regra
  seguida nomeia o SKILL.md (`ux-reviewer` já nomeia o caminho de `review-animations`).
- `to-issues` e `ripple-hunt` ficaram visíveis: o caso `route-ripple-pt` espera a escolha automática de `ripple-hunt`,
  e esconder as duas renderia só ~70 tokens.
- Medido: 1ª requisição 32.740 → 31.418 tokens (−1,3k); payload 90,9 → 87,7 KB. Catálogo visível: 80 → 71.
- A/B de roteamento (opus-5-5, k1 por limite de orçamento; diagnóstico, não poder estatístico):
  `hub-off-20261113T154725` 3/3 (US$ 1,92) e `hub-on-20261113T155001` 3/3 (US$ 2,23). Mediana da razão de custo ON/OFF:
  1,12 (0,53–2,55). Em `route-motion-01`, o modelo leu `gsap-core` e depois o `gsap-scrolltrigger` apontado por ele
  (por `sed`), então o hub roteou. Em `route-anim-review-01`, leu `emil-design-eng` e depois `review-animations`.
- Rollback: `tar xzf backups/skill-hubs-2026-11-13/before.tgz` em `claude-home`.

### 6. Duas falhas de roteamento antigas (pedido do usuário, 2026-11-13)
- `route-news-01`: o modelo seguia Perplexity + Keenable e ignorava a linha `news` de `providers.md`. Conserto no
  ponto da decisão, as descrições do `mcp.json` (seção `mcp_servers` do prompt). Keenable diz "Notícias: use
  brave_news_search ou octen news_search"; brave-search ganhou descrição própria (notícias com freshness).
- `route-fastapi-01`: implementava Python sem ler `engineering-standards`. A descrição agora começa com "Read before
  writing, changing, testing or reviewing code (...)" e tem 219 caracteres.
- Validação (opus-5-5): `route-fix-20261113T155740` mais `route-fix2-...` deram 4/4 PASS (antes: 0/6 em 3 rodadas, com
  o harness antigo e com o novo). Custo por execução: fastapi 0,33/0,30 (antes 2,47/0,39/0,54); news 0,79/1,27 (antes
  1,49/0,80/0,26). Mediana sem aumento.
- Custo fixo: cerca de +60 bytes de prompt. Custo variável: leitura de ~3 KB do SKILL.md em tarefas de código.
- Rollback: `backups/preamble-diet-2026-11-13/mcp.json.pre-routing` e `engineering-standards.SKILL.md.pre-routing`.

## Decisão
Adotado (regra v3: pass não pior, custo 0,83 ≤ 1,20). Fica como está; o rollback está acima. Próximo sinal a medir:
as suítes routing e search, sobre o gatilho de `rules-ref/` e as descrições encurtadas, quando houver teto.
