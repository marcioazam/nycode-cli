# Faixa r4-artigos (relatório bruto do subagente, 2026-11-19)

Resumo: li 36 resumos (OpenAlex ou `firecrawl inspect`) e nenhum id repete os que a pasta de pesquisas já cita (confirmado com rg). Faltam Semantic Scholar e DBLP: ficaram vazios em 7 tentativas (ver gaps). Nenhum artigo teve retração conferida. Todos os links são `https://arxiv.org/abs/<id>`, exceto onde há DOI. Preprints marcados "pp". "abs" = número lido no resumo. "NV" = número só no relato do Perplexity, não está no resumo.

| Pn | Título curto | id/DOI | Ano/venue | Resultado principal | Implicação para o ny-pi | Status |
|---|---|---|---|---|---|---|
| P1 | AgentConductor | 2602.17100 | 2026 pp | Topologia DAG por dificuldade: +14,6% pass@1, −68% custo de tokens (código de competição) | O grafo pode ter densidade variável por dificuldade da tarefa | abs |
| P2 | DyTopo | 2602.06039 | 2026 pp | Grafo reconstruído a cada rodada: +6,2 em média sobre o melhor baseline (código e matemática) | Arestas dinâmicas por rodada; a trilha de grafos é interpretável | abs |
| P3 | Graph-GRPO | 2603.02701 | 2026 pp | Resumo só diz "supera o estado da arte"; 91,25% vs 88,33% em HumanEval só no Perplexity | Comparar grupos de grafos reduz o ruído do treino | abs; NV (números) |
| P4 | ARG-Designer | 10.1609/aaai.v40i28.39481 | AAAI 2026 | Grafo gerado do zero (agentes, papéis, arestas); 6 benchmarks, "mais eficiente em tokens" sem número | Papéis de um conjunto extensível; base para o editor | abs |
| P5 | GTD (difusão de grafos) | 10.18653/v1/2026.acl-long.1764 | ACL 2026 | Síntese guiada por proxy (precisão/custo); ganho sem número no resumo | Otimização multiobjetivo (acerto×custo) | abs |
| P6 | TopoPrior | 2605.17359 | 2026 pp | Prior de topologia offline; o resumo não traz número (40,22% só no Perplexity) | Reaproveitar grafos aprendidos reduz a busca online | abs; NV |
| P7 | Adaptive Graph Pruning | OpenAlex W4415428106 (sem DOI) | 2025 | +2,58% a +9,84% em 6 benchmarks (não-código) | Podar nº de agentes e arestas | abs |
| P8 | Mixture of Self-Improving Branches | 2609.37834 | 2026 pp | +3,8% relativo no SWE-bench Lite, +11,6% no TB2.0 sobre o Meta-Harness | Roteador escolhe qual harness rodar por tarefa | abs |
| P9 | Meta-Harness / MILO | 2603.28052 / 2609.38349 | 2026 pp | Busca no código do harness (TB2, DeepSWE); sem número lido | Hipótese de que o harness pode ser buscado, não projetado | só título; NV |
| P10 | Argus (Manager/Planner/Engineer/Reviewer) | 2608.05144 | 2026 pp | ~78% vs 59% no SWE-Bench Pro com 1,41× tokens; −21% tokens com auto-evolução | Papéis explícitos pagam acerto a +41% de tokens | abs; fornecedor |
| P11 | SEMAP (protocolo guiado por MAST) | 10.1109/apsec66846.2025.00100; 2510.12120 | APSEC 2025 | −69,6% falhas (função), −56,7% (deploy), −47,4%/−28,2% (vulnerabilidades Py/C++) | Contratos de comportamento e mensagens estruturadas por aresta | abs |
| P12 | FAMAS (atribuição de falha) | 10.1145/3797113 | 2026 (ACM) | Supera 12 baselines no Who&When; sem número no resumo | Repetir execuções localiza o agente culpado | abs |
| P13 | Pisama: detecção em camadas | 10.5281/zenodo.20027840 | 2026 pp | κ de MAST ≈ 0 para todos os detectores; US$0,03/traço | Juiz LLM de falha MAS é pouco confiável; usar sinais heurísticos | abs; autor único |
| P14 | ConstraintRot / Governance Decay | 2606.22528 | 2026 pp | Violação 0% → 30% após compactação (59% em alguns modelos); pinagem volta a 0% | Fixar regras e permissões fora do resumo | abs |
| P15 | Harness-Induced Belief Divergence (BIWM) | 2607.04528 | 2026 pp | Divergência de crenças entre harnesses com o mesmo modelo (SWE-bench Verified, TB); sem número | O harness muda o que o agente "acredita"; medir além do pass/fail | abs |
| P16 | MemGuard | 2608.21867 | 2026 pp | +2,4 a +3,5 pts em terminal/SWE (+7,9 no WebArena) | Memória só com sinal do verificador | abs |
| P17 | Single or Multi? Why not both | 2505.18286 | 2025 pp | Ganho do MAS encolhe com modelos melhores; cascata MAS→SAS: +1,1–12% acerto, −20% custo | Começar com agente único e escalar | abs |
| P18 | At Equal Inference Cost… (MA-Evolve) | 2609.04217 | 2026 pp | Time 0,769 vs agente único 0,754 (p=0,80) com 1,8× chamadas (ALFWorld, modelo 7B) | Sem ganho no mesmo orçamento; não é tarefa de código | abs; fora do domínio |
| P19 | Agentic Rubrics | 10.18653/v1/2026.acl-long.697 | ACL 2026 | 54,2% (Qwen3-Coder-30B) no SWE-bench Verified, ≥+3,5 pp sobre o melhor baseline, sem executar testes | Crítico por checklist quando não há ambiente de testes | abs |
| P20 | SWE-Verifier | 2610.30284 | 2026 pp | 75,47→77,20% a 1,09× custo; verifica <4% dos passos | Verificação seletiva, não em todo passo | abs |
| P21 | SWE-Replay | 2601.22129 | 2026 pp | −17,4% custo, até +3,8% em desempenho (SWE-bench Verified) | Escala em tempo de teste reaproveitando trajetórias | abs |
| P22 | SpecRSI | 2610.16491 | 2026 pp | SWE-Pro +6,0 pp com −9,2% tokens | Rascunhar versões antes de avaliar completo | abs |
| P23 | SWE-Router | 2607.00053 | 2026 pp | Mantém "a maior parte" do desempenho do modelo forte; sem número | Roteia depois de poucos turnos do modelo barato | abs |
| P24 | Scrouting / SuperScout | 2608.04804 | 2026 pp | 159/266 vs 158 do melhor modelo a ~1/5 do custo; o handoff, não o roteador, explica o ganho (N=99) | Um "scout" barato antes do modelo caro | abs |
| P25 | AgentRouter | 2609.22951 | 2026 pp | −72% custo, 97,3% da qualidade; RouteLLM −31%, FrugalGPT −44% | Roteamento por passo; ganho de fornecedor, dados anotados deles | abs; cautela |
| P26 | Budget-aware rewards | 2610.28409 | 2026 pp | Treinar penalizando estouro melhora sucesso dentro do orçamento (AppWorld, Qwen 4B/9B) | O agente pode aprender a gastar conforme orçamento declarado | abs |
| P27 | Complexity Trap (masking vs resumo) | 2508.21433 | 2025 pp | Masking corta o custo pela metade e iguala o resumo no SWE-bench Verified; híbrido −7%/−11% | O padrão deve ser mascarar observações | abs |
| P28 | AgentDiet | 10.1145/3797084 | 2026 (ACM) | −39,9% a −59,7% tokens de entrada, −21,1% a −35,9% custo, mesmo desempenho | Remover resultado velho/redundante em tempo de execução | abs |
| P29 | SWE-Pruner / Slipstream / SWE-Edit | 2601.16746 / 2605.08580 / 10.18653/2026.findings-emnlp.485 | 2026 | −23–54% tokens; +8,8 pp e −39,7% latência; −11,8% custo do agente | Podar com meta explícita; validar compactação assíncrona; subagente de edição | abs |
| P30 | Measure Before You Manage | 2608.31057 | 2026 pp | 55 trajetórias; ganho de calibração não transfere; mesmo orçamento de tokens não é mesmo contexto entregue | Calibrar compactação em tarefas retidas | abs |
| P31 | ACM e Context Rot em busca longa | 2607.23809 / 2606.29718 | 2026 pp | Gestão de contexto reduz o pico; amostragem paralela +2,6–4,9% (busca, não código) | Gestão de contexto é escala em tempo de teste; o modelo desiste cedo | abs |
| P32 | Terminal-Bench 2.1 (Benchmarks as Software) | 2611.08417 | 2026-11 pp | ~30% das tarefas com defeito; >+10 pp após reparo; mais tempo fecha lacuna de harness de 20 pp (GPT 5.4) | O orçamento de tempo faz parte da medida; fixá-lo ao comparar com o Claude Code | abs |
| P33 | Claw-SWE-Bench | 2606.12344 | 2026 pp | Sucesso e consumo variam "substancialmente" entre harnesses com modelo fixo; sem número | Adaptador comum para comparar harnesses | abs |
| P34 | AHE-Beta | 2611.24924 | 2026-11 pp | pass@1 21,9→33,3% com −40,8% tokens; acima do Claude Code (num benchmark não citado) | Evoluir o harness por requisitos; benchmark não identificado | abs |
| P35 | SWE-Skills-Bench | 2603.15401 | 2026 pp | 92/98 skills sem efeito; média 76,6→76,9% | Skills ajudam pouco; cortar as sem efeito | abs |
| P36 | SWE-Bench Pro V2 | 2610.24206 | 2026 pp | 480/731 tarefas reparadas; agentes de fronteira chegam a 99,4% | Não usar a versão antiga como medida | abs |
| P37 | PROTEA (UI de grafo de workflow) | 2605.18032 | 2026 pp | 64,3→83,9% e Hit@5 0,30→0,38; estudo formativo com 6 devs | Sobrepor estado e justificativa por nó no grafo | abs; piloto |
| P38 | Delegation to Action Approval | 10.2139/ssrn.7681606 | 2026 pp (SSRN) | n=203; 61% dos que revisam o código aprovam ações sem revisar; supervisão segue exigente | Aprovar por limite de risco, com ações observáveis e reversíveis | abs |
| P39 | Dark Patterns × GUI agents | 10.1145/3772318.3791568 | CHI 2026 | Supervisão humana melhora a evitação, com custo de carga cognitiva (não é código) | A supervisão tem custo; não é grátis | abs |
| P40 | LLM-MAS for SE (revisão) / Coding Kanban | 10.1145/3712003 / 10.1016/j.softx.2026.102919 | 2025 / SoftX 2026 | Revisão; quadro de sessões de agentes em CLI (sem avaliação) | Prior art de UI de sessões; sem evidência de carga cognitiva | abs |

## Síntese

**(1) Topologia.** Há 4 a 5 sucessores de 2026 (P1–P8) com ganho reportado, quase todos em código de função ou raciocínio, não em reparo de repositório. A evidência é média para "denso/dinâmico por dificuldade" (P1: −68% tokens). É fraca para SWE em repositório: o Perplexity também disse que ninguém isolou a reescrita de arestas. Argus (P10) paga +19 pp por papéis explícitos, mas junto com memória e verificação.

**(2) Falhas.** O MAST está sendo usado como métrica de mitigação (P11, −28% a −70% de falhas), mas o juiz automático de MAST fica no nível do acaso (κ≈0, P13, autor único). O consenso é fraco. Há ganho concreto em fixar restrições fora da compactação (P14) e em verificador persistente (P16).

**(3) Um agente vs vários.** É contraditório e depende do domínio. Em orçamento igual, o time não vence (P18, fora de código). O benefício do MAS diminui com modelos melhores (P17). Em SWE, o Argus (P10) usa 1,41× tokens para ganhar acerto. Não achei teste de código com orçamento de tokens igual: lacuna.

**(4) Verificação.** É a evidência mais forte e barata: verificação seletiva (P20, +1,7 pp a 1,09×), rubrica sem executar (P19), reaproveitamento de trajetórias (P21, −17,4%).

**(5) Roteamento.** É promissor, mas só tem preprints: o roteamento deve usar trajetória parcial ou scouting (P23, P24), não só o texto da tarefa. Os −72% do P25 vêm de fornecedor. Nenhum compara com o Claude Code.

**(6) Contexto.** A evidência é forte e converge: mascarar/podar corta 21–60% do custo sem perder acerto (P27, P28, P29). Ressalva: compactar tem risco de segurança (P14) e a calibração não transfere (P30). A literatura já citada diz que, com cache, redução de trajetória não barateou; testar com preço real.

**(7) Humano-agente.** É a evidência mais fraca: nenhuma avaliação CHI/UIST/CSCW de grafo de agentes de código foi encontrada, e o Perplexity chegou à mesma conclusão. Só há pilotos (P37, n=6) e survey (P38, n=203). Isso é lacuna e oportunidade para o editor de grafos do ny-pi.

**(8) Harness.** A evidência é forte: tempo e orçamento mudam a conclusão (P32), o harness muda crenças (P15) e o Claw-SWE-Bench (P33) confirma variação com modelo fixo. Para "superar o Claude Code": fixar orçamento de tempo/tokens, usar TB 2.1 ou SWE-Bench Pro V2 e medir custo por solução.

## Registro de buscas

Total ≈ 33 consultas de base mais 3 de Perplexity `scholar`.

- **arXiv (5):** topologia, falha MAS, um vs vários, masking vs resumo, roteamento por custo. A relevância é fraca; o conteúdo útil veio de OpenAlex.
- **Semantic Scholar (4):** 4 consultas, todas vazias, tratadas como erro (`empty_or_error`); repetidas via OpenAlex/Crossref.
- **OpenAlex (11):** MAST; mesmo orçamento; verificador/best-of-n; roteamento SWE; supervisão/carga cognitiva; scaffold/harness; custo MAS vs único; context rot; mais 3 via `search_papers`.
- **DBLP (3):** 3 consultas, todas vazias (`empty_or_error`), repetidas em OpenAlex.
- **Crossref (4):** roteamento; supervisão de agentes; mais 2 via `search_papers`.
- **CORE (4):** contexto/memória; taxonomia de falha; mais 2 via `search_papers`.
- **Perplexity `scholar` (3):** sucessores de topologia 2026; UI e orquestração CHI/UIST/CSCW; taxonomia de falha e trajetórias.
- **`firecrawl inspect` (7 leituras):** P2, P3, P6, P8, P10, P15, P16.

**Gaps:**
- Semantic Scholar e DBLP vazios; nenhuma consulta sobre CHI/UIST/CSCW trouxe artigo de grafo de agentes de código.
- `retraction: unchecked` em todos; não consultei `api.crossref.org/works/<DOI>` nem `is_retracted` do OpenAlex.
- O snowballing (`related_papers`) não foi rodado: `snowball: not_run`, por orçamento.
- Resumos de P9 e P12 só pela busca (P9 sem número).
- Do Perplexity só verifiquei os links que listei como artigos; o resto são pistas não verificadas.
- Sem índice codegraph: cobertura degradada, usei só `rg`.
