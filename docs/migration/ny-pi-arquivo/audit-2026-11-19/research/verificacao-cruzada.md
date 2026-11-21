# Verificação cruzada da pesquisa (X1–X4, 2026-11-19)

Motivo: as faixas R1, R2, R3, R5, R6 e R7 só conseguiram usar keenable (mais context7 e `web_fetch`); exa devolveu
402 e os demais provedores não foram expostos aos agentes genéricos. Quatro faixas com `perplexity-scout` e
`web-scout` reabriram os achados que sustentam decisões, com outros provedores. Este arquivo **prevalece** sobre os
`r*.md` onde houver correção. Os retornos completos estão nos transcripts da sessão; aqui fica o que muda decisão.

Limite declarado pelas faixas X2 e X3: os `r*.md` chegaram truncados a elas, então parte dos vereditos é por grupo
de achados, não claim a claim.

## 1. Buscas por provedor (AC4)

| faixa | perplexity | octen | youcom | brave | parallel | keenable | outros | buscas | páginas lidas |
|---|---|---|---|---|---|---|---|---|---|
| X1 benchmark e custo | 11 | 4 | 3 | 3 | 2 | 0 | — | 23 | 18 |
| X2 UI multiagente | 0 | 8 | 8 | 7 | 7 | 0 | — | 30 | 22 |
| X3 segurança e harness | 5 | 3 | 2 | 3 | 1 | 0 | — | ≥ 18 (14 contadas) | ~14 |
| X4 TUI, paletas, perf | 0 | 5 | 5 | 7 | 5 | 0 | — | 22 | 18 |
| **X1–X4** | 16 | 20 | 18 | 20 | 15 | 0 | — | **≥ 89** | ~72 |

R1–R7: os totais por faixa estão no "Registro de buscas" de cada `r*.md` (keenable quase sempre; R4 usou bases
acadêmicas: arXiv e OpenAlex funcionaram, Semantic Scholar e DBLP devolveram vazio). Exa (402) e firecrawl não
foram usados em nenhuma faixa. Provedores com resultado: perplexity, octen, youcom, brave, parallel, keenable,
context7, paper_search (8). Tipos de fonte: documentação oficial, changelogs e releases, issues e PRs do GitHub,
artigos arXiv/ACL, blogs de fornecedor, blogs independentes, bases de CVE (GHSA, NVD), notícias de segurança.

## 2. Correções que mudam os documentos

| ref | o que estava | correção | efeito |
|---|---|---|---|
| R1 C8 | Harness Hub: Kimi 71,1; Pi US$ 0,121 vs OpenCode 0,521 por acerto | números de um `notes.md` defasado; `numbers.md` (não lido) traz Pi 0,186 vs OpenCode 0,895 em alto esforço | usar só a ordem ("Pi ~4–5x mais barato que OpenCode por acerto"), não os valores |
| R1 C11 | FrontierHarness, fonte primária desconhecida | Runta + Baseten; outra página cita 26.040 runs em vez de 27.280 | segue fonte única; confiança média |
| R1 C34 | OpenAI abandonou o SWE-bench Verified em 2026-11-16 e recomenda o Pro | data correta 2026-02-23; a recomendação do Pro teria sido retirada em 2026-07-08 (~30% de tarefas quebradas; só fonte secundária) | não tratar o SWE-Bench Pro como referência limpa sem conferir a versão |
| R2 C28 | com cache cheio mascarar economiza 19–29% | 19–36%; mascarar em lote com leitura a 0,1x varia de −13% a +14% | reforça "medir com o preço real" |
| R2 C34 | effort médio −17–29%, baixo −31–46%, acerto −1,8 a −10,3 pp | só "18,4–30,9% de custo com sucesso comparável" está no resumo; os números de effort não foram verificados | tratar a escada de effort como hipótese a medir |
| R2 C39 | conselheiro Opus: +2,7 pp, −11,9% | confirmado, mas com modelos 4.x, não 5.5; beta | hipótese para A/B, não ganho garantido |
| R2 C42 | Haiku no Explore a 1/39 | confirmado em 36 sessões de um blog; outra fonte (não lida) fala em 23–29x | ordem de grandeza confirmada |
| R3 C6 | agent view: estados Working, Needs input, Idle, Completed, Failed, Stopped | grupos lidos: Pinned, Ready for review, Needs input, Working, Completed; subagentes não aparecem como linhas | o vocabulário do doc 04 é escolha nossa, não cópia |
| R3 C38 | `ascii-dag` como opção | é crate Rust, sem binding JS | não é dependência possível |
| R3 C40/C41 | `opentui-island` documenta `attachPiTuiMouseSupport` | não confirmado na página; o pacote exige Bun | não contar com ele; o pi já dá mouse em fullscreen |
| R3 C46 | MCP Tasks experimental (spec 2025-11-25) | a spec 2026-07-28 passa Tasks a extensão `io.modelcontextprotocol/tasks` com `tasks/get` e `tasks/update` | segue fora do barramento interno; texto do R3 desatualizado |
| R3 C35/C36 | Agent Spec: arestas de controle e de dados separadas | página não abriu | a separação é decisão de desenho nossa, sem fonte lida |
| R5 C32/Q1 | Lc 60 como alvo de texto legível | Lc 60 exige ≥ 24 px/400; corpo de 14 px pede Lc 90, mínimo Lc 75 a 18 px | os alvos APCA do doc 03 devem ser Lc 75 para texto e Lc 60 só para rótulo secundário grande; WCAG 2.x 4,5:1 segue como piso normativo |
| R5 C41 | Ghostty `minimum-contrast` padrão 1,1 | a doc não declara padrão | remover a afirmação |
| R5 C51 | compile cache ~10% | confirmado (151 vs 167 ms em 50 execuções); custa na primeira execução; estável a partir do Node 24.15/25.4 | medir no arranque do pi antes de adotar |
| R5 C20 | tmux: 2026 na 3.7 | confirmado; PR #5612 mostra regressão no 3.7b/c: quadro de spinner 9.800 B contra 49 B no 3.5a | animação em tmux 3.7 custa caro: mais um motivo para 15–20 fps e modo sem movimento |
| R6 CVE-2025-55284 | versão corrigida | 1.0.4 (o texto do aviso cita 1.0.24) | usar 1.0.4 |
| R6 CVE-2026-54555 | atribuído ao Claude Code | é do produto `rtk` | corrigir a atribuição |
| R6 C36 (Reddit), GHSA-7g7f-ff96-5gcw | — | não verificáveis | não citar |
| R6 C18 | exemplo com `awk` | números confirmados (69,0–98,6% frágeis); o exemplo não está no resumo | manter só os números |
| R7 C61 | "TDD só funciona atrás de gate obrigatório" | frase não existe na fonte; "reddening" existe; outra fonte: TDD custa 3–8,5x tokens | retirar a frase; manter "reddening" como ideia |
| R7 C63 | detector de laço: aviso em 3, parada em 6 | padrões lidos: observar em 2, bloquear em 3, parar em 6; conta só se o modelo viu o resultado; entrada diferente zera | usar esses limites |
| R7 C20–C22 | Droid: 65,2% vs 57,6% etc. | só "3,0–7,6 pontos acima do Claude Code, até 24% menos custo" foi lido; dado de fabricante | não usar os números finos |
| R7 C40 | grafo de código 0,93 a US$ 0,036 vs grep 0,71 a 0,424 | números lidos, mas o autor criou uma das ferramentas | evidência interessada: medir no `bench/` |
| R7 C6 | "message threads beta 2 nov" | não confirmado | não citar |
| R7 C33 | SKILL.md ≤ 500 linhas, 25.000 tokens retidos | página não carregou | limite de 500 linhas fica como recomendação sem fonte lida nesta rodada |

Confirmados sem correção (página lida por segundo provedor): R1 C7, C10 (preâmbulo 16.581 / 7.025 / 829 tokens),
C17; R2 C9, C22, C24, C37; R3 C4–C5, C14, C17–C18, C32, C34, C39, C45; R5 C33, C44, C47, C55, C56, C57; R6 C2, C4,
C7, C9, C16, C19, C20, C21, C28 e os CVEs 2026-25725, 2026-39861, 2026-25723, 2026-12537, 2025-54135, 2025-54136,
2025-30066; R7 C19, C25, C32, C46.

## 3. Achados novos relevantes

Benchmark e custo:

- Terminal-Bench 4.1 (placar oficial lido): Claude Code + Opus 5.5 65,8% ± 3,1; Claude Code + Fable 5.2 65,8% ±
  2,8 com 3,5x o custo; Codex + GPT-6.2 62,1% ± 2,3. Sem linha do pi. Reexecução do mesmo modelo variou 89,4 →
  84,6% (snippet): piso de ruído de ~5 pp.
- Effort acima do padrão não melhora de forma confiável (ServiceNow, 200 tarefas ×3, snippet); desligar thinking
  não piorou o Claude Code (+2,2 pp, não significativo; arXiv 2610.04433, lido).
- Claude Code preserva o cache ao mudar effort nos modelos 5.5 pela API direta; não em Bedrock, Vertex ou gateway
  (documentação lida). Como o ny-pi passa por caminho próprio, medir antes de assumir.
- Número de turnos explica 84% da variância do custo; 98,6% dos tokens vêm do cache (arXiv 2610.15093, lido).

UI multiagente:

- Produtos lidos: Cursor Agents Window, Antigravity Agent Manager (modo local contra worktree novo), Codex (threads
  de subagente), Conductor, Vibe Kanban, claude-squad, Zed (ACP), Kiro, LangSmith Studio (modo grafo e time-travel).
  Terragon encerrou em 2026-02-09; Flowise teria sido descontinuado (fonte de terceiros). Unidade de isolamento
  dominante: worktree ou VM por agente.
- `zoetrope`: TUI em Rust que lê os transcripts do Claude Code e do Codex e desenha a sessão como grafo ao vivo,
  com linha do tempo; só leitura. É a referência mais próxima da fase 1 do Plano A.
- Layout em Node: `@dagrejs/dagre` 3.1.3 (MIT, cálculo puro), `d3-dag` 1.3.0 (MIT, ESM), `elkjs` 0.12.1 (EPL-2.0 ou
  GPL-3.0+, ~500 KB: atenção à licença). Não existe biblioteca Node de DAG para terminal pronta.
- Grafo manual contra dinâmico: continua sem comparação direta. Propriedade de escrita por nó aparece em duas
  fontes (arXiv 2607.21909; issue claude-code 109707).

Segurança:

- Extensão falsa do Claude Code no marketplace da Cursor por ~11 h (2026-10-29), até 5.000 usuários, backdoor SSH.
- MCPhantom (2026-11-03): agentes preenchem nomes de servidores MCP de memória; servidor Puppeteer de referência
  arquivado com RCE sem correção.
- Pacote npm malicioso de MCP `@fdcasj_dfew/md-doc-mcp` (GHSA-m5xq-h2p4-962g, 2026-11-19).
- Claude Code 2.1.323 corrigiu allow de Bash com curinga e Write/Edit contornando deny de Read; 2.1.328 traz
  `onFailure: block` em hooks. O contorno Write/Edit × Read é da mesma classe do achado 7 do guard.
- Tudo reforça o item "fixar versão dos servidores MCP" (`mcp.json.example` usa `npx -y` sem versão).

Harness e terminal:

- pi-code está em 1.10.1 (2026-11-17), não 1.9.0; pi 1.5.2 é o atual.
- Claude Code em fullscreen renderiza só as mensagens visíveis (memória constante); kimi-code mantém 50 turnos e
  faz cache de `render(width)`; oh-my-pi: 148 → 21 ms com cache de bloco.
- Consulta OSC de paleta no foco já bloqueou o Codex por até 15 s: consultas ao terminal precisam de espera
  limitada.
- Python 3.15 com imports preguiçosos (PEP 810): CLI de 81 → 18 ms (autor único, snippet). Coerente com a medição
  local do guard (26,5 → 14,9 ms com imports tardios).
- WCAG 3 segue rascunho e o algoritmo de contraste não está definido: APCA é apoio, não norma.

## 4. Lacunas que ficaram

Agent Spec, MCP elicitation, Dify, ponte WebSocket com xyflow, hex opacos do tema daltônico do Primer, fonte
primária de Okabe-Ito, FPS e CPU oficiais de Codex, Gemini e Amp, changelogs do Claude Code 2.1.319/321, avisos do
MCP TS SDK fora da GitLab, primárias da OpenAI (bloqueio 403), e a comparação direta entre grafo manual e
orquestrador dinâmico.
