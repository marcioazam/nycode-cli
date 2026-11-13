# pi: UI do painel de agentes SOTA no tema do HUD + subagentes e agent teams SOTA (2026-11-13)

## Pedido
"Dar espaçamento entre os sub agents e status line padrão. Deixar UI, navegação, acesso e design SOTA [...] pesquisar
com deep search na web e aplicar sub agents e time de agents SOTA no Pi [...] papers, documentos, github [...] quero o
melhor possível. Auditar e planejar." Depois: "Quero o máximo de assertividade, custo x benefício" e "Retire do HUD mas
deixe o nosso com mesmo tema do HUD e cores".

Decisões do usuário (2026-11-13): teams decididos por pesquisa + eval pareada (padrão ligado só com `no_worse` e custo
≤ 1,20x); teto de eval 20 USD; a linha de agents sai do HUD e o painel vira a superfície única, no tema do HUD.

Pedido adicional (2026-11-13): a pesquisa cobre funcionalidades de agentes (distribuição e decomposição de tarefas,
liderança, gerenciamento, conversa) em papers, pesquisas e docs, não só CLIs; e o time deve ter **conversa em tempo
real entre todos os graus** (líder, subagentes, sub-subagentes, 3º grau), com gerenciamento, divisão e colaboração
visando assertividade e qualidade SOTA. Aceite extra A11: um agente de qualquer grau manda mensagem a qualquer outro
da mesma árvore (pai, filho, irmão, líder) e ela chega no turno seguinte dele; o painel mostra a conversa.

Supera: "agent teams fora do escopo" em `pi-agent-fleet-2026-11-12.md` (Decisões) e `pi-multi-agent-2026-11-11.md`.

## Auditoria (screenshot do usuário + código, 2026-11-13)
- F1 painel e status line colados: ambos widgets `belowEditor` (`subagent/fleet-ui/index.ts:36`, `status-line.ts:298`).
- F2 linhas indistinguíveis (`general-purpose thinking…` x4): `panel.ts:layoutRow` não mostra a tarefa.
- F3 coluna de stats alinhada à direita com largura variável: tremula.
- F4 estado fraco: sem indicador animado, glifo `○` igual em tudo, dica disputa com `main`.
- F5 linha de agents do HUD (`bin/hud/claude-hud-pi-transcript.mjs:52-59`) duplica o painel, mostra `(<1s)` errado.
- F6 painel usa tokens do tema pi; HUD usa a paleta de `plugins/claude-hud/config.json` `colors`.
- F7 agent teams ausentes; pesquisa de 2026-11-11 não estudou teams.

## Aceite
A1 uma linha em branco entre painel e status line · A2 linhas de mesmo tipo distinguíveis pela tarefa · A3 colunas
estáveis em 40/80/160 · A4 paleta do HUD lida do mesmo config, com fallback e NO_COLOR · A5 HUD sem linha de agents,
tools/todos/uso intactos · A6 relatório de pesquisa verificado (papers, docs, GitHub) · A7 teams opt-in com testes
≥ 80% · A8 veredito da eval registrado e padrões seguindo-o, gasto ≤ 20 USD · A9 sem regressão em
foreground/background/parallel/chain/resume/cancel/aninhamento · A10 gate verde e plan-reviewer `complete`.

## Grafo de unidades (fora de git: escritores com arquivos disjuntos ou em sequência)
| id | arquivos | agente | depois de |
|---|---|---|---|
| R pesquisa | `docs/research/2026-11-13-pi-agents-teams-sota.md` + ledger | perplexity-scout, web-scout, scholar-scout, claim-verifier | — |
| U2 HUD | `plugins/claude-hud/config.json`, `bin/hud/claude-hud-pi-transcript.mjs`, `bin/hud/tests/*` | swarm-worker | — |
| U1 painel | `fleet-ui/{panel,view-model,palette,viewer}.ts`, `patches/pi-code/subagent-panel/fleet-ui.test.ts`, `subagent-panel.patch` | swarm-worker | — |
| U3 alavancas | skills/agentes/`agent-contract.md` decididos pela pesquisa | swarm-worker | R (optional) |
| U4 teams | `subagent/team/*`, `patches/pi-code/team.patch`, testes | swarm-worker | U1, R |
| E eval | `~/.claude/evals` via `run_pi.py` | sessão principal | U3, U4 |
| G gate | tudo acima | gate-runner | E |

## Decisão de design (passo 3, pela pesquisa `docs/research/2026-11-13-pi-agents-teams-sota.md`)
Evidência central: um escritor + leitura + crítico independente ganha em tarefas sequenciais [C31, C12, C16]. Times ganham
com coordenação **estruturada**: feed de ações dos pares [C40, revisado por pares], contexto compartilhado + fila com
claim exclusivo [C39], validador separado [C43], coordenador acima de p2p [C33, C3]. Negociação livre rende, mas a ~6x
[C41]; implementadores baratos pioram [C44]; interferência sobe 3-4x de 2 para 5 agentes [C40].

**Subagentes (padrão, U3):** em `swarm-orchestration`, (1) escolher a forma pela decomponibilidade antes de rodar
(sequencial/acoplado = um worker; decomponível = lanes ou time) [C2, C45]; (2) crítico independente com checagem
executável em toda unidade de escrita de risco médio+, depois do gate determinístico [C12, C42, C29]; (3) implementador
nunca em Haiku, Haiku só busca/mapa/planejamento barato [C44]; (4) o arquivo da tarefa inteiro vai a cada worker
(já em L80) [C29]. Sem agente ou skill novos.

**Time (opt-in `PI_CODE_TEAMS=1` ou `/team on`, U4)**, sobre a frota em disco que já existe:
- Árvore inteira conversa: qualquer run do mesmo diretório da frota (main/líder, filhos, netos, 3º grau, irmãos) manda
  mensagem a qualquer outro, por id, nome de agente, `parent`, `lead` ou `all` (atende A11). Entrega no próximo limite
  de turno do destinatário via inbox + steer que já existem; para o main, inbox próprio entregue como followUp
  (agrupado, uma volta do modelo por lote).
- Mensagens tipadas e curtas (PACT/Codex) [C11]: `kind` = `question|answer|info|blocker|handoff`, `from`, `to`,
  texto ≤ 2.000 chars; orçamento de 30 envios por run e 300 por árvore.
- Quadro compartilhado append-only (`team/board.jsonl`: fact|fail|done) e fila de tarefas com claim exclusivo por
  `O_EXCL` (um claim aberto por agente), com reserva de arquivos no claim [C39, C15, C8].
- Feed de ações dos pares (PASC) [C40]: a cada limite de turno, um resumo ≤ 600 chars das edições e testes dos outros
  membros desde o último resumo, injetado como steer; só em modo time.
- Líder = sessão principal: dono do plano, da fila e do merge; escritores em arquivos disjuntos; validador separado
  roda checagens executáveis [C33, C43]. Padrão 2 escritores simultâneos, máximo 4 (cap do pi) [C40].
- UI: o painel mostra `✉n` por linha e o viewer mostra a conversa (de → para, tipo), na paleta do HUD.
- Fora: negociação por fases (custo 6x [C41]; fica como roteiro opcional no brief do líder, sem código).

## Custo e qualidade (harness-economy)
- Painel: zero token; paleta lida uma vez por sessão. HUD: menos uma linha por render.
- Alavancas e teams: custo medido na eval; só entram por padrão com ratio ≤ 1,20 e `no_worse`.

## Rollback
`showAgents: true` e reverter `claude-hud-pi-transcript.mjs`; regenerar `subagent-panel.patch` sem `palette.ts`;
apagar `team.patch` e desligar `PI_CODE_TEAMS`.

## Notas knowledge vault consultadas
- `Resources/Patterns/pi-harness-multi-agent-2026-11.md` (L12): teams não adotados em 2026-11-11; arquivo
  compartilhado supera mensagens (arXiv 2608.16801), a reverificar na pesquisa.
- `Resources/Patterns/pi-agent-fleet-panel-2026-11.md`: frota em disco, patch local provado pelo gate.

## Checkpoint
- [DONE:1] registro criado.
- [DONE:2] pesquisa: 10 agentes, 45 claims, report_check pass, 25 no claim store.
- [DONE:3] decisão acima.
- [DONE:4] HUD sem agents (13/13 testes HUD; red 5/1 → green).
- [DONE:5] painel no tema do HUD (38/38 fleet-ui; patch reproduz byte a byte; teste dividido 745+176 linhas).
- [DONE:6] alavancas em `skills/swarm-orchestration/SKILL.md` (+644 B, `check-instructions` 0 problemas).
- [DONE:7] teams: `subagent/team/{types,store,route,tasks,feed,ui,index}.ts` em `team.patch` (depois de
  `subagent-panel.patch`); `child.ts` e `modes.ts` intocados (o `withTeamTool` entra em `run.ts` e nos agentes do
  background em `index.ts`); headless com `PI_CODE_TEAMS=1` cria a frota (smoke Haiku: `TEAM_SMOKE_OK` do Explore
  chegou ao main como mensagem). Testes `team/team.test.ts` 14 + `team/team-faults.test.ts` 4.
- [DONE:8] eval pareada (`run_pi.py`, outcome, k=2, jobs 1, Opus 5.5, os 8 casos da rodada 6; braços off/on
  simultâneos): `teams-off-20261113T104427` e `teams-on-20261113T104427` (`~/.local/state/pelo-em-ovo/results/`).
  Abortada pela checagem de drift após 6 unidades por braço: outra sessão (pid 298917) gravou `retry` em
  `~/.pi/agent/settings.json` às 10:48:47 (backup dela `settings.json.bak-retry`). Parcial pareado: off 6/6, on 5/6
  (`out-review-adjacent` `findings_min_recall`, 1 run, diagnóstico), custo $1,98 vs $2,00 (1,01x); o modelo não
  chamou a ferramenta `team` em nenhum caso. Gasto $3,98 de 20. **Veredito: `no_worse` não demonstrado → teams
  ficam opt-in** (regra do pedido). Não refeita: a outra sessão seguia editando o harness (nova rodada sairia
  contaminada). Limite: a eval não mede o benefício do time, só o custo de ligar a flag nesses casos.
  **Decisão de ligar por padrão segue aberta** até uma rodada pareada limpa (outras sessões do pi paradas) com casos
  que disparem o time (decomponíveis, ≥ 3 unidades).
- [DONE:9] gate (`~/.cache/pi-fleet-work/gate.sh` + `gate-extra.sh`, gate-runner, `== GATE pass` nos dois, rc 0):
  testes 125/125 (subagent-panel + team), cobertura `files=22 failing=0` (piso 80% por arquivo dos dois patches e
  toda linha `+` executada), patches antigos verdes, typecheck 0/0, structure sem achados (subagent 25, team 7,
  patches 29, patches/team 2, bin/hud 6), 12 variantes red exit 1 (novas: team-claim, team-broadcast, panel-gap),
  roundtrip e upgrade exit 0 (pristino `npm pack pi-code@1.7.0` + pilha = instalado; reverso = pristino); extra:
  HUD, ui, check-instructions, check-agents, hooks, config HUD, `/tmp` 220=220. Rodadas anteriores reprovaram e
  foram corrigidas: cobertura (`child.ts`/`modes.ts` contados como primeira parte → hunks movidos; `ui.ts` sem
  teste → teste da conversa), typecheck (`Static<typeof Params>`), upgrade (cabeçalhos de arquivo novo sem data
  epoch deixavam arquivos vazios no reverso → `team.patch` regenerado com `diff -ruN`).
  sha256: `subagent-panel.patch` cab8492b…a3ce14, `team.patch` 926225b0…544677, `team/team.test.ts`
  b3cedd84…01ae2, `team/team-faults.test.ts` 0e7b2f5c…a2815.
  Residual de outra sessão: `zz-subagent-respawn.patch` (11:02:45, `subagent/respawn.ts` + `run.ts`) entrou durante
  o gate; a pilha com ele segue = instalado e reversível, mas `respawn.ts` na raiz de `subagent/` reprovará a regra
  "só nomes upstream" do gate na próxima rodada (dono: aquela sessão).
- Revisão 1 (plan-reviewer, `gaps`): (1) E2E tmux ausente; (2) captura knowledge vault; (3) decisão aberta da eval; (4) corrida
  no claim com arquivos sobrepostos em `team/tasks.ts`. (4) corrigido test-first: o teste da corrida (seam
  `syncBuiltinESMExports`) falhou com `true !== false` antes da correção e passou depois (team.test.ts 15/15,
  `tasks.ts` 99,29% de linhas); `claimTask` re-checa após o `O_EXCL` e o menor número de tarefa fica. `team.patch`
  regenerado (sha256 df8ba38c…e364; `team.test.ts` 5dbf7b43…b3c0); pristino + pilha = instalado, reverso = pristino.
  (2) capturado: `Resources/Patterns/pi-harness-multi-agent-2026-11.md` (correção de L12, 20.805 B, `oversized`
  para o curador) e `Resources/Patterns/pi-agent-fleet-panel-2026-11.md`. (3) registrado acima.
- (1) E2E tmux (swarm-worker, servidor `-L e2eteam`, Haiku, `PI_CODE_TEAMS=1`; capturas em
  `~/.cache/pi-fleet-work/out/e2e/`): uma linha em branco entre painel e status line (A-160-4, A-80, A-40, B-plain);
  linhas distinguidas por `#n`, grau sobrescrito e tarefa; largura máxima 160/80/40, colunas alinhadas, `…` em 40;
  truecolor do HUD em A (`38;2;125;207;255`, `158;206;106`, `86;95;137`), zero `38;2`/`38;5` com `NO_COLOR` (B);
  `PI_REDUCED_MOTION=1` congela o spinner (`○`); `✉n` nas linhas; viewer mostra `✉ Explore → lead [info]: HELLO`;
  HUD sem linha de agents; frota removida no `/quit`. Entrega: L3_OK (3º grau → lead) e CLAIMED chegaram ao main;
  SIBLING_HI (`all`) chegou ao irmão, mas não ao líder.
- Mudança de especificação pelo E2E: `all` vindo de um membro passa a incluir o líder (o líder coordena e precisa
  ver broadcasts; A11 "qualquer um a qualquer um"); do líder, segue só os runs vivos; run sozinho → líder. Teste
  antes (2 falhas), depois 15/15 + faults 4/4; `team.patch` sha256 86ac6149…b8d, `team.test.ts` 2b8f224f…f9.
- Gate final (gate-runner, árvore atual): extra `GATE pass`; principal com cobertura `files=22 failing=0`, 12 red
  exit 1, roundtrip/upgrade 0, patches antigos 0, e 3 falhas, todas de **outra sessão** (pid 298917), que adicionou
  `zz-subagent-respawn.patch` (11:02) e `zz-panel-main-root.patch` (11:21, sobre `fleet-ui/{panel,index,view-model}.ts`):
  `fleet-spawn.test.ts:164` uso ×3 (passa 18/18 na pilha sem os `zz-*`, `FLEET_TEST_PKG` = pristino + pilha sem
  zz), structure `respawn.ts` na raiz e `patches/pi-code` com 8 arquivos (o 8º é `zz-subagent-respawn/respawn.test.ts`),
  typecheck 3 × TS2339 em `mainStats` (`main ?? {}`), linhas acrescentadas por `zz-panel-main-root`. Fora do escopo
  deste plano; o dono é aquela sessão. O último gate 100% verde deste escopo (antes dos `zz-*`) está no passo 9.
- [DONE:10] plan-reviewer rodada 2: `PLAN_REVIEW: complete` (2026-11-13). Gasto da eval $3,98 de 20; E2E < $1.

## Extensão 2026-11-13: UI de subagentes no chat (pedido: "parecida com Claude Code ou melhor")
Antes (screenshot): `subagent parallel (2 tasks)` + prévias cortadas (`OWNED FI...`), `⏳ parallel 0/2 done`, por
tarefa `─── agente ⏳`, `... 1 earlier items`, cinco `→ read/$` e prosa solta misturada; alto e repetido.
Aceite: R1 cabeçalho sem estado falso (a caixa da chamada não sabe o estado); R2 linha por agente em árvore
(`├─`/`└─`, glifo ●/✓/✗/◐, título curto ≤ 48 sem corte no meio, `N tools · X tok · $c · tempo`); R3 só a última
ferramenta (`⎿`) enquanto roda, prévia da resposta (sem cabeçalho `status:` do handback, sem markdown) ao terminar;
R4 rodapé com glifo agregado e totais; R5 nada de "Done" durante atualização parcial (`isPartial`); R6 linhas
provisórias `⎿ starting…` a partir dos args; R7 falha em vermelho, texto até 3 linhas; R8 expandido (ctrl+o) com a
mesma árvore; R9 `NO_COLOR` sem cor; R10 2 agentes em paralelo ≤ 8 linhas recolhido.
Implementação: `subagent-render.patch` cria `subagent/transcript/{call,format,index,layout,result}.ts` e troca os
imports em `subagent/index.ts`; `render.ts`/`render-result.ts` voltam ao pristino (a raiz de `subagent/` não ganha
arquivo de primeira parte). `team.patch`: só deslocamento de linha no hunk de `index.ts`.
Evidência: `patches/pi-code/subagent-render/render.test.ts` 22/22 (vermelho antes: 13/14 na 1ª rodada, 18/21 na 2ª,
1 na prévia do handback), cobertura 100% em `transcript/*`, `subagent/index.ts` 92% com toda linha do patch
executada; pilha = instalado, reverso = pristino. E2E tmux (`out/e2e-render/`, `out/e2e-render2/`): R1-R5, R7-R10
ok; 6 linhas para 2 agentes. Limites: antes do 1º update do tool o pi só desenha a caixa da chamada (~1,5 s só com o
cabeçalho, R6 vale a partir do 1º update); o painel da frota mostra a tarefa do passo 2 de uma chain já com
`{previous}` substituído (fleet-ui, fora deste pedido).
Revisão 1 (plan-reviewer, `gaps`): (1) com `NO_COLOR` o markdown expandido ainda usava o tema colorido; corrigido
test-first (teste com tema markdown que emite ANSI: vermelho "escape found in single", depois 23/23), tema markdown
identidade sob `NO_COLOR` em `transcript/index.ts` (100% de linhas); (2) R9 no terminal real:
`out/e2e-render3/N-{run-1,run-2,done,expanded}.e.txt` com 0 escapes dentro do bloco (cabeçalho do expandido saiu do
scrollback; a prévia do handback também está coberta só por teste de unidade). Gate final: extra `GATE pass`;
principal só com as falhas conhecidas da outra sessão (cobertura `files=27 failing=1` = `fleet-ui/index.ts:59` do
`zz-panel-main-root`; structure `respawn.ts` e 8 arquivos em `patches/pi-code`; 3 × TS2339 de `mainStats`), 154/154
testes, `transcript/*` 100%, 12 red exit 1, roundtrip e upgrade 0. sha256: `subagent-render.patch` 748ae90a…dcd04,
`team.patch` ff735ff8…fc20, `subagent-render/render.test.ts` baef72f5…06bc.
