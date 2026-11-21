# 05 — Plano para acertar mais que o Claude Code custando menos

Estado: plano. Nada aqui foi executado (pedido do dono: só documento). Evidência: `research/r1-benchmarks.md` (R1 Cn),
`research/r2-custo.md` (R2 Cn), `faixas/r4-artigos.md` (Pn), `research/r7-melhorias-harness.md` (R7 Cn) e
`research/verificacao-cruzada.md`. Itens marcados "snippet" nos arquivos de pesquisa não tiveram a página lida.

## 1. Onde estamos (medição local, `docs/bench/BASELINE-VANILLA-2026-11.md`, 2026-11-14)

| modelo | braço | acerto | custo mediano US$ | tempo p50 s |
|---|---|---|---|---|
| Sonnet 5.5 | cc-vanilla | 65/76 (85,5%) | 0,0645 | 17,1 |
| Sonnet 5.5 | pi-vanilla | 67/76 (88,2%) | 0,0231 | 13,5 |
| Sonnet 5.5 | ny-pi | 58/76 (76,3%) | 0,0854 | 18,5 |
| Opus 5.5 | cc-vanilla | 16/22 (72,7%) | 0,1585 | 34,3 |
| Opus 5.5 | pi-vanilla | 18/22 (81,8%) | 0,0780 | 27,6 |
| Opus 5.5 | ny-pi | 17/22 (77,3%) | 0,2462 | 52,2 |

Leitura:

- O pi puro já vence o Claude Code em acerto e custa cerca de um terço. O ny-pi hoje piora o pi: 9–12 pp a menos
  e 3,3x o custo no Sonnet. A meta do dono se alcança mais tirando peso do ny-pi do que acrescentando recurso.
- A perda está na suíte S4 (plano): 0,42 contra 0,67–0,71. Causa registrada: sem interface, o ny-pi entrega o plano
  e não implementa.
- No S1 (comportamento) o ny-pi é o melhor (0,97); no S2 (4 tarefas do Terminal-Bench) os três empatam.
- Com 76 unidades o intervalo de confiança é largo: os números dão ordem de grandeza, não diferenças pequenas.

## 2. O que a literatura diz que move acerto e custo

| alavanca | efeito medido | fonte | confiança |
|---|---|---|---|
| Modelo, não harness, explica o custo | modelo 92,8% da variância, harness 2,3%; 64,5% do custo vai a tentativas que falham; passos predizem custo (+0,51), tamanho do prompt não | R1 C11 | média (fonte única) |
| Harness muda custo mais que acerto | Claude Code custa 2,0x o pi (SWE-bench Lite) e 1,5x (TB 2.0); efeito no acerto ±2% a ±5% | R1 C7, C10 | média-alta |
| Crítico independente na conclusão | +5,9–9,5 pp (TB), +3,9–6,6 pp (SWE) a 1,0–1,25x | R1 C17 (arXiv 2610.34577) | alta (página lida) |
| Verificação seletiva | +1,7 pp a 1,09x verificando < 4% dos passos | R4 P20 | média (preprint) |
| Checklist antes de encerrar, detecção de laço, contexto local | 52,8 → 66,5% no TB 2.0, efeito individual não separado; middleware +2,2 pp em outra ablação | R1 C18, C19 | média |
| Esforço máximo o tempo todo | 53,9% contra 63,6% em `high`, por estouro de tempo | R1 C18 | média |
| Prompt de sistema e arquivos de contexto longos | prompt sozinho −2,3 pp; AGENTS.md não melhora e custa > 20% | R1 C19, C21 | alta para C21 (página lida) |
| Skills | 92 de 98 sem efeito; média 76,6 → 76,9% | R4 P35 | média |
| Mascarar ou podar observações | −21% a −60% de custo sem perder acerto em estudos sem cache; com leitura de cache a 0,05x, mascarar a cada turno encarece (+101% no caso medido) | R4 P27–P29; R2 C28 | contraditória: testar com preço real |
| Limiar de compactação | 160k–380k não mudou o acerto; a primeira compactação perde ~1/3 das regras; violação de regra 0% → 30% após compactar, fixar regras volta a 0% | R2 C30; R4 P14 | média |
| Effort | `medium` −17–29% de custo, `low` −31–46%, com −1,8 a −10,3 pp se fixo (números não achados no resumo do artigo); effort acima do padrão não melhorou de forma confiável em outra medição | R2 C34; verificação X1 N8 | baixa: hipótese a medir |
| Modelo barato em leitura | Haiku 5.5 no Explore a 1/39 do custo do Opus com recall igual, só em inventário | R2 C42 | baixa (teste estreito) |
| Roteamento por trajetória parcial ou "scout" | desempenho do modelo forte a ~1/5 do custo; o ganho vem do handoff | R4 P24 | média (preprint, N=99) |
| Cache | TTL de 1 h cego em subagentes +8,6%; prefixo por tipo e conteúdo dinâmico depois do breakpoint −13,6% | R2 C22 | baixa (um desenvolvedor, modelado) |
| Ruído de medição | execução única varia 2,2–6,0 pp; 98 tarefas com 19% de troca só detectam ±12 pp; recursos mudam 6 pp no TB | R1 C25, C32, C33 | alta (páginas lidas) |
| Integridade do benchmark | ~30% das tarefas do TB com defeito, > +10 pp após reparo; `reward.txt` plantado vira aprovação se o verificador estoura o tempo | R4 P32; R1 C36 | média-alta |

## 3. Estratégia

Três frentes, nesta ordem. Cada mudança entra como um braço no `bench/`, é comparada com o braço anterior pela
mediana das razões por tarefa (regra já usada no gate) e só fica se o intervalo de confiança excluir piora.

### Frente 1 — Parar de perder para o pi puro (acerto +9–12 pp, custo −60%)

1. Corrigir S4: quando o pedido é "planeje e implemente" sem interface, o ny-pi precisa implementar. Medir S4 com
   k ≥ 3, com e sem a camada de plano. Meta: S4 ≥ 0,67.
2. Bisseção do overlay: um braço por componente injetado no turno (CLAUDE.md, regras, catálogo de ~70 skills, lista
   de ~55 agentes, hooks de mensagem, extensões que acrescentam texto). Mantém só o que paga o próprio custo.
   Hipótese a testar: o catálogo e as regras explicam a maior parte dos 3,3x.
3. Perfil "enxuto" para modo sem interface e para subagentes de leitura: prefixo mínimo (sem catálogo de skills,
   sem regras de Git), com as regras duras fixadas. `extensions/headless-lean` já existe; medir o que ele corta.
4. Teto: prompt de sistema do braço ny-pi ≤ 1,3x o do pi-vanilla em tokens, verificado no CI
   (`scripts/ci/instruction_budget.py` já mede orçamento de instruções).

Critério de saída: ny-pi ≥ pi-vanilla em acerto (IC pareado não exclui zero ou é positivo) e custo mediano ≤ 1,2x o
pi-vanilla nas mesmas 76 unidades.

### Frente 2 — Passar do Claude Code e do pi puro em acerto (+4–9 pp a ≤ 1,25x)

5. Crítico independente na conclusão, uma rodada, contexto limpo, com checagem executável; sem gate duro. Só para
   tarefas com mudança de código. (R1 C17; pesquisa 2026-11-13 C12.)
6. Verificação seletiva: o crítico só é chamado quando há sinal (edição sem teste rodado depois, teste que falhou
   e "sumiu", conclusão sem comando de verificação). (R4 P20.)
7. Checklist de encerramento e detector de laço: lembrete único de conferir o enunciado antes de concluir; aviso em
   3 chamadas idênticas e parada em 6. (R1 C18, C19; R7 C22, C63.) O detector `tool-em-laço` de
   `extensions/diagnostico` hoje só avisa (8 ocorrências nos logs): passar a interromper.
8. Contexto local no início em tarefa de terminal: diretório, ferramentas disponíveis, versões (uma chamada).
   Ataca "comando não encontrado" (R1 C26, não lido).
9. Orçamento de tempo e de passos visível ao agente, com aviso de tempo; effort alto no plano e na verificação,
   médio na execução. (R1 C18; R4 P32: o orçamento de tempo faz parte da medida.)
10. Parada antecipada de tentativa sem progresso (N passos sem mudança de estado do repositório nem teste novo).
    Ataca os 64,5% do custo gastos em tentativas que falham. (R1 C11.)

Critério de saída: ny-pi > cc-vanilla em acerto com IC95 pareado excluindo zero em S1+S4+S5 (k ≥ 3) e em pelo
menos 30 tarefas do Terminal-Bench 2.1; custo mediano ≤ cc-vanilla.

### Frente 3 — Baixar o custo ao mínimo sem perder o que a frente 2 ganhou

11. Medir primeiro: registrar por requisição leitura, escrita (por TTL) e entrada sem cache, por tipo de agente. O
    log atual não grava `cache_creation` (achado da análise de logs). Meta: sessão principal ≥ 90% de leitura a
    partir da segunda chamada.
12. TTL por papel: 1 h na sessão principal e em tipos de subagente reusados em menos de 1 h; 5 min nos de passagem
    única; a tarefa depois do último breakpoint. (R2 C22.)
13. Prefixo dos filhos: scouts e leitores não recebem catálogo de skills nem regras de entrega. Estimativa da
    pesquisa: 10–25k tokens a menos por filho. Medir tokens da primeira requisição de cada tipo de agente.
14. Modelo por papel: Haiku 5.5 em `Explore`, `code-mapper`, `gate-runner` e `research-scout`, com A/B em 20
    consultas reais antes (o teste da fonte cobre só inventário). Isso reverte, só para leitura, a decisão de
    2026-11-15: é decisão do dono.
15. Effort em escada: `medium` por padrão, `low` em execução mecânica, sobe para `high` quando o gate falha.
16. Truncar na fonte (limites de saída de ferramenta, leitura por fatias) em vez de limpar contexto depois; não
    mascarar a cada turno com cache ativo. (R2 C28.)
17. Compactação: testar 200–250k contra 400k em sessões longas; reinjetar as regras duras depois de compactar.
    (R2 C30; R4 P14.)
18. Congelar modelo, effort, ferramentas e thinking dentro de uma sessão; avisar o custo de recache ao trocar.
    (R2 C9, C10; R7 C9, C19.)
19. Batch API para trabalho não interativo (evals do `pelo-em-ovo`, varreduras): −50%. (R2 C5.)
20. Orquestrador: não usar Fable como padrão de código sem A/B local (R2 C37 contra C38, fontes em conflito);
    avaliar executor Sonnet com conselheiro Opus (R2 C39, beta) e "scout" barato antes do modelo caro (R4 P24).

Critério de saída: custo por tarefa aprovada ≤ 0,6x o do cc-vanilla, sem queda de acerto fora do intervalo.

## 4. Como medir sem se enganar

1. Repetições: k ≥ 3 nas suítes de decisão; relatar IC95 pareado e McNemar; rejeitar veredito de ganho menor que
   3 pp sem intervalo. `bench/stats.py` já tem `paired_ci` e `power`: falta impor o piso de k.
2. Métrica principal: custo por tarefa aprovada, mais custo gasto em tentativas reprovadas. Acrescentar a coluna
   em `bench/report.py`.
3. Igualar condições: versão exata do benchmark (Terminal-Bench 2.1, SWE-Bench Pro V2: R4 P32, P36), recursos do
   contêiner, orçamento de tempo, teto de turnos e nível de effort (medir em dois níveis: R1 C8 mostra que o effort
   inverte o vencedor).
4. Integridade: rodar o agente sem root, isolar o diretório do verificador e tratar estouro de tempo do
   verificador como erro. Teste negativo com agente que planta `reward.txt`. (R1 C36.)
5. Confiabilidade do executor antes de gastar: os defeitos do `bench/` em `01-gaps-bugs-logs.md` (retomada que
   quebra com linha truncada, custo de runs com erro fora do teto, processos netos vivos depois do tempo limite,
   etapas sem tempo limite) desperdiçam dinheiro e distorcem o custo medido.
6. Braços de referência: cc-vanilla, pi-vanilla e mini-swe-agent (piso barato, R1 C5, C8, C13).
7. Ampliar S2 de 4 para ≥ 30 tarefas do Terminal-Bench no tier `full`, sob demanda. O placar oficial lido em
   2026-11-19 é o 4.1 (Claude Code + Opus 5.5: 65,8% ± 3,1; sem linha do pi): fixar a versão antes de comparar.
8. Piso de ruído: a reexecução do mesmo modelo nas mesmas tarefas variou ~5 pp (89,4 → 84,6%, snippet).

## 5. Ordem de execução e custo estimado de medição

| passo | o que roda | unidades | custo estimado |
|---|---|---|---|
| 0 | corrigir executor do bench e métrica de custo por aprovada | sem modelo | 0 |
| 1 | S4 com e sem plano, k=3 | ~40 runs | ~US$ 5 |
| 2 | bisseção do overlay, 5 braços, S1+S4+S5, k=2 | ~380 runs | ~US$ 30 |
| 3 | crítico, checklist e laço, 3 braços, k=3 | ~340 runs | ~US$ 30 |
| 4 | Terminal-Bench 2.1, 30 tarefas, 3 braços, k=3 | 270 runs | ~US$ 60–120 |
| 5 | frente 3, um braço por alavanca, S1+S4+S5, k=2 | ~600 runs | ~US$ 45 |

Estimativas a partir do custo mediano por run do baseline (US$ 0,02–0,25); o Terminal-Bench custa mais por tarefa
(mediana 0,09–0,15 nas 4 tarefas medidas). São ordens de grandeza, não orçamento fechado.

## 6. O que não fazer

- Acrescentar instruções, skills ou agentes ao braço de benchmark sem braço de controle.
- Multiagente por padrão em tarefa de código: −39% a −70% em trabalho sequencial, 1,4–3,3x de tokens.
- Trocar o formato de edição: o ganho relatado é de benchmark sintético do autor (R1 C20; R2 C47).
- Índice semântico de código antes de medir se o agente usa o codegraph (R7 C40, C44).
- Esforço máximo permanente.
- Declarar vitória com uma rodada ou com diferença menor que 3 pp.

## 7. Riscos

- A bisseção pode mostrar que regras úteis no trabalho diário custam acerto no benchmark. Saída: dois perfis
  (interativo completo, sem interface enxuto), medidos em separado; o S1 de comportamento protege o perfil
  interativo.
- Otimizar para as 76 unidades locais e não generalizar. Saída: Terminal-Bench 2.1 e SWE-Bench Pro V2 como
  confirmação externa a cada marco.
- Preços e regras de cache mudam: toda decisão de custo cita a página de preços lida no dia.

## 8. Registro da pesquisa

Buscas e fontes por tema em `research/` (R1, R2, R3, R5, R6, R7), artigos em `faixas/r4-artigos.md`, totais por
provedor e a verificação por segundo provedor em `research/verificacao-cruzada.md`.
