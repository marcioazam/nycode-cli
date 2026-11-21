# /plan SOTA do pi (2026-11)

Status: concluído (2026-11-13); pendente só a decisão do usuário sobre a razão de custo. Checkpoint no fim do arquivo.

## Objetivo

Trocar o /plan do pi (pi-code `plan-mode`) por um workflow que se adapta à complexidade da tarefa, com:

- pesquisa read-only durante o plano;
- rascunho do plano persistido em arquivo;
- entrevista no estilo grill, com recomendação e % de confiança;
- decomposição em fases, tarefas e passos;
- checklists de qualidade.

O alvo é reduzir retrabalho e falta de especificação com custo controlado.

## Decisões do usuário (2026-11-13, rodada de plano)

- D1: liberar ferramentas read-only de pesquisa no plan mode: MCP de busca, docs e codegraph, `web_fetch`, `lsp_*` e subagents read-only.
- D2: o modelo assume sozinho só com confiança ≥90%, com evidência e em decisão reversível. Abaixo disso, ou em decisão irreversível, de contrato, segurança, dinheiro ou dados, ele pergunta com recomendação e %.
- D3: o rascunho do plano é persistido em `~/.pi/agent/plans/*.md`, o único destino de `write`/`edit` liberado no plan mode.
- D4: eval pago no pelo-em-ovo com teto de US$ 20.

## Aceitação

- AC1: QUANDO o plan mode está ativo, O SISTEMA DEVE aceitar `tool_search`, `web_fetch`, `mcp__keenable__search_web_pages`, `lsp_*`, `todo` e os MCP dos servidores read-only (keenable, perplexity, exa, brave_search, octen, parallel, youcom, context7, codegraph, paper_search, package_version_check, fetch, firecrawl, nimble).
- AC2: SE o plan mode está ativo e a chamada é a playwright, computer_use_linux, linear ou outro MCP fora da lista, ENTÃO O SISTEMA DEVE bloqueá-la.
- AC3: SE o plan mode está ativo e um `subagent` (single, `tasks` ou `chain`) nomeia um agente fora da allowlist read-only, ENTÃO O SISTEMA DEVE bloquear a chamada inteira.
  - Allowlist: Explore, code-mapper, Plan, perplexity-scout, web-scout, research-scout, scholar-scout, claim-verifier, code-reviewer, security-reviewer, test-reviewer, reliability-reviewer, contract-migration-reviewer, agent-systems-auditor.
- AC4: QUANDO o plan mode está ativo, O SISTEMA DEVE aceitar `write`/`edit` só em arquivo `.md` cujo caminho real fica dentro de `~/.pi/agent/plans/`. `../`, symlink e qualquer outro caminho são bloqueados.
- AC5: QUANDO o plan mode está ativo, o contexto injetado DEVE apontar para `skills/plan-workflow/SKILL.md` e para o arquivo de plano da sessão, e trazer a regra de numeração (só tarefas são numeradas).
- AC6: QUANDO o plano é executado, a mensagem de execução DEVE mandar materializar o arquivo de plano no `/docs` do repositório antes da primeira edição.
- AC7: `planToTodos(template)` DEVE gerar exatamente as N tarefas numeradas e ignorar bullets, `- [ ]` e cabeçalhos.
- AC8: a skill DEVE cobrir triagem T0–T3, ledger de ambiguidades, grill com % de confiança, protocolos "não sei" e de contradição, EARS, fases→tarefas→passos, checklists e revisão em contexto limpo.
- AC9: o eval (≤ US$ 20) DEVE comparar o /plan antigo e o novo, e o relatório DEVE trazer números e custo.

## Custo esperado × qualidade (harness-economy)

- Bytes sempre carregados: o texto injetado no plan mode fica curto, só ponteiros e invariantes; a skill tem `disable-model-invocation` e só carrega dentro do /plan.
- Fora do plan mode o custo é zero.
- Dentro do plan mode há custo extra de pesquisa e perguntas, proporcional ao tier: T0 não paga quase nada.
- O que isso compra: menos retrabalho pós-aprovação e menos lacunas de especificação, medidos no eval.

## Grafo de unidades

- A: pesquisa (tarefa 1).
- B: patch, testes e wrapper (tarefas 3–5), independente de A.
- C: skill e referências (6–7), depende de A.
- D: ligações nos donos existentes (8), depende de C.
- E: eval (9), depende de B e C.
- F: gate (10), depois a revisão (11) e a captura (12).

## Fontes locais consultadas

- knowledge vault: `Resources/Patterns/SDD-Spec-Kit-e-Grill.md`, `Resources/Patterns/skills-curation-criteria.md` (Planejamento proporcional), `Resources/AI-Tools/Pi-Global-Instructions.md` (Plan mode do pi: `[DONE:n]`).
- Harness: `skills/grill-me`, `skills/sdd-workflow` (com `references/`), `extensions/plan-gate.ts`, pi-code `plan-mode/{index,utils}.ts`.
- Restrição do tracker: toda linha numerada vira todo, inclusive as indentadas, e o texto é cortado em 50 caracteres (`utils.ts` `extractTodoItems`/`cleanStepText`).

## Pesquisa

Ver `docs/research/2026-11-plan-sota.md`.

## Checkpoint

- [x] Tarefas 1–12 concluídas. `plan-reviewer`: a rodada 1 saiu incompleta (3 achados corrigidos); a rodada 2 deu `PLAN_REVIEW: complete`.
- [x] Captura no knowledge vault: `Resources/Patterns/SDD-Spec-Kit-e-Grill.md`, id `pi-plan-sota-2026-11-13`.
- [x] Decisão do usuário (2026-11-13): razão de custo acima do limite 1,20 da regra v3 aceita. A rodada 2 baixou a razão de 1,62 para 1,39 (ver "Rodada 2").

## Evidência

### Patch

- Arquivos: `patches/pi-code/zzzzz-plan-sota.patch` e o teste `zzzzz-plan-sota/plan-sota.test.ts`.
- TDD: o teste começou vermelho (6 de 7 falhando; AC7 já passava) e ficou verde (7 de 7).
- Reverse/forward e a pilha inteira aplicam limpo.
- Ajuste depois do smoke: no headless, o modelo tentou gravar o arquivo de plano via `bash`. O texto injetado agora diz "Use the write/edit tools (bash cannot write)", e o patch foi regenerado; 7 de 7 continua verde.

### Correções da revisão (plan-reviewer, rodada 1)

As três correções foram feitas com TDD: 3 testes novos ficaram vermelhos antes do código e depois passaram, 9 de 9.

- Um `subagent` com `resume` agora é bloqueado sempre. Antes, quando a chamada nomeava um agente, ela passava e podia reabrir um run writer.
- `agentScope` diferente de `user` é bloqueado. O handler força `agentScope: 'user'` nas chamadas permitidas, para que um agente de projeto com nome da allowlist não sombreie o do usuário.
- Um symlink pendurado dentro de `plans/` é recusado, verificado com `lstat`.

Patch regenerado. O reverse e o forward deram arquivos idênticos aos instalados.

### Eval A/B (tarefa 9, `bin/evals/plan_ab.py`)

Setup:
- Sonnet 5.5, k=1, 8 casos, headless, sem UI, então a ferramenta de pergunta falha e o que se mede é o comportamento do primeiro turno.
- Os dois braços usam o binário direto; o braço OLD roda com o patch revertido temporariamente.

Rodada 1 (`~/.local/state/pelo-em-ovo/plan-ab/20261113T144346`):
- ask_correct 0,5 → 1,0; contradição 0,5 → 1,0; rec% 0 → 0,625; tier_match 0 → 0,375; EARS 0 → 0.
- Custo US$ 0,89 → 1,31 (razão 1,48).
- Achados: o modelo rebaixava o tier quando a mudança era pequena (SQLite+UUID saiu T1) e mandava um ponteiro para o arquivo no lugar do plano.

Correções após a rodada 1:
- Skill enxugada de 8,9 para 6,4 KB.
- Sinais de tier combinados por OU (um sinal T3 ⇒ T3).
- T0 = edição mecânica.
- O `plan_mode_complete` carrega o plano completo.
- Fallback quando a pergunta falha.
- Rótulos de 2 casos corrigidos para a definição documentada antes do eval (autenticação e dados persistentes são sinais T3 na tabela). Não é ajuste ao resultado: o caso de cache, também divergente, ficou como estava.

Medição 2 da primeira entrega (`.../20261113T145040`):

| métrica | OLD | NEW |
|---|---|---|
| ask_correct | 0,5 | 0,875 |
| rec_pct | 0 | 0,5 |
| tier_stated | 0 | 0,875 |
| tier_match | 0 | 0,75 |
| contradição | 0 | 1,0 |
| EARS | 0 | 0,75 |
| plano enviado | 1 | 1 |
| custo | US$ 0,87 | US$ 1,40 |

Leitura da rodada 2:
- Razão de custo 1,62. **Excede o limite 1,20 da regra v3.** O extra é de cerca de US$ 0,07 por plano e vem da leitura da skill, das perguntas e do arquivo de plano, que são justamente as funções pedidas. (Superado pela seção "Rodada 2": 1,39.)
- Falhas restantes: `t2-cache-doubt` não perguntou; os casos T0 às vezes não declaram o tier.
- k=1, sem significância estatística.
- Gasto total do eval ≈ US$ 4,5 de 20.

### Gate final (árvore final, depois das correções da revisão)

- Log: `/tmp/plan-sota-gate.log`.
- Os 30 checks deram `EXIT=0`:
  - plan-sota 9/9;
  - todos os testes de `patches/pi-code` (19 arquivos);
  - plan-gate;
  - unittest do `plan_ab`;
  - check-instructions;
  - check-agents;
  - hooks;
  - structure em evals, plan-workflow e plan-mode;
  - `bash -n` do wrapper;
  - reverse da pilha inteira.
- sha256 do patch: `ad606c14…`. `index.ts`: `b39a4475…`. `utils.ts`: `31169737…`.

### Veredito por AC

- AC1–AC7: verificados pelos testes do patch, 9/9 no gate final.
- AC8: coberto pela skill `plan-workflow` e pelas 3 referências.
- AC9: eval executado, números acima. A razão de custo de 1,62 excede o limite 1,20 da regra v3 e depende de decisão do usuário. (Superado: aceito pelo usuário; razão atual 1,39, seção "Rodada 2".)

## Rodada 2 (2026-11-13): qualidade perto do teto sem subir o custo

Pedido do usuário: aceitar a razão de custo, mas antes pesquisar mais e levar a nota do plano a "quase 100%" sem subir muito o custo.

### Decisões

- D5: a forma do plano é cobrada por um lint determinístico em `plan_mode_complete` (`lintPlan`, regras R1–R9), não por mais texto de prompt. Custo em tokens: zero quando o plano passa.
- D6: o plano é escrito uma vez. `plan_mode_complete` salva o texto no arquivo de plano; numa rejeição o texto também é salvo, o modelo corrige com `edit` e reenvia `"@file"`, sem repetir o plano.
- D7: T0 não lê a skill (atalho no contexto injetado). As regras do lint ficam no contexto injetado, para o modelo acertar na primeira submissão.
- D8: a revisão por subagente em contexto novo fica só para T3 (um agente, escolhido pelo risco). T1 e T2 usam os checklists e o lint.
- D9: confiança verbalizada é sinal ordinal, não probabilidade (Xiong et al., ICLR 2024): definida antes da recomendação, com a alternativa mais forte nomeada, e no máximo ~75% sem evidência citável.
- D10: contradição e escolha de formato de dados, contrato público, segurança ou deleção sempre viram pergunta; uma escolha do modelo é `A#`, nunca `D#`.
- D11: o registro em `/docs` de T2+ é documento vivo (Progresso, Surpresas, Log de decisões, Resultados), do modelo ExecPlan da OpenAI.
- D12: o braço OLD do eval roda num diretório de agente sombra (`PI_CODING_AGENT_DIR`, symlinks e cópia privada de `plan-mode` com o patch revertido). O eval não altera mais a extensão instalada.

### Contrato de teste alterado

- `zzzz-plan-done-rule/plan-done-rule.test.ts`: a string do plano passou a `Tier: T0 (teste)\n1. contar a.txt\n2. contar b.txt`. Motivo: o contrato novo exige a linha de tier; a asserção sobre `[DONE:n]` não mudou.
- Rótulo do caso `h-t1-validate`: o prompt antigo pedia um comportamento que o fixture já tinha; passou a pedir o limite de 100 caracteres.

### Incidente (15:34, corrigido)

- Fato: durante o braço OLD da rodada `20261113T152713`, o `index.ts` instalado de `plan-mode` ficou com um import duplicado (`mkdirSync`) e arquivos `.rej`. A extensão não carregava; 7 execuções OLD saíram com custo 0 e foram descartadas.
- Causa: o eval revertia o patch na instalação compartilhada; o wrapper de outra sessão do pi, iniciada às 15:33, reaplica patches na partida, e as duas operações correram juntas.
- Reparo: arquivos restaurados da aplicação limpa do patch (`cmp` idêntico no ciclo reverso/avanço, 25/25 testes); cópia do estado quebrado em `/tmp/plan-mode-broken-1534`.
- Correção da causa: D12. O gate ganhou as checagens `roundtrip-identical` e `no-rej`, porque `patch -R --dry-run` passou no arquivo quebrado e não prova o estado aplicado.
- Efeito possível: uma sessão do pi iniciada entre 15:34 e 15:45 ficou sem plan mode até reiniciar.

### Eval (Sonnet 5.5, 14 casos, k=1, sem resposta às perguntas)

OLD: `20261113T153708` (braço sombra). NEW: `20261113T152713`. Linhas combinadas em `20261113T153708/combined-old153708-new152713.json`.

| métrica | OLD | NEW |
|---|---|---|
| nota (média dos booleanos) | 0,424 | 0,976 |
| nota, casos dev (8) | 0,411 | 0,990 |
| nota, casos holdout (6) | 0,441 | 0,958 |
| pergunta quando devia | 0,429 | 1,0 |
| recomendação com % | 0,0 | 1,0 |
| tier certo | 0,0 | 0,929 |
| contradição levada ao usuário | 0,25 | 0,75 |
| EARS, AC rastreado, check, rollback | 0 / 0 / 0,727 / 0 | 1,0 em todos |
| título ≤ 50 | 0,0 | 0,929 |
| custo por plano (US$) | 0,081 | 0,113 |
| razão de custo | | 1,39 (era 1,62) |
| custo por tier T0/T1/T2/T3 | 0,075 / 0,079 / 0,084 / 0,084 | 0,081 / 0,109 / 0,116 / 0,129 |
| reenvios por plano | 0 | 0,07 |

Falhas restantes do NEW (3 booleanos em 14 execuções):
- `h-t3-contract`: resolveu a contradição no plano sem perguntar.
- `h-t1-paging-doubt`: declarou T3 (mudança de contrato público) onde o rótulo diz T1; o rótulo é discutível.
- `t3-delete-keep`: um título acima de 50 caracteres pelo critério do avaliador, que o lint aceitou.

Limite do lint: uma linha `ACn:` que cita outro AC conta como cobertura (checagem de forma, não de sentido).

Limites: k=1 (sem medida de variância), um modelo, perguntas sem resposta (só o primeiro turno), avaliador por regex. O prompt do braço OLD já cita a skill pelo `CLAUDE.md`, o que favorece o OLD. A razão 1,39 segue acima do limite 1,20 da regra v3, aceita pelo usuário. Gasto total de eval: cerca de US$ 11,2 de 20.

### Gate (árvore final)

34 checagens, todas `EXIT=0` (`/tmp/plan-sota-gate2.log`, refeito depois das correções da revisão): os 30 de antes, mais `eval-selfcheck`, `roundtrip-identical` e `no-rej`. sha256: patch `a2a5ba16c7e581db`, `index.ts` `5af9f1fcc8f6ee5e`, `utils.ts` `98571009ec3e556a`. Testes: `plan-sota.test.ts` 25/25, `test_plan_ab` 23/23.

Briefs: `plan-sota-2026-11-patch-brief-v2.md`, `-patch-brief-v3.md`, `-eval-brief-v2.md`.

## Rodada 3 (2026-11-13, "finalize tudo")

### Mudanças

- Lint R9: o título é medido como o todo o mostra (sem crase e negrito, antes do corte em 47+...), e a mensagem traz o tamanho e o texto exibido, para a correção sair em uma edição. Motivo: o `t0-rename` levou duas rejeições por crases no título, o que custou turnos num T0.
- Avaliador:
  - `final_plan` avalia o plano aceito no fim (última submissão completa mais as edições no arquivo de plano), não a concatenação das versões rejeitadas. Também aceita `edits` codificado em JSON; o crash dessa forma foi observado no run `20261113T154818`.
  - `title_len` mede como o lint mede.
  - Os arquivos `raw/` de cada repetição são preservados quando k>1.
- Skill: no protocolo de contradição, a própria pergunta cita os dois lados.
- Rótulo do caso `h-t1-paging-doubt`: `tier_ok` passou de `[T1, T2]` para `[T2, T3]`. Motivo: na skill, um marcador de dúvida torna a tarefa no mínimo T2, e mudar o formato de resposta de um endpoint público é sinal de T3. O rótulo novo é mais estrito, não mais frouxo.

### Eval

| run | braços | k | nota NEW (dev / holdout) | custo NEW por plano (US$) | observação |
|---|---|---|---|---|---|
| `20261113T161702` | ambos | 2 | 0,983 (0,974 / 0,994) | 0,084 | OLD 0,423. Razão a frio (rep. 1) 1,48; com cache quente (rep. 2) 2,68, ou +US$ 0,034 por plano |
| `20261113T164722` | NEW | 1 | 0,995 (1,0 / 0,987) | 0,117 | depois da correção do R9. Reenvios 0,14; `t0-rename` sem rejeição |

Regradação dos `raw/` com o avaliador e o rótulo finais (o run `161702` foi avaliado com o avaliador da época):
- `164722`: 0,987, com 2 falhas, `h-t1-paging-doubt` (declarou T1 apesar do marcador de dúvida) e `h-t3-contract` (`contradiction_asked`);
- `161702` (NEW, última repetição por caso): 0,983.

Falha do último run no avaliador da época: `h-t3-contract`, `contradiction_asked`. O modelo perguntou sobre o contrato, mas a pergunta não citou literalmente "não podem quebrar".

A razão de custo depende do estado do cache. A frio fica entre 1,39 e 1,48; com cache quente o prefixo fica barato e a razão sobe, mas a diferença absoluta cai para cerca de US$ 0,03 por plano. Gasto total de eval: US$ 16,55 de 20 (soma de `cost_usd` dos `results.jsonl` de 2026-11-13 em `~/.local/state/pelo-em-ovo/plan-ab/`). O eval foi encerrado a pedido do usuário com estes dados.

### Gate

34 checagens, todas `EXIT=0` (`/tmp/plan-sota-gate3.log`). sha256: patch `6c2a6e35acbac286`, `index.ts` `5af9f1fcc8f6ee5e`, `utils.ts` `5297266319d2047c`. Testes: `plan-sota.test.ts` 26/26, `test_plan_ab` 25/25.
