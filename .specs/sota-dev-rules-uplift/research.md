# Research Summary: o que agregar às regras SOTA-2026 de desenvolvimento

**Date:** 2026-08-17 | **Passes:** 5 | **Confidence:** 83%

**Decisão que esta pesquisa fecha:** o que *ainda* dá para exigir de IA e humano neste repositório, de forma instrumentada, sem subir piso de cobertura e sem repetir o conflito do `GATE-16`.

**Critérios:** (1) enforceável (lint, CI, ratchet ou obrigação de teste, não slogan); (2) ainda sem instrumento no `AGENTS.md` / `ci-local.sh`; (3) não briga com hook+squash nem com NFR-8; (4) ataca um modo de falha medido 2025–2026 de código escrito por modelo, **ou** a superfície de confiança do próprio NyCode como agente; (5) custo justificável com um maintainer só.

**Assunção:** permanece L2. Não é L3 (Scorecard ≥ 7 como gate bloqueante).

---

## Já está na barra — não é o próximo alavanca

O ROADMAP (seção "Pendências da adoção do SOTA-2026") declara que **todo gate do padrão já tem instrumento ou waiver formal**. Cobertura 95/90, diff 80%, mutation no diff, duplicação 5%, teto de PR de agente, secrets, idade de dependência, fronteira de crates, perf contra concorrente nomeado, `Assisted-by:` / proibição de `Co-Authored-By` / proibição de sign-off de máquina, `test_map`, `cargo deny`, pin de action, `CODEOWNERS` — isso já é L2. Subir o 95% não muda o modo de falha que a evidência externa aponta.

O próximo salto não é um número maior. É pegar o que cobertura **não vê**.

---

## Key Findings

1. **IA amplifica o sistema que já existe; estabilidade de entrega ainda piora sem control system.** DORA 2025: relação positiva com throughput e desempenho de produto, **relação negativa persistente com estabilidade de entrega**; 90% usam IA no trabalho; 30% têm pouca ou nenhuma confiança no código gerado. Sem teste automatizado, versionamento maduro e feedback rápido, volume vira instabilidade. — Source: [DORA announce 2025-09-23](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report) | As-of: 2025-09-23 | Independent sources: 1 (mesmo programa; `dora.dev` é o hub) | Confidence: H | Impact: crit

2. **Os sinais estruturais de maintainability estão piorando no mesmo período em que o volume de IA sobe.** GitClear 2026 (623 milhões de mudanças, 2023–2026): calls cross-file −35%; moves de refactor −70%; manutenção de legado −74% vs 2022; copy/paste +41%; blocos duplicados +81% (40,3 → 73,0 por milhão de linhas); error-masking +47%; churn de duas semanas +15%. As cinco ações que o próprio relatório pede: orçamento de refactor, tripwire de bloco duplicado, review explícita de error-masking, coaching onde o julgamento é fino, medir estrutura e não volume. — Source: [GitClear Maintainability Gap](https://www.gitclear.com/the_ai_code_quality_maintainability_gap) | As-of: 2026 (YTD no texto) | Independent sources: 1 (LeadDev republica o mesmo dataset) | Confidence: H | Impact: crit

3. **Error-masking é o gap de qualidade #1 que este repo ainda não fecha com um instrumento próprio.** Cobertura e mutation não punem `let _ =`, `.ok()`, `unwrap_or_default()` em `Result`, nem `match Err(_) => {}` vazio: a linha *roda*. O produto, por NFR-4, já proíbe degradar em silêncio — falta o lint/CI que impeça o modelo de *escrever* o silêncio. — Source: GitClear (finding 2) + `AGENTS.md` NFR-4 | As-of: 2026 | Independent sources: 2 (telemetria de commit ≠ regra de produto) | Confidence: H | Impact: crit

4. **Alucinação de pacote continua economicamente viável na fronteira 2026; o gate de idade (SP-04) já é a defesa certa, não precisa de outro piso.** Spracklen et al., USENIX Security '25: 5,2% comercial / 21,7% open-source; 205.474 nomes únicos. Churilov (arXiv:2605.17062, replicação maio–ago 2026): na coorte frontier a faixa comprime para 4,62–6,10%, mas **127 nomes são inventados pelos cinco modelos ao mesmo tempo**. SP-04 + `cargo deny` + `AI-11` já atacam isso. O aditivo é exigir, no PR que mexe `Cargo.toml`, o link crates.io + justificativa — metadado, não scanner novo. — Source: [arxiv:2406.10279v3](https://arxiv.org/html/2406.10279v3), [USENIX PDF](https://www.usenix.org/system/files/usenixsecurity25-spracklen.pdf), [arxiv:2605.17062](https://arxiv.org/abs/2605.17062) | As-of: 2025 / 2026-08-09 | Independent sources: 2 (coortes diferentes) | Confidence: H | Impact: high

5. **O produto *é* um agente: ASI01–ASI10 e MCP01–MCP10 aplicam ao NyCode, não só ao fluxo de PR.** Goal hijack, tool misuse, privilege abuse, supply chain agentic, RCE inesperado, memory/context poisoning, falha em cascata, exploração da confiança humano-agente. MCP: tool poisoning (rug pull / schema poisoning / shadowing), command injection, shadow servers, context over-sharing. Mitigações enforceáveis: pin de schema de ferramenta por hash; fixture adversarial (conteúdo de arquivo não vira instrução); `Command::new` + args, nunca `sh -c` com input; fail-closed se a classificação de risco/aprovação falhar. — Source: [OWASP Agentic Top 10 landing](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/), [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/), [OWASP Agent Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) | As-of: 2025-12 / 2025 | Independent sources: 2 (GenAI project ≠ MCP project) | Confidence: H | Impact: crit

6. **O padrão L2 ainda lista instrumentos que este repo não tem, e nenhum deles é cobertura.** `GATE-14` (waiver expirado = falha) — ADR-0033 expira 2027-02-14 e hoje ninguém falha o CI se a data passar. `CI-07` pede classificar mutante equivalente com razão gravada; o gate daqui é “zero sobrevivente”, o que é mais duro, mas sem o log o modelo “equivale” à mão. `ADV-05` (teste com uma asserção trivial) é o pré-filtro barato da mutation. `CI-14` (flake com dono e prazo, sem retry silencioso). `AI-14` (métrica partida por origem humano vs agente) — o trailer `Assisted-by:` já torna isso barato. `GATE-10` (0 HIGH/CRITICAL no artefato, com exploitability statement) — confirmar se o job `docker`/release já faz isso. — Source: `GATES.md` / `04-ci-and-gates.md` / `10-ai-guardrails-and-dx.md` (padrão local) | As-of: SOTA-2026 v1.1.0 | Independent sources: 1 (é o próprio padrão adotado) | Confidence: H | Impact: high

7. **Property-based testing é o instrumento certo para parser, codec e path — não um piso novo de cobertura.** Round-trip + invariante em `proptest` roda no `cargo test` já existente; fuzz coverage-guided é complementar (bytes vs estrutura). No NyCode: transporte JSON, parser de instrução, contenção de caminho, schema MCP. Kani/TLA no crate inteiro é keep-out (custo). — Source: prática 2026 em codecs Rust (proptest no `cargo test`); não é MUST do `GATES.md` | As-of: 2026 | Independent sources: n (prática, não lei) | Confidence: M | Impact: high

8. **`GATE-17` como “required review” do GitHub, com maintainer único, é teatro.** `CODEOWNERS` já lista auth, workflows, `deny.toml`, ADRs — todos `@marcioazam`. ADR-0034 recusou aprovação humana obrigatória por ser auto-aprovação. O aditivo honesto: job de review *lente* (security + intent-vs-impl) nos caminhos críticos, relatório no PR, sem fingir segundo humano. — Source: `.github/CODEOWNERS`, ADR-0034, `AI-02`/`GATE-17` | As-of: 2026-08 | Independent sources: 1 | Confidence: H | Impact: med

9. **Scorecard (`GATE-18`) é L3.** Rodar como sinal consultivo (fuzzing, signed-releases, SAST) pode ser útil; bloquear merge em ≥ 7 puxa o repo para conformidade que o ADR-0032 não declarou. — Source: [OpenSSF Scorecard](https://github.com/ossf/scorecard), `GATES.md` GATE-18 | As-of: 2026 | Independent sources: 2 | Confidence: H | Impact: low

---

## Disagreements

- **DORA 59% “IA melhorou qualidade de código” vs GitClear “duplicação +81% / error-masking +47%”.** Não média. DORA é survey (~5.000 profissionais, autodeclaração). GitClear é telemetria de operação de commit (623M mudanças). Confiar no DORA para *estabilidade de entrega e control systems*; no GitClear para *o que o diff parece*. Os dois pedem a mesma coisa: não afrouxar teste/CI, e tripwire no que cobertura não vê.

- **Spracklen 5–22% vs Churilov 4,62–6,10% vs papers que reportam near-zero em BigCodeBench.** Coortes e prompts diferentes. A conclusão operacional é a mesma: taxa média pode cair; a cauda e o conjunto *universal* de nomes (127) continuam. Este repo já falha fechado em dependência nova — manter, não relaxar SP-04.

- **Ciclomática ≤ 10 do padrão vs ≤ 15 daqui.** O padrão é mais rígido; `keys.rs::translate` (cognitiva 3 / ciclomática 25) mostra por que 10 fatiaria dispatcher achatado. Não adotar 10. Error-masking e property test rendem mais.

---

## Open Questions

- O job de container/release já falha em CVE HIGH/CRITICAL (`GATE-10`)? Impact: high — se não, é o L2 que falta; se sim, não duplicar.
- Há `proptest` / fuzz em transporte, path e MCP hoje, ou só exemplos? Impact: high
- Mutantes equivalentes já são gravados em algum relatório, ou só “zero sobrevivente”? Impact: med
- Segundo maintainer: só então `GATE-17` deixa de ser auto-aprovação. Impact: med (não desbloqueia a onda 1)

---

## O que agregar — ranked, só instrumento

Dois trilhos. O A força quem *escreve* o repo (IA e humano). O B força o *produto-agente*.

### Trilho A — qualidade do diff (como o código entra)

| # | Instrumento | Por quê agora | Como falha fechado | Não fazer |
|---|---|---|---|---|
| A1 | **Lint de error-masking** (clippy + deny-list) | GitClear +47%; NFR-4 já pede, o compilador não pega | `let _ =` em `Result`, `.ok()`, `unwrap_or_default()` em erro, `match Err(_) => {}` vazio em `crates/*/src` sem anotation `// mascarado-porque:` | Banir todo `unwrap_or` (falso positivo em Option) |
| A2 | **`ADV-05` detector de teste vaidade** | Mutation é cara; assert trivial passa cobertura | Teste novo com 1 assert tautológico (`assert!(true)`, snapshot-only, só mock) falha o gate de teste | Bloquear tabela parametrizada curta |
| A3 | **`GATE-14` scanner de waiver** | ADR-0033 tem data; sem job a expiração é prosa | CI lê ADRs de waiver e falha se `expira` < hoje | Reabrir `GATE-16` |
| A4 | **Log `CI-07` de mutante equivalente** | Completa o GATE-04 que já existe | Sobrevivente só passa com `EQUIV: <issue>` e razão; senão é gap de teste | Aceitar “equivalent” por arquivo |
| A5 | **`CI-14` quarentena de flake com prazo** | Retry silencioso esconde race que o agente introduz | Allowlist com owner + data; `sleep` em teste exige anotação | Retry automático no CI |
| A6 | **`AI-14` métrica partida por origem** | Trailer `Assisted-by:` já existe; DORA/AI-15 proíbem volume como produtividade | Relatório (não gate) de churn/duplicação/escape por origem no CI | Leaderboard de linhas geradas |
| A7 | **Metadado de dependência nova no PR** | SP-04 já existe; o furo é justificativa humana | Diff de `Cargo.toml` exige link crates.io + uma frase no body | Scanner extra além de deny + idade |

### Trilho B — o NyCode *é* o agente (assertividade do produto)

| # | Instrumento | IDs | Como falha fechado |
|---|---|---|---|
| B1 | **Fixtures adversariais ASI01/ASI02**: conteúdo de arquivo/MCP/página não substitui instrução de sistema; ferramenta ilegítima é negada mesmo se o modelo pede com confiança | ASI01, ASI02, MCP06 | Testes golden no harness; regressão = CI vermelho |
| B2 | **Pin de schema de ferramenta MCP** (hash canônico nome+descrição+input schema); mismatch = fail-closed | MCP03, ASI04 | Hash versionado; mudança só com diff de PR |
| B3 | **Execução de processo: argv, cwd, env allowlist, timeout; nunca `sh -c` com input** | MCP05, ASI05, LLM06 Excessive Agency | Lint + teste de payload `; rm` tratado como dado |
| B4 | **`proptest` obrigatório nos módulos de confiança**: wire JSON, contenção de caminho, parser de instrução | prática, não GATE-id | Presença de propriedade round-trip/invariante nesses paths; não um % |
| B5 | **Aprovação de ação destrutiva *bound* ao parâmetro** (não um “OK” genérico) | ASI09, cheat sheet HITL | Teste: aprovação de `rm X` não autoriza `rm Y` |
| B6 | **Redação de transcript/log** (token, `Authorization`, cookie) | MCP01, MCP08 | Teste de redação + grep de log cru de segredo |

### Keep-out (parece qualidade, piora o sistema)

- Subir 95/90 de cobertura, ou mutation full-tree.
- Reabrir `GATE-16` sem mudar hook ou squash (ADR-0033).
- `GATE-17` como required-review do GitHub enquanto o owner é uma pessoa.
- `GATE-18` bloqueante (L3). Scorecard consultivo, se quiser.
- Ciclomática 10; layout mais duro que 7.
- Pacote de 20–40 skills genéricas no produto (catálogo confundível; o NyCode injeta nome+descrição de skill em toda sessão).
- Kani/TLA no workspace inteiro.

---

## Sources

- https://www.gitclear.com/the_ai_code_quality_maintainability_gap — type: maintainer research | as-of: 2026 | curl: 200
- https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era — type: community (republica GitClear; **não independente**) | as-of: 2026-07-07 | curl: 200
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report — type: official-doc | as-of: 2025-09-23 | curl: 200
- https://dora.dev/dora-report-2025/ — type: official-doc | as-of: 2025 | curl: 200
- https://arxiv.org/html/2406.10279v3 — type: peer-reviewed (USENIX Security '25) | as-of: 2025 | curl: 200
- https://www.usenix.org/system/files/usenixsecurity25-spracklen.pdf — type: peer-reviewed | as-of: 2025 | curl: 200
- https://arxiv.org/abs/2605.17062 — type: preprint | as-of: 2026-08-09 (v3) | curl: 200
- https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ — type: official-doc (landing; PDF canônico não espelhado aqui) | as-of: 2025-12-09 | curl: 200
- https://owasp.org/www-project-mcp-top-10/ — type: official-doc | as-of: 2025 | curl: 200
- https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html — type: official-doc | as-of: 2026 | curl: 200
- https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/ — type: maintainer (cita Spracklen; **não é segunda medição**) | as-of: 2026-04-19 | curl: 200
- https://github.com/ossf/scorecard — type: official-doc | as-of: 2026 | curl: 200
- `~/source/blueprint/base-software-rules/standard/{GATES.md,04-ci-and-gates.md,10-ai-guardrails-and-dx.md}` — type: padrão adotado (ADR-0032)
- https://www.microsoft.com/en-us/security/blog/2026/03/30/addressing-the-owasp-top-10-risks-in-agentic-ai-with-microsoft-copilot-studio/ — type: vendor (corrobora IDs ASI01–ASI10) | as-of: 2026-03-30 | curl: **403** (indexado via fetch anterior; não load-bearing)

**Não usado como load-bearing:** taxa “22% registrável” (confunde com 21,7% de alucinação OSS); HTML `arxiv.org/html/2605.17062` (404; o `abs` resolve).

---

## Recommended Approach

Não mexer nos pisos de cobertura. Primeira fatia de implementação: **A1 error-masking + A3 GATE-14 + B1 fixtures adversariais + B3 argv/timeout** — quatro instrumentos pequenos, todos fail-closed, alinhados ao modo de falha que DORA (estabilidade) e GitClear (máscara de erro) medem, e à superfície ASI/MCP do próprio CLI. Property test (B4) e pin de schema MCP (B2) na fatia seguinte, nos módulos de confiança já nomeados. `GATE-17` só quando existir segundo dono.

### Adoção 2026-08-17

`GATE-14` saiu de prosa: `scripts/waiver/registry.txt` + `scripts/waiver/gate.sh` no `--full` e no job `layout`. ADR-0033 ganhou cabeçalho `Waiver:` / `Expira:`. Error-masking (`scripts/error-masking/`) recusa descarte novo no diff sem `mascarado-porque:`. `GATE-17` entrou como waiver (ADR-0036) enquanto o dono humano for único. Fixtures ASI01/ASI02 e aprovação amarrada fecharam FR-27/28/31. `GATE-10` ficou no grafo Rust (`cargo deny check advisories`); a imagem Docker não é artefato publicado — a chave `vulnerability` do cargo-deny foi removida (PR 611) e advisory já é deny por padrão.

---

## Pass 5 — liveness

| URL | HTTP |
|---|---|
| gitclear.com/the_ai_code_quality_maintainability_gap | 200 |
| cloud.google.com/.../announcing-the-2025-dora-report | 200 |
| dora.dev/dora-report-2025/ | 200 |
| arxiv.org/html/2406.10279v3 | 200 |
| usenix.org/.../usenixsecurity25-spracklen.pdf | 200 |
| owasp.org/www-project-mcp-top-10/ | 200 |
| genai.owasp.org/.../agentic-applications-for-2026/ | 200 |
| cheatsheetseries.owasp.org/.../AI_Agent_Security_Cheat_Sheet.html | 200 |
| labs.cloudsecurityalliance.org/.../slopsquatting... | 200 |
| github.com/ossf/scorecard | 200 |
| arxiv.org/abs/2605.17062 | 200 |
| microsoft.com/.../copilot-studio... | 403 |
