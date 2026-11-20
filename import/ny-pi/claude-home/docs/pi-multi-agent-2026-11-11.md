# pi multi-agente: árvore de agentes com aninhamento (2026-11-11)

## Objetivo e pedido
O usuário pediu um harness pi "100% multi-agêntico", com time de agentes, um orquestrador sempre, número de agentes
definido pela necessidade, subagentes de 2º e 3º grau, cada agente com seu agent e skill específicos, SOTA em custo x
benefício e assertividade igual ou maior que a do Claude Code.

## Avaliação de cada pedido (evidência abaixo)
| Pedido | Decisão |
|---|---|
| Um orquestrador sempre | Já valia (CLAUDE.md, Runtime): a sessão principal orquestra, os agentes fixados implementam. Mantido. |
| Subagentes de 2º e 3º grau | **Adotado** com cap de profundidade 3 (principal = 0). Só escritores aninham; leitores, revisores e Haiku são folhas. |
| Quantos agentes precisar, sem limite | **Com limite**: o próprio Claude Code limita (16 concorrentes, 1.000 por execução de workflow). Aqui (revisado na rodada 3): por lane, 64 execuções e 20 USD, concorrência 4 na raiz e 2 abaixo (máx. 28 processos filhos; 30 GB de RAM e 24 threads). Ajustável por env. |
| Time de agentes (peers com mailbox) | **Não adotado**: experimental e desligado por padrão no Claude Code, "significantly more tokens"; arquivo compartilhado supera troca de mensagens e coordenador nomeado não ajuda. O grafo de unidades no `/docs` é a lista de tarefas compartilhada. |
| Agent + skill específicos por tarefa | Já valia: `swarm-orchestration` (Brief) escolhe o agente; 10 agentes pré-carregam skills por `skills:`. Mantido. |
| Workflows dinâmicos estilo Claude Code | **Não adotado agora**: o pacote `@quintinshaw/pi-dynamic-workflows` 3.15.1 (vetado, sem instalar) roda agentes em processo com `noExtensions`, ou seja, sem `guard.py` (única barreira técnica) e sem MCP (codegraph, busca). Rebaixaria o piso de segurança. Os 6 workflows seguem rodando "à mão" com `subagent`. |
| Assertividade ≥ Claude Code | **Não verificada**: exige rodada pareada `pelo-em-ovo` (custo ≤ 1,20) com teto de gasto definido pelo usuário. |

## O que mudou
- `patches/pi-code/subagent-nesting.patch` (substitui `subagent-roster.patch`; reaplicado pelo wrapper
  `~/.local/bin/pi`): novo `subagent/nesting.ts` (desde 2026-11-12 em `subagent/nesting/index.ts`, ver `pi-agent-fleet-2026-11-12.md`) (profundidade, cap, concorrência por nível, orçamento por árvore em
  `/tmp/pi-code-subagent-tree-<id>/`, um arquivo por spawn com criação exclusiva); `index.ts` (roster e ferramenta
  só abaixo do cap; orçamento cobrado antes de qualquer execução), `run.ts`/`background.ts` (env do filho),
  `modes.ts` (concorrência por nível), `concurrency.ts` (sai o `MAX_CONCURRENCY` fixo). Originais em `orig/subagent/`.
- Env: `PI_CODE_SUBAGENT_MAX_DEPTH` (3, 1..5), `PI_CODE_SUBAGENT_BUDGET` (64 por lane), `PI_CODE_SUBAGENT_COST_BUDGET` (20 USD por lane), `PI_CODE_SUBAGENT_NESTED_CONCURRENCY` (2, 1..4).
- 12 agentes escritores perdem `subagent` do `disallowedTools`: swarm-worker, general-purpose, contract-engineer,
  test-author, gateway-engineer, go-service-engineer, web-platform-engineer, terraform-specialist, docs-architect,
  dependency-remediator, zero-legado-builder, lane-integrator.
- Regras: CLAUDE.md (Runtime), `rules/research-and-tools.md` (Delegation), `docs/agent-contract.md`,
  `skills/swarm-orchestration` (nova seção Nesting), `agent-routing`, `zero-legado`, `variant-analysis`,
  `wire-contract-change`, `pi-skill-adaptation.md`, `goal.md`, `pi-cost-benefit-2026-11-11.md`.
- Contrato antigo superado: "subagents cannot spawn subagents" (2026-11-08) → aninhamento de escritores até profundidade 3.
  As skills EGM continuam sem aninhamento (seus agentes têm `tools:` sem `subagent`).

## Custo e qualidade
- Custo: roster (~4,3k tokens) no prompt de cada escritor que ainda pode delegar; cada nível extra paga o prefixo de
  um filho. Ganho esperado: o líder Sonnet manda varreduras e o gate para Haiku (preço ~20x menor por token) em vez
  de gastar o próprio contexto; unidade grande demais para um contexto vira sub-unidades disjuntas.
- Risco: telefone sem fio (multi-agente sai do rumo 2-5x mais). Mitigação: regra de nunca re-delegar o brief inteiro,
  cada nível julga os próprios filhos, gate e revisão final na raiz.
- Rollback rápido: `PI_CODE_SUBAGENT_MAX_DEPTH=1` (nenhum filho delega). Completo: `patch -R` com
  `subagent-nesting.patch`, apagá-lo, copiar `backups/multi-agent-2026-11-11/subagent-roster.patch` de volta para
  `patches/pi-code/` e devolver `subagent` ao `disallowedTools` dos 12 agentes (estado anterior em
  `backups/agents-models-2026-11-11/`).

## Evidência (lida em 2026-11-11)
- Agent teams: https://code.claude.com/docs/en/agent-teams ("experimental and disabled by default"; "significantly more tokens"; "For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective"). Decisão de não adotar superada em 2026-11-13:
  `pi-agents-ui-teams-sota-2026-11-13.md` (pesquisa + eval pareada decidem).
- Workflows: https://code.claude.com/docs/en/workflows ("Up to 16 concurrent agents by default"; "1,000 agents total per run").
- Single vs multi: https://arxiv.org/abs/2611.12953 (1,4-4,7x tokens, ganhos raramente significativos; implementação pesa mais que a escolha).
- Sair do rumo 2-5x: https://arxiv.org/html/2610.39193v1. Tarefas conflitantes 62%→16%: https://arxiv.org/abs/2611.00314.
- Arquivo compartilhado −42% tokens, coordenador nomeado sem ganho: https://arxiv.org/abs/2608.16801.
- Avaliador separado e cético: https://www.anthropic.com/engineering/harness-design-long-running-apps.
- Começar por orquestrador-subagentes: https://claude.com/resources/articles/multi-agent-coordination-patterns (trechos via Exa).
- Vetting do pacote de workflows: relatório do subagente bg-463efcc8 (arquivos em `/tmp/pdw`, `src/agent.ts:988-993` `noExtensions: true`).
- Lacunas: rodada de eval pareada não executada; ADK/LangGraph só por trecho de busca.

## Verificação
- `node --experimental-strip-types --test patches/pi-code/subagent-nesting.test.ts`: 6/6 pass (profundidade, cap,
  env do filho, concorrência, orçamento, patch instalado).
- `bin/checks/check-instructions.py`: 22 arquivos, 0 problemas (sempre carregado 39.693 B). `bin/checks/check-agents.py`: 53 agentes OK.
- E2E pelo CLI real (`~/.local/bin/pi -p`, Haiku 5.5): sessão em profundidade 2 delegou ao `Explore`, que respondeu
  `NEST_OK_3` (rodou em profundidade 3; orçamento da árvore = 1); sessão em profundidade 3 recebeu a recusa com o cap,
  orçamento intocado.
- E2E do modo `background` (rodada 5): filho em background recebeu `depth=2` e a lane do pai.
- `npm test`/`tsc` do pi-code: não aplicável ao pacote instalado (sem devDependencies nem tsconfig); o carregamento
  real dos `.ts` patchados pelo pi (todos os E2E acima) cobre sintaxe e execução.
- Eval pareada: rodadas 4 e 5.

## Rodada 2: deep search (2026-11-11)
Relatório e ledger: `docs/research/2026-11-11-pi-multiagent-sota.md` (+ `.ledger.json`; report_check pass, 38 claims,
35 supported, 3 partial, nenhuma refutada). Aplicado em `skills/swarm-orchestration`:
- Roteamento por dificuldade antes da execução, e escalonamento só por sinal determinístico (C7, C24, C25).
- O brief leva o próprio arquivo da tarefa, nunca um resumo (C34).
- Plano por padrão; best-of-n só com testes executáveis; prefixo estável e sem troca de modelo no meio da tarefa
  (C32, C10, C4, C37, C6, C36).
Recomendado e não aplicado (precisa de decisão do usuário): orçamento de custo/tokens por árvore além das 200
execuções (C22; o valor padrão em US$ é decisão de política); eval pareada `pelo-em-ovo` com aninhamento ligado
e desligado (teto de gasto).

## Rodada 3: orçamento decidido por custo x benefício (usuário delegou, 2026-11-11)
- Lane = cada filho da sessão principal e tudo abaixo dele (antes: a árvore era a sessão inteira, então 200
  execuções valiam pela vida da sessão). A sessão principal não tem teto: o usuário vê cada chamada dela.
- 64 execuções por lane: o mesmo padrão do pi-subagents (`maxSubagentSpawnsPerRun`); a fuga documentada no Codex
  foi de 74 subagentes até a profundidade 3 (research C19, C21).
- 20 USD por lane, somando o custo dos descendentes terminados (foreground). Medido em 104 sessões do pi nos últimos
  14 dias (145 execuções de subagente): p50 0,16, p90 2,43, p99 7,18, máx 8,02 USD por execução. 20 USD comporta
  um líder com algumas sub-unidades Sonnet e corta a cauda de fuga. Execuções em background não reportam custo (só
  contam no limite de execuções).
- Teste: `subagent-nesting.test.ts` com 7 casos.

## Rodada 4: eval pareada (teto decidido: 40 USD; gasto real 21,26 USD)
Suite `~/.claude/evals` via `pelo-em-ovo/run_pi.py`, 29 casos de roteamento e delegação, k=1, orquestrador
claude-opus-5-5, pi 1.5.2 e pi-code 1.7.0. Resultados em `~/.local/state/pelo-em-ovo/results/` (marcados com `.keep`):
`pi-nest-on-20261111T173338` e `pi-nest-off-r2-20261112T150614` (`PI_CODE_SUBAGENT_MAX_DEPTH=1`). Referência do
Claude Code: `~/.claude/evals/results/egm-post-20261106T190732` (2.1.319, mesma suite e modelo, k=1, sem gasto novo).
- 27 casos pareados nos três braços: pi com aninhamento 27/27, a US$ 0,372 por caso; pi sem aninhamento 26/27, a
  US$ 0,370; Claude Code 27/27, a US$ 0,730. O pi iguala o acerto com 51% do custo (razão 0,51, regra v3 pede ≤ 1,20).
- A única diferença (`route-ho3-review-en`, falha só no braço sem aninhamento) não envolveu delegação
  (delegated_rate 0 nos dois braços): ruído de k=1. Aninhamento ligado não mudou acerto nem custo nesta suite.
- A primeira tentativa do braço sem aninhamento (`pi-nest-off-20261111T174520`) foi descartada: 429 rate_limit
  da conta em todas as unidades (infraestrutura, não resultado).
- Limites: a suite mede escolha de rota e delegação, não acerto de implementação (suite `outcome`, US$ 1-10 por caso);
  k=1; a referência do Claude Code é de 2026-11-06; custos são estimativas a preço de lista.

## Rodada 5: fechamento (2026-11-12)
- Eval de resultado (`outcome`, 4 casos de implementação, diagnóstico e revisão, k=1, Opus 5.5):
  `~/.local/state/pelo-em-ovo/results/pi-outcome-nest-20261112T153426`: pi 4/4, US$ 1,263 no total.
  Referência do Claude Code (gravada, mesmo modelo): `goal8-post-20261030T222631` (out-diagnose-crossfile,
  out-review-uncommitted, out-ui-motion-fix-wpe) e `structured-k1-20261102T025017` (out-negative-trap): 4/4,
  US$ 3,105. Razão de custo 0,41. O braço novo do Claude Code não rodou: `claude` está deslogado nesta máquina
  ("Not logged in · Please run /login"); o diretório da tentativa vazia foi removido. Gasto total das evals:
  US$ 22,52 de 40.
- Checagens do harness (regra harness-economy): check-instructions 0 problemas; check-agents 53 OK; hooks 27+28
  testes OK; patches 29/29; no-context-files 3/3; ponytail 30/30; wrapper `bash -n` OK; os 4 patches aplicados.
- knowledge vault: `claude-harness-swarm-delegation-2026-11.md` (23,8 KB) decidido como **keep** pela curadoria (um
  assunto, seções autocontidas lidas por `kb section`); divisão só sob pedido explícito de manutenção
  (`obsidian-cli/references/curation.md`).
- Conclusão: o pi iguala a assertividade do Claude Code nas suites medidas (roteamento 27/27, resultado 4/4) com
  41-51% do custo. "Maior" não é afirmável com k=1 e esse tamanho de amostra.

## Rodada 6: referência atual do Claude Code, eval k=2 e correção de test gaming (2026-11-12)
- Referência atual: `~/.claude` está no limite semanal (reseta 2026-11-14) e o "Not logged in" da rodada 5 foi
  transitório; `~/.claude-2` usa o mesmo harness (agents, skills, settings, hooks, plugins são symlinks para
  `~/.claude`), só outra conta, e rodou com `CLAUDE_CONFIG_DIR=~/.claude-2`.
- Eval `outcome`, 8 casos (diagnóstico, armadilha negativa, 2 revisões, SOTA de cliente HTTP, gateway Go, serviço
  Go, UI delegada), k=2 onde o caso permite (`reps: 1` em 4 deles por desenho), Opus 5.5, braços em paralelo:
  `~/.local/state/pelo-em-ovo/results/pi-outcome-k2-20261112T154340` e
  `~/.claude/evals/results/cc-outcome-k2-20261112T154340` (Claude Code 2.1.322).
  pi 11/12 (US$ 4,94) × Claude Code 11/12 (US$ 10,27): razão de custo 0,48.
- Falha do pi: `out-sota-transform` rep 1 pôs `# pragma: no cover` (doces-ou-travessuras TRAVESSURA,
  `coverage-pragma`). Correção: sensor de exclusão de cobertura no `hooks/dispatch/hook-dispatch.sh`
  (`edit_sensors`, PostToolUse Edit/Write, não bloqueia), TDD: `test_coverage_exclusion_sensor` vermelho antes,
  verde depois; 29/29 no dispatcher. Reverificação `pi-sota-recheck-*`: 3/3, todas DOCE; na rep 1 o agente tentou
  de novo, o sensor avisou 5 vezes e o diff final saiu limpo.
- Falha do Claude Code: `out-ui-motion-fix-wpe` rep 1 (harness do Claude Code, fora deste escopo).
- Conclusão sobre "maior": nas amostras medidas o acerto é igual (roteamento 27/27 × 27/27; resultado 11/12 × 11/12)
  e o custo do pi é 41-51% do Claude Code. Distinguir uma diferença de acerto com os dois perto de 92-100% exige
  centenas de execuções; pelo custo x benefício (decisão delegada), a meta adotada é igualdade de acerto com metade
  do custo, já atingida. Não há afirmação de acerto maior.
- Gasto total das evals: US$ 39,65 (teto 40).
- knowledge vault: a nota `claude-harness-swarm-delegation-2026-11.md` foi dividida (curadoria, snapshot
  `~/.local/state/vault-snapshots/vault-2026-11-12-pre-split.tgz`): as seções do pi foram para
  `Resources/Patterns/pi-harness-multi-agent-2026-11.md` e "Plan gate sem /goal…" para
  `Resources/AI-Tools/Claude-Code-Goal.md`, ambas verbatim, com "Moved sections" na origem e link de entrada
  corrigido. Origem 17.205 B, lint: unresolved 0, oversized 15 → 14. Substitui o "keep" da rodada 5.
- Fila `oversized` do knowledge vault (14 notas; todas já estavam acima de 20 KB antes desta tarefa, conferido no snapshot
  `knowledge vault-2026-11-12-pre-split.tgz`): uma decisão por nota (curation.md, "Oversized notes"), propostas pelo
  `knowledge-curator` e aplicadas pelo coordenador. Keep (um assunto, seções autocontidas, lidas por `kb section`):
  Debug-Journal, Mega-Plan-Banco-Only-2026-11-06, ChatGPT-activate-lessons-2026-10, Speed-Track-CI-Lane,
  Git-Delivery-Script, MCP-Servers-Landscape-2026, Agent-Evals-SOTA-2026, Uncertain-Grant-Replay,
  Provider-Account-Identity, Relay-Terminal-Causes, Final-Battery-k-Harness-Defects, Agent-Harness-Single-Source,
  skills-curation-criteria. Split parcial: `claude-harness-orchestration-evals` moveu verbatim "Troca
  codebase-memory → codegraph" (1.717 B) para `Code-Graph-Tools-Benchmark` (snapshot
  `knowledge vault-2026-11-12-pre-split2.tgz`); a seção de intake de skills ficou, porque o dono já passa do teto. O lint
  segue listando 14 por tamanho (a fila é de revisão, não `attention`); `attention` 0, `unresolved` 0.
- Referência de roteamento atualizada: o harness do Claude Code mudou depois de `egm-post-20261106T190732` (223
  arquivos), então o braço foi refeito em `~/.claude/evals/results/cc-routing-current-20261112T160746` (Claude Code
  2.1.322, `~/.claude-2`; agents, skills, rules, hooks, commands, plugins, workflows e settings.json são symlinks
  para `~/.claude`, e as definições MCP do `.claude.json` são byte a byte iguais; só a conta difere, porque
  `~/.claude` está no limite semanal até 2026-11-14). Mesmos 29 casos de `pi-nest-on-20261111T173338`, sem rate
  limit e sem exclusões de infra: pi 29/29 (~US$ 10,67) × Claude Code 28/29 (~US$ 20,49); a falha do Claude Code foi
  `route-egm-ho2-readmes-en`.
- Veredito pela regra de adoção v3 (`~/.claude/evals/stats.py`, por caso pareado): roteamento n=29 `no_worse`
  (IC95 [0, 0,103], sign p=1,0); combinado roteamento + outcome n=37 `no_worse` (IC95 [-0,027, 0,095], 2 melhores e
  1 pior, sign p=1,0); razão mediana de custo 0,44 (teto 1,20). "Melhor" exige sign p < 0,05, isto é, pelo menos 6
  casos melhores e nenhum pior; com os dois braços em 92-100% isso não é alcançável nesta suite. Resposta final:
  acerto igual (não pior, estatisticamente), com 44% do custo. Gasto total das evals: US$ 60,14 (teto revisto de
  US$ 40 para 65 para fechar a referência atual; decisão de custo x benefício delegada).
- Rodadas anteriores: `pi-nest-off-r2` tem 0 eventos de rate limit e `excluded_infra` vazio; a primeira tentativa
  (só 429) foi descartada e substituída por ela.
- Decisões do usuário (2026-11-12, via `question`), que fecham os itens restantes:
  1. Referência do Claude Code: aceito `~/.claude-2` (mesmo harness por symlink; a conta é só cobrança). Sem rerun
     na conta principal.
  2. Meta de acerto "igual ou maior": cumprida pelo veredito `no_worse` (n=37, regra v3) com 44% do custo; não se
     afirma "maior".
  3. Fila `oversized` do knowledge vault: manter as 13 notas pela regra de curadoria; a fila é de revisão, não defeito.
  4. Gasto das evals: US$ 60,14 ratificado (teto 65).
