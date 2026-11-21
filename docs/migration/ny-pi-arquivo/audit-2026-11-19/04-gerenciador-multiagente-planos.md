# 04 — Gerenciador multiagente com grafo: três planos

Estado: proposta. Nada aqui foi implementado (pedido do dono: só o plano). Evidência externa em
`research/r3-ui-multiagente.md` (Cn), `faixas/r4-artigos.md` (Pn) e nas pesquisas de 2026-11-11/13 em
`~/.pi/agent/claude-home/docs/research/`. Achados marcados "snippet" em R3 não tiveram a página lida; a verificação
cruzada está no fim deste arquivo.

## 1. O que o dono pediu

Uma interface que esconde o chat e abre um gerenciador onde:

- o agente principal cria subagentes e o usuário os acompanha e controla;
- o usuário cria outros agentes e os interconecta;
- o trabalho é desenhado como grafo: nós são agentes com responsabilidades, arestas são conexões.

## 2. O que já existe e será reaproveitado (fatos lidos no código em 2026-11-19)

| peça | onde | o que dá ao gerenciador |
|---|---|---|
| Diretório de frota | `pi-code/extensions/subagent/fleet/types.ts` | um `RunRecord` JSON por run (agente, pai, profundidade, modelo, estado, tokens, custo), transcript por run, caixa de entrada, marcador `.stop`; a árvore inteira (profundidade 1–3) lida do disco, sem RPC |
| Painel de frota | `subagent/fleet-ui/` | lista, visor de transcript, envio de mensagem a um run vivo (`send`), parar |
| Modo time (opt-in) | `subagent/team/types.ts` | mensagens tipadas (`question, answer, info, blocker, handoff`), quadro append-only, tarefas com `files[]` e claim exclusivo (`O_EXCL`), orçamento de envios por run (30) e por árvore (300) |
| Roteamento | `subagent/routing/`, `~/.pi/agent/subagent-routing.json` | modelo e effort por chamada, filho nunca acima do pai |
| Grafo de unidades | `skills/graph-engineering/scripts/unit_graph.py` | formato `{id, goal, files, after, tier, acceptance, agent, risk}`; `check` devolve ondas, caminho crítico e erros; `suggest` deriva arestas do codegraph |
| Tela cheia em extensão | `ctx.ui.custom()` do pi (docs `tui.md`) | um componente assume a área interativa; em modo fullscreen recebe mouse; `ScrollView`, `SelectList`, `MouseRegion` prontos |
| Processo pi controlável | `pi --mode rpc` (docs `rpc.md`) | um nó pode ser um processo pi comandado por JSON, sem TUI |
| Sincronia plano/agentes/runs | `docs/sync-observabilidade.md` (D1–D15, corrigidos em 2026-11-18) | canal `pi-code:plan-state` e estados de run consistentes entre painel, runs e plano |

Conclusão: falta a visão (grafo e gerência), o formato declarativo do grafo e a ligação "grafo → execução". O
transporte, o estado e o controle de runs já existem.

## 3. O que a evidência diz (limites que os três planos respeitam)

1. Multiagente só paga em trabalho decomponível: +80,8% decomponível, −39% a −70% sequencial (arXiv 2512.08296;
   R3 C47). Logo o gerenciador precisa mostrar e validar a decomponibilidade, não só permitir ligar caixas.
2. Escrita em fluxo único; agentes extras entram como revisores ou consultores (Cognition, R3 C20, página lida).
3. Coordenação por estado compartilhado (claims, feed de ações) rende mais que chat livre: +4,5 a +5,3 pp no
   SWE-Bench Pro; a interferência sobe 3–4x de 2 para 5 agentes (ESEM 2026, pesquisa de 2026-11-13 C40).
4. Crítico independente é o melhor custo-benefício (+3,9–6,6 pp a ~1,0x; arXiv 2610.34577) e verificação seletiva
   também (R4 P20: +1,7 pp a 1,09x). Aresta de revisão deve ser de primeira classe.
5. Topologia por dificuldade reduz custo (R4 P1: +14,6% pass@1 e −68% tokens, código de competição). Evidência
   fraca para reparo em repositório.
6. Grafo desenhado à mão contra orquestrador dinâmico: nenhuma avaliação encontrada (R3 C51; R4 tema 7, só pilotos
   com n=6). É a maior incerteza: o editor pode não melhorar o acerto. Por isso o Plano A mede antes de crescer.
7. Produtos de referência (R3): agent view do Claude Code agrupa por estado e omite subagentes (C5, C6, página
   lida); Warp classifica notificações em Complete/Request/Error só para o pai (C14); Factory mostra workers,
   marco e log, com custo só agregado (C17, C18). Falhas a evitar: esconder filhos e esconder custo por agente.
8. Grafo como visão derivada de arquivo declarativo, não como estado separado (ADK, Microsoft Agent Framework,
   AutoGen Studio; R3 C32–C36, snippet). Arestas de controle separadas das de dados (Agent Spec, C36).
9. Protocolos externos não servem de barramento interno: A2A é entre organizações, ACP é UI↔agente, MCP Tasks é
   experimental (R3 C44–C46).
10. Supervisão tem custo cognitivo e 61% aprovam ações sem revisar (R4 P38, n=203): aprovar por limite de risco,
    com ações observáveis e reversíveis, e não por prompt a cada passo.

## 4. Base comum aos três planos

### 4.1 Arquivo de grafo (fonte única)

`<projeto>/.pi/graphs/<nome>.graph.json` (versionável). O arquivo é a verdade; toda tela é derivada dele e do
diretório de frota. Esquema v1:

```json
{
  "v": 1,
  "name": "auth-refactor",
  "budget": { "usd": 12, "runs": 24 },
  "nodes": [
    { "id": "lead", "agent": "main", "role": "orquestra, integra e julga", "writes": [] },
    { "id": "api", "agent": "go-service-engineer", "role": "handlers de sessão",
      "writes": ["internal/auth/**"], "model": "anthropic/claude-sonnet-5-5", "effort": "medium",
      "acceptance": "go test ./internal/auth/... verde", "budget": { "usd": 3, "turns": 120 } },
    { "id": "rev", "agent": "security-reviewer", "role": "revisa o diff de auth", "writes": [] }
  ],
  "edges": [
    { "from": "lead", "to": "api", "kind": "delegates" },
    { "from": "api", "to": "rev", "kind": "review" },
    { "from": "api", "to": "web", "kind": "after" },
    { "from": "api", "to": "web", "kind": "data", "channel": "handoff" }
  ]
}
```

- `kind`: `delegates` (quem cria quem; define a árvore e a autoridade), `after` (controle: só começa depois),
  `review` (o destino critica a saída da origem, com checagem executável), `data` (canal de mensagem tipada do modo
  time), `consults` (pergunta e resposta, sem escrita).
- `writes`: globs de propriedade. Validação antes de iniciar: dois nós na mesma onda não podem casar o mesmo
  arquivo; conflito vira serialização automática (aresta `after`) ou recusa.
- Compila para o formato de `unit_graph.py` (`after` e `files`), então ondas, caminho crítico e ciclos já têm
  validador testado.
- Exporta Mermaid para colar em documento. Importa de um plano aprovado (`/plan`) e de um unit graph existente.

### 4.2 Vocabulário de estado (fechado)

`aguardando` (dependência), `rodando`, `precisa de você` (pergunta, permissão, bloqueio), `ocioso`, `concluído`,
`falhou`, `parado`. Cada estado tem glifo, rótulo de texto e cor (nunca só cor). Origem: R3 C5, C14.

### 4.3 Regras de segurança e custo

- Autoridade: um nó nunca recebe mais ferramentas, modelo ou permissão que quem o delega (regra atual de filho ≤
  pai). O grafo não concede permissão; só a restringe.
- Mensagem entre agentes é dado não confiável, nunca instrução com autoridade do usuário (já é a regra do `send`).
- Tetos: USD e runs por nó e por grafo, herdando os limites atuais (64 runs e 20 USD por faixa, profundidade 3,
  4 escritores na raiz). Estouro pausa o nó e marca `precisa de você`.
- Custo sempre visível por nó e acumulado (tokens, USD, cache lido), vindo do `RunRecord`.
- Escrita: por padrão um escritor por conjunto de arquivos; paralelismo só com `writes` disjuntos.

### 4.4 Orçamento de performance da tela

- Atualização por `fs.watch` no diretório de frota com coalescência de 100 ms; sem polling abaixo de 250 ms.
- Layout recalculado só quando nós ou arestas mudam; mudança de estado repinta só a caixa do nó.
- Meta medida com o medidor existente (`bin/ny-pi-mock-src/perf.mjs`): ≤ 1% de um núcleo em repouso e ≤ 5% com 12
  nós ativos; quadro ≤ 8 ms com 40 nós e 80 arestas.

## 5. Plano A — Gerenciador em tela cheia no terminal (recomendado para começar)

**Ideia.** Uma extensão (`extensions/maestro/`) registra `/maestro` e um atalho. Ao abrir, `ctx.ui.custom()` assume
a tela (o chat some, a sessão segue viva) e mostra três visões alternáveis por tecla: Frota, Grafo e Nó.

```
┌ maestro · auth-refactor · 5 nós · 2 rodando · 1 precisa de você · US$ 1,84 / 12,00 ──────────────────┐
│  ┌─────────────┐      ┌──────────────────┐      ┌───────────────────┐                                │
│  │ ● lead      │─────▶│ ◐ api            │═════▶│ ◌ rev             │   ─▶ delega   ═▶ revisa        │
│  │ main        │      │ go-service-eng.  │      │ security-reviewer │   ┄▶ depois   ⇢ dados          │
│  │ orquestra   │      │ internal/auth/** │      │ aguardando api    │                                │
│  └─────────────┘      │ 41t · US$ 0,92   │      └───────────────────┘                                │
│         │             └──────────────────┘                                                           │
│         │             ┌──────────────────┐                                                           │
│         └────────────▶│ ? web            │  ◀ precisa de você: "posso trocar o cookie por header?"   │
│                       │ web-platform-eng │                                                           │
│                       └──────────────────┘                                                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ api › go test ./internal/auth/... (12 s)                                                             │
│ ↹ visão  ↑↓←→ nó  ⏎ abrir  m mensagem  n novo nó  e aresta  s parar  r retomar  v validar  q chat    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Visões.**

- Frota: tabela agrupada por estado, `precisa de você` no topo, uma linha por run de qualquer profundidade (agente,
  resumo, idade, turnos, custo). Espaço mostra prévia do transcript; Enter abre o nó.
- Grafo: layout em camadas (algoritmo de Sugiyama: quebra de ciclos, camadas, redução de cruzamentos) desenhado com
  box-drawing; caixa de 3–4 linhas. Navegação por setas; mouse opcional em fullscreen. Abaixo de 80 colunas o grafo
  vira lista indentada com as arestas em texto.
- Nó: cartão editável (papel, agente, modelo, effort, `writes`, aceitação, teto) e transcript ao vivo.

**Ações e como se ligam ao que existe.**

| ação | mecanismo |
|---|---|
| criar nó e arestas | edita o arquivo de grafo (escrita atômica) e revalida com `unit_graph.py check` |
| executar o grafo | o gerenciador envia ao agente principal uma mensagem estruturada com o caminho do arquivo; o principal dispara as ondas com a ferramenta `subagent`, como hoje; cada run grava o `id` do nó no seu registro |
| o principal cria um subagente por conta própria | aparece como nó "fora do grafo" (tracejado), ligado ao pai; `a` adota o nó no arquivo |
| mensagem a um nó | `send` do subagent (caixa de entrada do run) |
| conectar dois nós por dados | aresta `data` liga o modo time só entre os dois (rota restrita), com o orçamento de envios existente |
| parar, retomar | marcador `.stop` e `resume` existentes |
| responder pergunta ou permissão | a caixa `precisa de você` leva ao pedido; a resposta volta pelo canal que o pediu |

**Fases.**

1. Somente leitura: Frota e Grafo derivados do diretório de frota (árvore real, sem arquivo). Entrega o valor de
   observabilidade e mede custo de render. Aceitação: toda run de profundidade 1–3 aparece em até 300 ms.
2. Controle: mensagem, parar, retomar, caixa `precisa de você` cobrindo filhos.
3. Arquivo de grafo: criar e editar nós e arestas, validar propriedade de arquivos e ondas, exportar Mermaid,
   importar de plano aprovado.
4. Execução guiada: o principal executa o grafo; nós fora do grafo são adotáveis.
5. Medição: tarefa pareada no `bench/` (mesmo modelo, mesmo teto) comparando "principal decide" contra "grafo
   desenhado"; se o grafo não empatar em acerto com custo menor ou igual, ele fica como visão e não como modo de
   trabalho.

**Aceitação (resumo).**

- WHEN o usuário abre `/maestro` THE SYSTEM SHALL esconder o chat sem interromper o turno em curso e restaurá-lo
  com `q`.
- WHEN um run muda de estado THE SYSTEM SHALL refletir o estado na caixa do nó em até 300 ms.
- IF dois nós da mesma onda têm `writes` sobrepostos THEN THE SYSTEM SHALL recusar a execução e mostrar o arquivo.
- WHEN o terminal tem menos de 80 colunas THE SYSTEM SHALL mostrar o grafo como lista, sem linha além da largura.
- WHEN um nó atinge o teto de custo THE SYSTEM SHALL pausá-lo e marcá-lo `precisa de você`.

**Custo e risco.** Esforço médio (4–6 semanas de uma pessoa com agentes): layout em camadas e roteamento de
arestas em células são a parte difícil. Dependência: nenhuma obrigatória; `@dagrejs/dagre` 3.1.3 (MIT, cálculo puro)
ou `d3-dag` podem calcular camadas e ordem; o desenho em células é próprio, pois não existe biblioteca Node de DAG
para terminal (`ascii-dag` e `rataflow` são Rust). Referência de UX para a fase 1: `zoetrope` (grafo ao vivo a
partir de transcripts, só leitura). Risco: grafos com mais de
~25 nós ficam ilegíveis em terminal; mitigação: recolher subárvores e filtrar por estado. Rollback: remover a
extensão; nenhum formato existente muda.

**Por que primeiro.** Reaproveita tudo o que existe, não abre porta de rede, funciona por SSH e tmux e entrega valor
já na fase 1.

## 6. Plano B — Canvas web local ligado ao terminal

**Ideia.** `/maestro web` sobe um servidor em `127.0.0.1` em porta aleatória, com token de uso único na URL, e abre
um canvas (`@xyflow/react` com auto-layout ELK) para desenhar o grafo com arrastar e soltar, minimapa, zoom e
edição de arestas. O terminal continua sendo o lugar de aprovar, interromper e responder. Fonte de verdade: o mesmo
arquivo de grafo; o servidor só lê o diretório de frota e escreve o arquivo.

**Arquitetura.** Processo auxiliar Node iniciado pela extensão; WebSocket com eventos `graph.changed`,
`run.changed`, `transcript.append`; comandos do navegador limitados a editar o arquivo de grafo e pedir ações que o
terminal confirma (parar, executar). O navegador nunca recebe credencial nem executa ferramenta.

**Vantagens.** Edição de grafo muito superior (arrastar, ligar portas, agrupar), legível com 50+ nós, time-travel
visual por run, compartilhável em segunda tela.

**Custos e riscos.**

- Segunda superfície para manter (React, bundle) e teste E2E de navegador.
- Superfície de ataque: porta local. Exige bind só em loopback, token, verificação de `Origin` e `Host` (DNS
  rebinding), sem CORS aberto, encerramento com a sessão. Sem isso, qualquer página aberta no navegador poderia
  mandar comandos.
- Não funciona em SSH puro sem encaminhar porta.
- Nenhuma fonte lida mostra produto com canvas web sincronizado a agente de terminal (R3, padrão 9): é projeto
  novo, sem referência de UX validada.

**Fases.** (1) visualizador somente leitura; (2) edição do arquivo; (3) ações confirmadas no terminal;
(4) reprodução de execução (linha do tempo por nó). Esforço: grande (8–10 semanas). Depende do esquema de arquivo e
do vocabulário do Plano A; faz sentido só depois da fase 3 do A.

## 7. Plano C — Runtime de grafo (o grafo executa, o modelo não orquestra)

**Ideia.** O grafo deixa de ser sugestão para o agente principal e vira programa: um escalonador determinístico (em
código, sem LLM) lê o arquivo, inicia cada nó como processo `pi --mode rpc`, entrega as entradas pelas arestas,
aplica tetos, roda as arestas de revisão e grava checkpoint por nó. O agente principal vira um nó (`lead`) chamado
só onde há julgamento: decompor, decidir entre resultados, aceitar.

**O que acrescenta.**

- Custo: cada handback que hoje acorda o principal relê o contexto dele (medido no Claude Code: ~0,12 USD a 300k
  tokens por turno; `swarm-orchestration`). O escalonador faz as transições mecânicas sem LLM.
- Reprodutibilidade: mesma entrada, mesma ordem de nós; retomada do checkpoint sem refazer nós concluídos (padrão
  do LangGraph, pesquisa 2026-11-13 C10).
- Arestas com contrato: `data` carrega um JSON com esquema; `review` exige checagem executável; `gate` roda um
  comando e só segue com saída 0.
- Topologia adaptativa: um nó `router` barato escolhe o subgrafo por dificuldade (R4 P1, P17, P24).
- Mutação proposta: o `lead` pode propor mudança no grafo (diff do arquivo) que o usuário aprova na tela.
- Time-travel: reabrir um nó a partir do checkpoint com entrada editada, criando ramo novo.

**Custos e riscos.**

- É um orquestrador novo: escalonador, checkpoints, contratos de aresta, recuperação de falha, cancelamento em
  árvore. Esforço muito grande (3–4 meses) e manutenção própria fora do pi-code.
- Evidência contrária: trabalho sequencial perde com divisão (item 1 da seção 3) e grafos fixos erram quando a
  tarefa muda no meio; a busca automática de workflow só compensa em tarefa repetida e pontuável (AFlow, pesquisa
  2026-11-13 C12). Um grafo rígido pode custar acerto.
- Duplica parte do modo time e do roteador; precisa substituí-los ou conviver.

**Quando faz sentido.** Para fluxos repetidos e pontuáveis (gate de PR, auditoria, migração em lote, o próprio
benchmark), onde o mesmo grafo roda muitas vezes. Não para tarefa exploratória.

**Fases.** (1) escalonador para grafos só com `after` e `gate`, executando nós via RPC, medido contra o fluxo atual
em 3 fluxos repetidos; (2) `review` e `data` com esquema; (3) checkpoints e retomada; (4) `router` e mutação
proposta. Usa a tela do Plano A sem mudança de formato.

## 8. Comparação e recomendação

| critério | A terminal | B canvas web | C runtime |
|---|---|---|---|
| esconde o chat e gerencia agentes | sim | sim, em outra janela | sim, com a tela do A |
| criar e interconectar agentes | sim, por teclado | sim, arrastando | sim, com contrato por aresta |
| reaproveita o que existe | quase tudo | arquivo e frota | pouco: novo executor |
| esforço | médio | grande | muito grande |
| risco de segurança novo | nenhum | porta local | processos e checkpoints novos |
| efeito esperado em acerto | neutro (observabilidade) | neutro | positivo só em fluxo repetido |
| efeito esperado em custo | neutro | neutro | queda nas transições mecânicas |
| funciona em SSH e tmux | sim | não sem túnel | sim |

Recomendação: A fases 1–3 agora; medir na fase 5; C fase 1 apenas para os fluxos repetidos se a medição mostrar
custo menor sem perda de acerto; B só se grafos passarem de ~25 nós na prática. O arquivo de grafo da seção 4.1 é o
contrato comum: fazê-lo bem na primeira vez é o que mantém as três portas abertas.

## 9. Decisões que cabem ao dono

1. O grafo é modo de trabalho ou só visão? (define se a fase 4 do A entra antes da medição)
2. Arquivo de grafo no repositório do projeto (`.pi/graphs/`, versionado) ou no diretório da sessão?
3. Teto padrão por nó e por grafo (sugestão: os limites atuais de faixa).
4. Mouse ligado por padrão em fullscreen ou só por opção?
5. Aceita dependência nova (`dagre`) para o layout ou só código próprio?

## 10. Verificação cruzada (preenchida ao fim da auditoria)

Feita em `research/verificacao-cruzada.md`. O que muda neste documento: o vocabulário de estados é escolha nossa (a
agent view lida agrupa em Pinned, Ready for review, Needs input, Working, Completed); a separação de arestas de
controle e de dados não tem fonte lida (página do Agent Spec não abriu); `opentui-island` não serve de base para
mouse (exige Bun, API não confirmada); `elkjs` é EPL-2.0 ou GPL-3.0+ (pesa no Plano B); MCP Tasks virou extensão na
spec 2026-07-28 e continua fora do barramento interno; segue sem comparação direta entre grafo manual e dinâmico.
