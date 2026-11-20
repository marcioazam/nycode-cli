# Graph, loop e harness engineering: o que dá mais acerto por dólar no harness pi?

**Resposta.** Code graphs ajudam a localizar código em SWE (KGCompass +30-156% relativo, OrcaLoca +6,33 pp), mas o ganho
vem sobretudo da busca por nome e de 1 salto; com modelos pequenos o índice de embeddings carrega o ganho e o grafo não
soma nada mensurável. Por isso o grafo vale por gatilho (multi-arquivo, impacto, chamadores), não como padrão em toda
tarefa. Grafo de tarefas só vale para trabalho decomponível: em planejamento sequencial o multi-agente cai até 70%.
Em loops, a alavanca é o sensor de alta fidelidade com verificador separado: rodadas extras não salvam testes fracos
(o resampling tem teto) e 1 em 5 patches "resolvidos" está errado. No harness, ferramentas adiadas, edição de contexto,
cache de prompt e divulgação progressiva são as alavancas medidas, e o pi já usa as quatro. A que falta é a consciência
de orçamento. Confiança: média, porque quase tudo é preprint ou fornecedor.

**Escopo.** Modo deep, acesso em 2026-11-13, 10 agentes, 35 + 4 claims, 39/39 citações conferidas por script e
39/39 julgadas. Ficaram fora: as tabelas completas dos papers (lidos abstract e introdução) e a medição própria das
ferramentas candidatas.

## Findings
### Graph engineering (código)
- Grafos de repositório melhoram a localização e a resolução em SWE-bench (média) [C2, C4, C5, C1] — https://arxiv.org/abs/2503.21710, https://arxiv.org/abs/2502.00350, https://arxiv.org/abs/2410.14684, https://arxiv.org/abs/2503.09089
- O mecanismo alegado é a travessia multi-salto: 89,7% dos bugs localizados não têm dica no issue (média) [C3] — https://arxiv.org/abs/2503.21710
- Contra: com modelos abertos pequenos o índice de embeddings carrega o ganho e as ferramentas de grafo não somam (média; estudo pré-registrado, análise post hoc) [C36] — https://arxiv.org/html/2610.33958
- O índice estrutural sai com menor $/resolvido que grep agêntico; se compensa em mudanças multi-arquivo ainda é pergunta aberta (baixa-média; autor fornecedor) [C37] — https://arxiv.org/html/2606.22417v1

### Ferramentas e MCPs
- codegraph sincroniza o índice a cada mudança de arquivo (média; fornecedor) [C6] — https://github.com/colbymchenry/codegraph/blob/main/README.md; o comparativo por compilador que o mede é de um concorrente (baixa) [C9] — https://repowise.dev/blog/comparisons/best-code-graph-mcp-servers
- Serena usa language servers, cobre 40+ linguagens no backend LSP, e a aplicação é GPL-3.0-or-later (média) [C7] — https://github.com/oraios/serena/blob/main/README.md; num benchmark local pequeno não melhorou o acerto e somou tokens (baixa) [C38] — https://sovgrid.org/blog/serena-local-benchmark
- O repo map do Aider ranqueia arquivos sobre o grafo de dependências, mas sem MCP e sem watcher (média) [C8] — https://aider.chat/docs/repomap.html

### Grafo de tarefas e workflow
- O alinhamento arquitetura-tarefa decide: +80,8% em trabalho decomponível, −70% em planejamento sequencial (média) [C13] — https://arxiv.org/abs/2512.08296
- Para trabalho sequencial, edição do mesmo arquivo ou muitas dependências, sessão única ou subagentes rendem mais que times (alta; docs oficiais) [C14] — https://code.claude.com/docs/en/agent-teams
- Retomar do checkpoint sem refazer os nós já concluídos é o padrão do LangGraph (média; docs) [C10] — https://docs.langchain.com/oss/javascript/langgraph/checkpointers, e um guardrail bloqueante evita gastar tokens do agente caro (média; só no modo bloqueante) [C11] — https://openai.github.io/openai-agents-python/guardrails/
- A busca automática de workflow (AFlow) só compensa em tarefa repetida e pontuável (média) [C12] — https://arxiv.org/abs/2410.10762

### Loop engineering
- Feedback de alta fidelidade dá até +10 pontos sobre baselines como best-of-N (média) [C16] — https://arxiv.org/abs/2504.01931; com verificador imperfeito o resampling tem teto mesmo com computação infinita (média) [C39] — https://arxiv.org/html/2411.17501v1
- Testes fracos inflam o placar: 1 em 5 patches "resolvidos" está semanticamente errado (média) [C18] — https://arxiv.org/abs/2603.00520
- Um juiz LLM detecta reward hacking nos casos inequívocos, e revisão por verificador separado reduz os hacks entregues (média) [C19, C20] — https://arxiv.org/abs/2511.21654, https://arxiv.org/abs/2610.12822; o hack sobe quando a função de pontuação fica visível (média) [C26] — https://metr.org/blog/2025-06-05-recent-reward-hacking/
- Escalar o verificador com avaliação repetida e critérios decompostos aumenta a acurácia (média) [C17] — https://arxiv.org/abs/2607.05391
- Só aumentar o orçamento de chamadas não ajuda, porque falta consciência de orçamento ao agente (média) [C15] — https://arxiv.org/abs/2511.17006
- Regras de parada na prática: teto de iterações, tempo e ociosidade (média; praticante) [C22] — https://addyosmani.com/blog/self-improving-agents/; juiz no fim de cada ciclo com recomeço limpo (média; fornecedor) [C27] — https://cursor.com/blog/scaling-agents; teto de 8 continuações de stop hook (alta; docs) [C25] — https://code.claude.com/docs/en/hooks
- Modos de falha: marcar feature pronta sem teste (média) [C23] — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents; resets de contexto que dependem do modelo (média) [C24] — https://www.anthropic.com/research/harness-design-long-running-apps; contexto menor rende mais (baixa; praticante) [C21] — https://ghuntley.com/ralph/

### Harness engineering
- Ferramentas adiadas (Tool Search): Opus 4 de 49% para 74% e Opus 4.5 de 79,5% para 88,1% (média; eval interna do fornecedor) [C28] — https://www.anthropic.com/research/advanced-tool-use
- Edição de contexto: +29%, e +39% com o memory tool (média; interna) [C29] — https://claude.com/resources/articles/context-management; o desempenho cai com o tamanho da entrada (média) [C30] — https://www.trychroma.com/research/context-rot
- O cache de prompt corta de 41% a 80% do custo de API (média) [C31] — https://arxiv.org/html/2601.06007v2; a divulgação progressiva de skills economiza até 81,7% dos tokens, com um pouco mais de latência (média) [C33] — https://arxiv.org/html/2609.35692v1
- Roteamento forte/fraco corta o custo em mais de 2x em alguns casos (média) [C34] — https://arxiv.org/abs/2406.18665
- Com o mesmo modelo e o mesmo esforço, o custo por tarefa mudou mais de 2x em alguns casos entre Claude Code/Codex e Pi, com a mesma qualidade (média) [C32] — https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase; o uso de tokens explica 80% da variância de desempenho (média) [C35] — https://www.anthropic.com/research/multi-agent-research-system

## Conflicts and open questions
- Grafo multi-salto [C3] contra grafo sem ganho além dos embeddings [C36]. O C36 é mais novo e pré-registrado, mas usa só modelos pequenos; com modelo de fronteira o C37 aponta menor $/resolvido. O que resolve: medir o codegraph com o Opus/Sonnet do pi em tarefas multi-arquivo.
- Serena: complemento preciso [C7] contra mais tokens e nenhum ganho [C38]. O benchmark é pequeno e usa modelos locais. Fica fora até haver medição própria.

## Gaps
- Gestão de grafo de tarefas para coding (DAG, caminho crítico, replanejamento): nenhum paper com ablação limpa. O ALAS é de job-shop, não de coding.
- Ganho por rodada extra em SWE: nenhuma curva medida; o "~3 tentativas" não tem fonte.
- Consciência de orçamento em coding: só há evidência em agentes de busca [C15].
- GitNexus, CodeGraphContext e ast-grep MCP: README e engine não lidos; ficam como leads.

## Evidence
| id | claim | URL | quote | provider | verdict |
|---|---|---|---|---|---|
| C1 | LocAgent graph-guided localization: 92.7% file-level localization, ~86% lower cost with a fine-tuned 32B model, +12% Pass@10 resolution | https://arxiv.org/abs/2503.09089 | Notably, our method with the fine-tuned Qwen-2.5-Coder-Instruct-32B model achieves comparable results to SOTA proprietary models at greatly  | scout G1 | supported |
| C2 | KGCompass repository knowledge graph lifts resolved rate 30-156% relative over pure-LLM baselines | https://arxiv.org/abs/2503.21710 | Relative to pure-LLM baselines, KGCompass lifts the resolved rate by 50.8% on Claude-4 Sonnet, 30.2% on Claude-3.5 Sonnet, 115.7% on DeepSee | scout G1 | supported |
| C3 | 89.7% of bugs KGCompass localizes lack location hints and need multi-hop graph traversal | https://arxiv.org/abs/2503.21710 | Among the bugs that KGCompass successfully localizes, 89.7% lack explicit location hints in the issue and are found only through multi-hop g | scout G1 | supported |
| C4 | OrcaLoca raises an open-source framework's resolve rate by 6.33 pp | https://arxiv.org/abs/2502.00350 | It also improves the final resolved rate of an open-source framework by 6.33 percentage points through its patch generation integration. | scout G1 | supported |
| C5 | RepoGraph plug-in boosts all four SWE-bench methods it was added to | https://arxiv.org/abs/2410.14684 | We evaluate RepoGraph on the SWE-bench by plugging it into four different methods of two lines of approaches, where RepoGraph substantially  | scout G1 | supported |
| C6 | codegraph auto-syncs the index on every file change (vendor) | https://github.com/colbymchenry/codegraph/blob/main/README.md | Auto-sync is enabled by default. | scout G2 | supported |
| C7 | Serena uses language servers and supports over 40 languages; application GPL-3.0-or-later | https://github.com/oraios/serena/blob/main/README.md | we provide support for over 40 programming languages | scout G2 | partial |
| C8 | Aider repo map ranks files with a graph ranking algorithm over a file-dependency graph | https://aider.chat/docs/repomap.html | It does this by analyzing the full repo map using a graph ranking algorithm, computed on a graph where each source file is a node and edges  | scout G2 | supported |
| C9 | Competitor-run comparison graded code-graph MCPs by call-edge precision and recall against a compiler (Go/TS) | https://repowise.dev/blog/comparisons/best-code-graph-mcp-servers | Precision is the share of reported edges that are correct; recall is the share of real edges found. | scout G2 | supported |
| C10 | LangGraph: resuming from a failed superstep does not re-run successful nodes | https://docs.langchain.com/oss/javascript/langgraph/checkpointers | When you resume graph execution from that super-step you don't re-run the successful nodes. | scout G3 | supported |
| C11 | OpenAI Agents SDK: a tripped input guardrail prevents the agent from running, saving tokens | https://openai.github.io/openai-agents-python/guardrails/ | If the guardrail tripwire is triggered, the agent never executes, preventing token consumption and tool execution. | scout G3 | partial |
| C12 | AFlow automated workflow search lets smaller models beat GPT-4o on specific tasks at 4.55% of the cost | https://arxiv.org/abs/2410.10762 | Furthermore, AFlow enables smaller models to outperform GPT-4o on specific tasks at 4.55% of its inference cost in dollars. | scout G3 | supported |
| C13 | Multi-agent benefit depends on task structure: +80.8% decomposable to -70% sequential planning | https://arxiv.org/abs/2512.08296 | Relative performance change compared to single-agent baseline ranges from +80.8% on decomposable financial reasoning to -70.0% on sequential | scout G3 | supported |
| C14 | Claude Code docs: for sequential, same-file or dependent work a single session or subagents are more effective than teams | https://code.claude.com/docs/en/agent-teams | For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective. | scout G3 | supported |
| C15 | Raising the tool-call budget alone does not help; agents lack budget awareness | https://arxiv.org/abs/2511.17006 | However, we found that simply increasing the tool-call budget fails to improve performance, as agents lack "budget awareness" and quickly hi | scout L1 | supported |
| C16 | Iterative decoding with high-fidelity feedback beats best-of-N by up to 10 points | https://arxiv.org/abs/2504.01931 | Across Sketch2Code, Text2SQL, Intercode, and WebShop, we show that IAD with proper integration of high fidelity feedback leads to consistent | scout L1 | partial |
| C17 | Scaling repeated evaluation and criteria decomposition raises verifier accuracy | https://arxiv.org/abs/2607.05391 | Moreover, scaling repeated evaluation and criteria decomposition consistently lead to additional gains in verification accuracy through vari | scout L1 | supported |
| C18 | One in five 'solved' SWE-bench Verified patches of top-30 agents are semantically wrong (weak tests) | https://arxiv.org/abs/2603.00520 | Our re-evaluation reveals that one in five "solved" patches from the top-30 agents are semantically incorrect, passing only because weak tes | scout L1 | supported |
| C19 | An LLM judge detects reward hacking well in unambiguous cases; held-out tests add little | https://arxiv.org/abs/2511.21654 | We find the LLM judge to be highly effective at detecting reward hacking in unambiguous cases, and observe only minimal improvement from the | scout L1 | supported |
| C20 | Code review by the coder or a separate verifier reduces delivered reward hacks in multi-agent coding | https://arxiv.org/abs/2610.12822 | As potential mitigations, we evaluate code review by the coder or a separate verifier, both of which reduce delivered hacks. | scout L1 | supported |
| C21 | Ralph: use as little context as possible; more context worse outcomes | https://ghuntley.com/ralph/ | The more you use the context window, the worse the outcomes you'll get. | scout L2 | supported |
| C22 | Loop stop rules: max iterations, time limit, idle (no new commit in N iterations) | https://addyosmani.com/blog/self-improving-agents/ | This prevents runaway costs and infinite loops. | scout L2 | supported |
| C23 | Anthropic long-running harness: Claude tends to mark features complete without proper testing | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | One final major failure mode that we observed was Claude’s tendency to mark a feature as complete without proper testing. | scout L2 | supported |
| C24 | Anthropic: context resets were needed for Sonnet 4.5 because compaction alone was insufficient (model-dependent) | https://www.anthropic.com/research/harness-design-long-running-apps | In our earlier testing, we found Claude Sonnet 4.5 exhibited context anxiety strongly enough that compaction alone wasn't sufficient to enab | scout L2 | supported |
| C25 | Claude Code stop hooks: 8-consecutive-continuation cap | https://code.claude.com/docs/en/hooks | Claude Code applies an 8-consecutive-continuation cap: after stop hooks have continued the turn eight times in a row, Claude Code overrides  | scout L2 | supported |
| C26 | METR: reward hacking 43x more common when the model sees the whole scoring function | https://metr.org/blog/2025-06-05-recent-reward-hacking/ | Reward hacking was more than 43× more common on RE-Bench tasks than HCAST tasks, perhaps because on RE-Bench tasks the model was able to see | scout L2 | partial |
| C27 | Cursor: a judge agent decides at the end of each cycle; the next iteration starts fresh | https://cursor.com/blog/scaling-agents | At the end of each cycle, a judge agent determined whether to continue, then the next iteration would start fresh. | scout L2 | supported |
| C28 | Tool Search (deferred tools) improved Opus 4 49%->74% and Opus 4.5 79.5%->88.1% on an MCP eval | https://www.anthropic.com/research/advanced-tool-use | Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool Search Tool enabled. | scout H1 | supported |
| C29 | Context editing plus memory +39% over baseline; editing alone +29% (internal eval) | https://claude.com/resources/articles/context-management | The results demonstrate significant gains: combining the memory tool with context editing improved performance by 39% over baseline. Context | scout H1 | supported |
| C30 | Context rot: performance consistently degrades with input length across 18 LLMs | https://www.trychroma.com/research/context-rot | Across all experiments, model performance consistently degrades with increasing input length. | scout H1 | supported |
| C31 | Prompt caching cut API cost 41-80% and TTFT 13-31% in agentic tasks | https://arxiv.org/html/2601.06007v2 | Our results demonstrate that prompt caching reduces API costs by 41-80% and improves time to first token by 13-31% across providers. | scout H1 | supported |
| C32 | Same model and effort: Claude Code/Codex cost >2x per task vs Pi at equal quality | https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase | When we ran the same model with the same thinking effort through two different harnesses (Claude Code/Codex vs Pi), we observed that the cos | scout H2 | partial |
| C33 | Progressive disclosure of skills may increase latency (token savings up to 81.7%) | https://arxiv.org/html/2609.35692v1 | Progressive disclosure may increase overall latency. | scout H1 | supported |
| C34 | RouteLLM router cuts cost by over 2x without compromising quality | https://arxiv.org/abs/2406.18665 | Our evaluation on widely-recognized benchmarks shows that our approach significantly reduces costs-by over 2 times in certain cases-without  | scout H1 | partial |
| C35 | Anthropic multi-agent: token usage alone explains 80% of performance variance | https://www.anthropic.com/research/multi-agent-research-system | We found that token usage by itself explains 80% of the variance, with the number of tool calls and the model choice as the two other explan | scout H1 | supported |
| C36 | Pre-registered study: the embedding index carries the localization gain; graph tools add nothing measurable on top for most sizes (small open models) | https://arxiv.org/html/2610.33958 | The embedding index carries the gain and the graph tools add nothing measurable on top of it for most sizes. | scout challenge | supported |
| C37 | Structural index lands at a lower $/solved than agentic grep; it pays off when the workload has multi-file changes (vendor) | https://arxiv.org/html/2606.22417v1 | the index lands at a lower $/solved than agentic grep | scout challenge | partial |
| C38 | Serena did not improve success on a small local benchmark and added tokens via tool schemas | https://sovgrid.org/blog/serena-local-benchmark | Serena does not improve success or diff quality. It adds tokens, because its tool schemas bloat every request. | scout challenge | partial |
| C39 | With an imperfect verifier, resampling has an accuracy ceiling even with infinite compute | https://arxiv.org/html/2411.17501v1 | Resampling cannot decrease this probability, so it imposes an upper bound to the accuracy of resampling-based inference scaling even with an | scout challenge | supported |

## Method and cost
Agentes: scholar-scout ×2, research-scout ×1, perplexity-scout ×3, web-scout ×1 (desafio), claim-verifier ×3; 10 no total, no
teto do modo deep. Perplexity: 10 chamadas de 12. Outras: parallel, exa, paper_search e package_version_check; leitura por
web_fetch e exa. `quote_check.py`: 39/39 verified (1 pelo proxy r.jina.ai). Vereditos: 30 supported, 9 partial, 0 refutadas.
Falhas: timeouts do arXiv na busca do paper_search, com fallback para leitura direta.
