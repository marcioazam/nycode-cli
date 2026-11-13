# pi: painel de agentes (frota) estilo Claude Code com subagentes de 2º e 3º grau (2026-11-12)

## Pedido
"Fazer UI + funcionamento de subagentes em 1º, 2º e 3º grau parecidos com o Claude, onde posso navegar via status line e
continuar mexendo no chat principal; [como] no Claude não há 2º e 3º grau como aqui, exiba-os diferente; SOTA em
novembro de 2026, custo x benefício." Referência visual: painel do Claude Code abaixo do prompt
(`● main` / `○ gateway-engineer  Reading connect_target.rs tests  50s · ↓ 114.4k tokens`).

## Evidência (lida em 2026-11-12)
| Fato | Fonte | Provedor |
|---|---|---|
| Painel abaixo do prompt com uma linha `main` e uma por agente; `↑/↓` move, `Enter` abre o transcript e manda mensagens ao agente, `x` para (rodando) ou dispensa (terminado), `Esc` volta ao prompt | https://code.claude.com/docs/en/sub-agents (seção "Observe and steer running forks") | Perplexity + Parallel (web_fetch) |
| Subagentes aninhados aparecem como árvore no painel; linha com descendentes leva `(+N)`; abrir uma linha mostra irmãos e filhos diretos com caminho até `main`; profundidade máx. 5 | https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/whats-new/2026-w24 | Parallel (web_search), Exa (web_fetch) |
| Terminado com sucesso some na hora (dica `/tasks` por 30 s); falho ou parado fica 30 s; `x` limpa antes | https://code.claude.com/docs/en/sub-agents ("Finished subagents in the panel and task list") | Parallel (web_fetch) |
| `Ctrl+B` manda Bash e agentes em execução para o background; `Esc` com linha do painel selecionada só desseleciona | https://code.claude.com/docs/en/interactive-mode | Parallel (web_fetch) |
| OpenCode navega sessões filhas por teclas (filho, irmãos, pai), inclusive netos; Codex CLI lista subagentes acima do composer e troca de thread com `/subagents` | https://open-code.ai/en/docs/agents, https://github.com/anomalyco/opencode/issues/15972, https://developers.openai.com/codex/developer-commands | Perplexity (não relido: só padrão de UX, não decide contrato) |
| Já existe `@herbertgao/pi-subagents` (FleetView igual ao Claude, viewer, steering) | https://npmjs.com/package/@herbertgao/pi-subagents | Keenable |

Mensagem a um agente rodando: pi tem `pi.sendUserMessage(text, { deliverAs: "steer" })` (docs locais
`extensions.md`), entregue após as ferramentas do turno atual; serve em modo `-p --mode json`, sem trocar o filho para RPC.

## Decisões
- **Não adotar `@herbertgao/pi-subagents`**: substitui a ferramenta `subagent` do pi-code (contrato usado pelo
  CLAUDE.md, agentes, `swarm-orchestration`, patch de aninhamento e orçamento por lane) e esconde subagentes aninhados
  de toda superfície de topo, o oposto do pedido. Copiamos o padrão de UX (↓ no prompt vazio, ●/○, Enter, x x, Esc).
- **Patch local no pi-code** (`patches/pi-code/subagent-panel.patch`, aplicado pelo wrapper depois do
  `subagent-nesting.patch`): o painel precisa do registro de background, do `execute()` (Ctrl+B) e dos pontos de
  spawn; extensão separada não alcança esses pontos.
- **Plano de dados em disco** (contrato `extensions/subagent/fleet/types.ts`): quem cria o filho grava o registro
  dele no diretório da frota da sessão principal; o painel lê a árvore inteira de lá. Assim os graus 2 e 3, que vivem
  em outros processos, aparecem iguais aos de 1º grau, sem RPC e sem mudar o modo dos filhos.
- **Diferença visual por grau** (o Claude mostra a árvore igual em todo nível): 1º grau como o Claude; 2º e 3º com
  guias de árvore (`├─`, `└─`, `│`), nome e atividade esmaecendo por nível (texto → muted → dim) e glifo próprio.
- **Ctrl+B no nível da chamada da ferramenta**: a chamada `subagent` em primeiro plano (single, parallel ou chain)
  retorna na hora com "movido para background" e segue rodando; quando termina, um único aviso de conclusão chega
  (uma volta do modelo principal por chamada, não uma por filho: custo). Só na sessão principal; fora dela, ctrl+b
  continua sendo cursor à esquerda do editor.
- **Parar qualquer grau**: marcador `<id>.stop` e SIGTERM ao grupo do processo filho, com identidade conferida em
  `/proc/<pid>/environ` (`PI_CODE_FLEET_RUN_ID=<id>`) contra reuso de pid; o dono reporta "parado pelo usuário" ao pai.
  O marcador guarda a origem (`user` = painel, `agent` = `subagent {cancel}`; vazio = `user`): `stoppedBy` e a nota
  ao pai nomeiam quem parou (2ª rodada).
- **Esc ganha do Ctrl+B** (2ª rodada): turno abortado antes do destaque encerra a chamada; um Ctrl+B depois não a
  revive (`raceDetach` em `fleet/detach.ts`).
- **Resume pelo painel avisa o modelo** (2ª rodada): o aviso de conclusão diz que o usuário retomou o run pelo painel,
  que é só relato e que não deve repetir; sem isso o Haiku desconfiava do run ou o retomava de novo (visto ao vivo).
- **`{cancel}` de um run de fundo também grava a origem** (3ª rodada): `cancelResultText` escreve o marcador
  `agent` antes de cancelar, então `stoppedBy: agent` e a nota "Cancelled by its parent agent" valem para os dois
  caminhos (registro de fundo e chamada movida com Ctrl+B); antes só o caminho da frota gravava.
- **Estrutura** (3ª rodada; supera "raiz `subagent/` 14 = base, não dividida" e a exceção intermediária do gate):
  `nesting.ts` (arquivo nosso, do `subagent-nesting.patch`) mudou para `subagent/nesting/index.ts`; os 7 arquivos
  upstream que nenhum patch toca (`agents`, `child`, `params`, `render-result`, `render`, `types`, `worktree`) ganharam
  pins de blob no `VENDORED` do `structure.py` (desde o desvínculo do Codex, a cópia do pi
  `claude-home/bin/structure/structure.py`; o `~/.codex` voltou ao original) (blob = `npm pack pi-code@1.7.0`, shasum `8ba1f81…`), o
  mecanismo da ferramenta para terceiros byte a byte iguais ao upstream. Resultado: `structure.py` na árvore
  `subagent/` inteira dá `findings: []` (raiz com os 6 arquivos patchados) e o gate exige `findings: []` sem exceção.
  Um pi-code novo que mude um desses arquivos tira o pin do ar e o gate reprova até reverificar e refazer o pin.
  Não dividimos o upstream: o patch reescreveria arquivos inteiros de terceiros e quebraria a cada versão.
- **Cobertura no gate** (3ª rodada): uma cópia única do pacote para os 4 arquivos de teste (`setup.ts`,
  `FLEET_TEST_PKG`), então o relatório mescla cada fonte; `coverage-check.py` lê o lcov e reprova se algum arquivo
  que o patch cria ou altera tiver < 80% de linhas ou se alguma linha que o patch acrescenta não rodar.
- **Fora do escopo**: agent teams (decisão de 2026-11-11 mantida; superada em 2026-11-13 por
  `pi-agents-ui-teams-sota-2026-11-13.md`: teams decididos por pesquisa + eval), persistir transcripts após o fim da sessão
  (o Claude guarda 30 dias; aqui ficam em tmp e somem no quit: custo zero de disco), parar todos de uma vez
  (`Ctrl+X Ctrl+K` do Claude; `x` por linha e Esc do turno principal cobrem).
- **Risco aceito**: qualquer processo do mesmo usuário pode escrever no inbox de um agente (um subagente com bash
  poderia "falar como usuário" com um irmão). Não aumenta poder: ele já tem shell com os mesmos privilégios.

## Critérios de aceite (observáveis)
- A1 Com subagente rodando, painel abaixo do editor: linha `main` e uma por run; graus 2 e 3 em árvore com estilo
  distinto; atividade, tempo, contexto e custo ao vivo; some quando não há runs visíveis.
- A2 `↓` no prompt vazio foca o painel; `↑/↓` movem; `→/←` expandem/recolhem; `Esc` ou `↑` acima do topo voltam ao
  prompt; tecla imprimível devolve o foco e digita no prompt.
- A3 `Enter` abre o viewer ao vivo de qualquer grau: caminho até `main`, barra de irmãos e filhos, rolagem e
  auto-seguimento; `Esc` fecha; o agente principal segue rodando enquanto isso.
- A4 `x` duas vezes para um run de qualquer grau; o pai recebe a nota "[Stopped by the user ...]"; registro `cancelled`.
- A5 No viewer, mensagem digitada vira steer num run rodando de qualquer grau (confirmação `steered`/`too-late`);
  num run de background da sessão principal já terminado, vira resume.
- A6 `Ctrl+B` com chamada em primeiro plano: a ferramenta retorna na hora, o chat principal fica livre, um aviso de
  conclusão chega no fim; `/tasks` e `{status: true}` listam; `{cancel}` para.
- A7 Terminados: 1º grau com sucesso sai na hora (dica `/tasks` por 30 s); falho ou parado fica 30 s; netos
  terminados ficam esmaecidos sob pai ainda rodando.
- A8 `/tasks` abre um navegador de todos os runs (inclusive terminados) que leva ao viewer.
- A9 Sem regressão: foreground, background, parallel, chain, resume, cancel e orçamento de aninhamento iguais quando
  o painel não é usado; filhos continuam em `-p --mode json`.
- A10 Custo: zero token de modelo; I/O limitado (registro ≤ 4 escritas/s por run, transcript ≤ 4 MB por run);
  diretório da frota apagado no quit e órfãos varridos na partida.
- A11 Módulos novos com ≥ 80% de cobertura de linhas; testes dos patches existentes passam; E2E em tmux com árvore de
  3 graus.

## Grafo de unidades (sem git aqui: escritores em sequência)
| id | arquivos | agente | depois de |
|---|---|---|---|
| U1 plano de dados + Ctrl+B + inbox | `subagent/fleet/{store,tracker,inbox,source,detach}.ts`, hooks em `run.ts`, `background.ts`, `modes.ts`, `index.ts`, `registry-text.ts`; teste `patches/pi-code/subagent-panel/fleet.test.ts` | swarm-worker | contrato `types.ts` |
| U2 UI | `subagent/fleet-ui/{view-model,panel,viewer,index}.ts`, ligação em `index.ts` (UI e `/tasks`); teste `patches/pi-code/subagent-panel/fleet-ui.test.ts` | swarm-worker | U1 |
| U3 integração | `patches/pi-code/subagent-panel.patch`, wrapper (comentário), `docs/goal.md`, E2E tmux, gate | sessão principal + gate-runner | U2 |

## Custo x benefício (rules/harness-economy.md)
- Custo por execução: nenhum token; nenhum byte a mais no prompt (descrição da ferramenta inalterada: o próprio
  resultado do Ctrl+B instrui o modelo). Processo: um `fs.watch` + poll de 1 s só enquanto há runs vivos.
- Ctrl+B agrega a conclusão por chamada (1 volta do modelo principal em vez de N).
- Manutenção: um patch a mais para reaplicar a cada versão do pi-code (arquivos novos não conflitam; hooks pequenos).

## Checkpoint
- 2026-11-12: pesquisa e contrato prontos; base do pi-code (com os 4 patches) copiada em `~/.cache/pi-fleet-work/base`
  (rollback: `rm` do patch novo e reinstalar/reaplicar). Próximo: U1.
- 2026-11-12: U1, U2 e U3 concluídos; revisão (`code-reviewer`) com 5 achados corrigidos (F1-F5) mais o endurecimento
  da raiz da frota (F6); patch gerado e verificado. Estado: **completo**. Rollback: apagar
  `patches/pi-code/subagent-panel.patch` e `subagent-panel/`, depois `pi update` (ou `patch -R -p1` do patch em
  `extensions/`) e reiniciar o pi.
- 2026-11-12 (2ª rodada, meta "sem pendências, gaps ou bugs"): E2E dos itens que faltavam achou 3 defeitos
  (Ctrl+B após Esc revivia a chamada; `{cancel}` gravado como parada do usuário; resume pelo painel confundia o
  modelo) e 2 do gate (cobertura sumia porque o `after` apagava a cópia antes do relatório; testes criavam e
  varriam frotas na raiz real `/tmp/pi-code-fleet-<uid>`). Todos corrigidos com teste vermelho antes; patch
  regenerado. Novo `subagent-panel/fleet-spawn.test.ts`: integração de `run.ts` e `background.ts` com um pi falso
  (processo filho real), cobrindo as partes do patch nesses arquivos (sucesso, parada por `{cancel}` e pelo painel,
  nos dois caminhos). Estado: **completo**.
- 2026-11-12 (3ª rodada, o avaliador da meta reprovou a 2ª: escopo do `structure` cortado, cobertura < 80% em
  `run.ts`/`background.ts`, `index.ts` só no E2E, resume não reconciliado): `nesting.ts` → `nesting/index.ts`
  (raiz = upstream publicado); gate com piso de 80% por arquivo e 100% das linhas acrescentadas pelo patch, cópia
  única do pacote para mesclar a cobertura; testes novos `fleet-entry.test.ts` (cola de `index.ts` com
  `ExtensionAPI` falsa e filho real) e `fleet-faults.test.ts` (falhas de fs, watcher, ESRCH, timers simulados);
  bug novo corrigido com TDD (`{cancel}` de run de fundo sem origem); vazamento de `/tmp/nesting-test-*` no teste
  do nesting corrigido; o gate agora sai ≠ 0 se algum passo falhar; E2E do resume refeito com contagens. Estado:
  **completo**.

## Evidência de verificação
Gate único (`~/.cache/pi-fleet-work/gate.sh` via `gate-runner`, árvore final):
- Testes da frota 55/55 (`subagent-panel/fleet.test.ts` + `fleet-ui.test.ts`); patches antigos (nesting,
  statusline, goal, goal-lifecycle) passam.
- Cobertura de linhas (ramos): `fleet/` detach 100 (92), inbox 100, source 94 (88), store 94 (90), tracker 99 (90),
  types 100; `fleet-ui/` index 96 (88), panel 100 (97), view-model 100 (97), viewer 100 (98). O agregado do
  relatório (59%) inclui o pi-code upstream inteiro, que o teste copia; não é código deste patch.
- Vermelho observado: na árvore antes da revisão (`base` + diff pré-correção) falham exatamente F1-F6; sem a guarda
  do sweep falha só F6.
- Typecheck estrito: 0 erros novos (1 preexistente: `agents.ts` `import.meta`, TS1470).
- `structure.py` em `subagent/`: `over-7-code-files:.:14`, **preexistente** no upstream (a base já tinha 14); o
  patch não põe arquivo novo na raiz (`fleet/` 6, `fleet-ui/` 4). Não dividido: é código de terceiros e a divisão
  viraria um patch frágil a cada versão.
- Ida e volta do patch: `base` + patch = árvore instalada (diff vazio); a pilha inteira desfaz em ordem reversa; do
  pristino, o laço do wrapper aplica os 8 patches sem aviso e reproduz a árvore instalada byte a byte.
- E2E tmux (Haiku 5.5, 170x50): árvore de 3 graus com estilos distintos (A1), `↓`/`↑`/Enter/Esc (A2, A3), steer no
  3º grau com ack `steered` e texto no relato (A5), `x x` no 2º grau → `cancelled`, `stoppedBy: user`, exit 143,
  sem processo órfão (A4), `Ctrl+B` → ferramenta retorna na hora e a conclusão chega depois (A6), `✓ 1 finished ·
  /tasks` (A7), `/tasks` em árvore (A8), `/quit` apaga a frota e só uma frota na nova partida (A10). Repetido na
  árvore final (Ctrl+B + conclusão + quit limpo) e smoke com steer (ack `steered`).
- 2ª rodada, gate único na árvore final (`gate-runner`): testes 64/64 (`fleet`, `fleet-ui`, `fleet-spawn`); patches
  antigos passam; typecheck `new_errors=0 base_errors=0` (o TS1470 era do gate: o tmp do `tc()` não tinha o
  `"type": "module"` do pi-code); `structure` sem achados em `fleet/` (6), `fleet-ui/` (4) e `patches/pi-code` (23), raiz
  `subagent/` 14 = base, arquivos tocados ≤ 800; ida e volta do patch vazia. Vermelho (`red-green.sh`, cada variante
  falha só o seu teste): `abort`, `origin`, `resume`, `run-origin`, `bg-origin`, `run-tail`, `sweep`, e `prefix` (F1-F6
  mais os testes que usam APIs da 2ª rodada). Cobertura: `fleet/` e `fleet-ui/` como acima (≥ 93,97% por arquivo);
  toda linha que o patch acrescenta em `run.ts` e `background.ts` coberta (o resto desses arquivos é upstream);
  a cola em `subagent/index.ts` (Ctrl+B, Esc antes do Ctrl+B, aviso de resume, `/tasks`, painel) é coberta pelo E2E
  abaixo, não por teste unitário (exigiria a `ExtensionAPI` inteira do pi).
- 2ª rodada, E2E tmux (Haiku 5.5): fold `←` folha→pai→`(+1)`, `→` expande; viewer Tab/⇧Tab entre pai e neto,
  `←→` entre irmãos; tecla imprimível sai do painel e digita no prompt; Esc + Ctrl+B → `■ stopped`, sem aviso de
  background e sem acordar o modelo; `{status: true}` lista os 2 runs "moved to the background (Ctrl+B)";
  `{cancel}` → `cancelled`, `stoppedBy: agent`, nota "Cancelled by its parent agent"; `x x` no painel →
  `stoppedBy: user`, processo morto, linha parada visível ~32 s (TTL 30 s); resume pelo viewer (`↪ resumed with
  your message`, `— resumed —` no transcript) e o modelo só relata (1 resume no transcript, 0 chamadas `resume`);
  `/quit` com run de background vivo: raiz da frota vazia e nenhum `sleep` órfão.
- Diretórios de frota extras vistos em `/tmp/pi-code-fleet-<uid>` durante o E2E: instâncias interativas do pi do
  E2E de outra sessão (mesmo servidor tmux), cada uma com a sua frota, varrida no quit (comportamento esperado),
  mais o `node --test` usando a raiz real (corrigido: o teste aponta `TMPDIR` para o seu tmp).
- Mudanças de teste (justificadas): empate de `startedAt` no teste de visibilidade (o teste estava errado); régua
  e âncora `bottom-center` dos overlays (mudança de especificação); F3 roda as duas instâncias num processo à parte
  com `NODE_V8_COVERAGE=''` (carregadas no mesmo processo, a cobertura só mostrava a última instância); os testes
  agora apagam suas cópias em /tmp (`after`). 2ª rodada: o helper `pendingWork` não rejeitava sinal já abortado (o
  listener de `abort` nunca dispara; o teste travava: o teste estava errado); `stopRequested` saiu do código (sem
  uso fora dos testes) e as asserções viraram `stopOrigin(...) === undefined/'user'` (mesma checagem, mais
  estrita); `fleet.test.ts` aponta `TMPDIR` para o seu tmp; com cobertura ligada a cópia fica e o gate apaga o
  `TMPDIR` dele (o relatório lê as fontes depois que o processo de teste sai).
- 3ª rodada, gate único na árvore final (`gate-runner`, `== GATE pass`, exit 0): testes 100/100 (6 arquivos em
  `subagent-panel/`, cópia única do pacote); `coverage` exit 0, `files=14 failing=0`: todo arquivo que o patch cria
  ou altera ≥ 80% de linhas (`index.ts` 87,88; `run.ts` 96,87; `background.ts` 94,61; `registry-text.ts` 96,80;
  `fleet/` e `fleet-ui/` 100) e toda linha acrescentada pelo patch executada (ex.: `index.ts` 72/72, `run.ts` 20/20,
  `background.ts` 23/23, `store.ts` 287/287); patches antigos passam; typecheck `new_errors=0 base_errors=0`;
  `structure`: `patches/pi-code` sem achados (26 arquivos), `subagent/` inteiro só com `over-7-code-files:.:13`
  (raiz idêntica, em nomes, aos 13 arquivos publicados pelo pi-code 1.7.0; raiz dona `~/.pi/agent/npm` exclui
  `node_modules`); vermelho: 9 variantes exit 1, cada uma no seu teste (nova: `bg-cancel`); `patch-roundtrip` e
  `upgrade` (pristino do `npm pack` + laço do wrapper = instalado; a pilha reversa volta ao pristino) exit 0. Sem
  sobras em `/tmp`. Estabilidade: a suíte rodou 4 vezes com cobertura e 1 sem, 100/100 em todas.
- 3ª rodada, E2E do resume (tmux com servidor próprio `-L fe2e`, Haiku 5.5), contado no JSONL da sessão e no
  transcript da frota: 1 chamada `subagent` do modelo (o início), **0** chamadas `resume`; transcript com **1**
  `— resumed —` (assistant PONG → note resumed → user task → assistant PING); 2 avisos de conclusão, só o do resume
  com "Report only"; stderr 0 bytes; frota vazia após `/quit`.
- Mudanças de teste da 3ª rodada (justificadas): `subagent-nesting.test.ts` segue o módulo para `nesting/index.ts`
  (a asserção de fiação continua exigindo que cada consumidor importe o módulo) e passou a apagar sua cópia em
  `/tmp`; os 3 arquivos antigos trocaram só o cabeçalho de cópia pelo `setup.ts` (nenhuma asserção alterada).
- 3ª rodada, fechamento (a meta reprovou de novo por itens das notas do relatório):
  - Estrutura limpa: `structure` do gate com `findings: []` nos dois roots (`subagent/` 17 arquivos de código, 7
    `verified-vendored`; `patches/pi-code` 26); testes do `structure_gate` do Codex 36 OK.
  - Componentes do harness: os 3 do aviso já estavam no último estável (computer-use-linux 0.7.53 = npm; gateway
    com `mcp-server-fetch==2026.11.11` e `package-version-check-mcp==1.2.40` = PyPI); o aviso vinha do relatório de
    2026-11-09. `harness_currency.py` regerado em `~/.claude/telemetry/scans/2026-11-12/`: `harness` atrasados `[]`,
    `errors: []`, `current: 36`; o aviso de SessionStart sai vazio (mesmo `jq` do dispatcher).
  - Bug no `harness_currency.py` (TDD): `uv tool` instalado de git (`skillspector`) ia ao PyPI e gerava "HTTP Error
    404" toda semana; agora o recibo do uv (`tomllib`, chaves `git|path|directory|url` dos `requirements`) o tira da
    consulta. Uma 1ª versão com regex casava `install-path =` dos entrypoints e derrubava 15 ferramentas (visto:
    `current` 36 → 21); o teste ganhou um recibo real e ficou vermelho antes da troca para `tomllib`. Teste
    `test_missing_flag_prints_one_note_line_or_nothing` isolado da máquina (sob o pi, `CLAUDE_CONFIG_DIR` aponta um
    `.claude.json` sem `mcpServers`; o teste estava errado). 15 passed.
  - knowledge vault: a nota `pi-harness-multi-agent-2026-11` (21.030 B) foi dividida pela curadoria (`knowledge-curator`
    propôs, aplicado com snapshot `~/.cache/vault-snapshot-2026-11-12-split.tgz`): 5 seções (6.766 B, intactas)
    foram para `Resources/Patterns/pi-agent-fleet-panel-2026-11.md` (7.192 B); a fonte ficou com 15.692 B e o bloco
    "Moved sections"; 15/15 marcadores `codex-capture` válidos; lint: `oversized` 15 → 14 (esta saiu), `unresolved` 0.
  - Custo x benefício (harness-economy): pins e filtro de recibo custam zero por sessão (rodam só no gate e no scan
    semanal); compram estrutura limpa sem exceção e um relatório semanal sem erro falso.
  - Resolvido por decisão do usuário (ver "Desvínculo do Codex"): `harness-check --json` do Codex reprova só por `cua-driver:symlink-skill` e
    `cua-driver:unsafe-or-missing-project-root` (link `~/.agents/skills/cua-driver` criado pela instalação do
    cua-driver em 2026-11-11 07:25, antes desta tarefa; nenhum detalhe cita arquivo desta tarefa, e o ramo do
    `structure.py` que dá esse achado retorna antes de consultar o `VENDORED`).

## Desvínculo do Codex (decisão do usuário, 2026-11-12)

Pedido: "Deixar o link e aceitar que o harness-check do Codex continue reprovando nesse item. retirar relacao do
Codex com o Pi e o Harness do pi"; escopo escolhido: "Dependências reais" (o pi deixa de executar, checar e
sincronizar com o Codex; rodapés históricos ficam como texto).

- ~~Link `~/.agents/skills/cua-driver`: mantido (o `cua-driver skills update` o atualiza; o pi carrega a skill por ele).~~ Substituído em "Separação total do Codex" (2026-11-13).
  As reprovações `skills: cua-driver:symlink-skill` e `structure: cua-driver:unsafe-or-missing-project-root` são do
  `harness-check` do Codex, que o pi não roda mais; aceitas pelo usuário, não são pendência do pi.
- Checador de estrutura próprio: `claude-home/bin/structure/structure.py` (cópia de
  `~/.codex/bin/harness_checks/structure.py` sem `harness_roots`, com os pins do impeccable e do pi-code) e
  `test_structure.py` (16 testes; trace stdlib: 96,4% das linhas). Consumidores repontados: `CLAUDE.md`,
  `rules/harness-economy.md` (no lugar do `harness-check` do Codex), skills `engineering-standards`, `ripple-hunt`,
  `project-baseline`, `harness-audit`, `bin/tests/pi-ui-final-gate.sh` e o gate deste trabalho.
- Lado do Codex: os 7 pins do pi-code saíram do `VENDORED` do `~/.codex/bin/harness_checks/structure.py` e a seção
  "pins for pi-code's subagent/" saiu de `~/.codex/docs/harness-check-residuals-2026-10-14.md`; o Codex não cita
  mais o pi nesses arquivos.
- Contrato: `~/.codex/AGENTS.md` saiu do `PORTS` do `check-instructions.py`, do manifesto e do snapshot; links de
  "working contract" para o AGENTS.md (skills `tdd`, `engineering-standards`, `accessibility-audit`,
  `agent-routing`; agentes `test-author`, `pente-fino`; `/pre-launch`) apontam para `claude-home/CLAUDE.md`;
  `agent-contract.md` diz que o pi não roda nada em `~/.codex`.
- Roteamento: `codex exec` saiu de `rules/research-and-tools.md` e das skills `agent-routing`, `evidence-research`
  e `perplexity-mcp-sota` (que também deixou de ler a config do Codex).
- Ferramentas do Codex citadas em skills: `harness_evidence.py`, `harness_bench` (roda `codex exec`), o contrato de
  recibo v2 e o conjunto Astra saíram de `agent-systems` (o formato v1 do recibo continua no texto; evals do pi pelo
  `pelo-em-ovo`, telemetria pelo `pi_telemetry.py`); o E2E nativo do Obsidian em `~/.codex/bin/tests/obsidian` deu
  lugar aos testes da própria skill `obsidian-cli`; o registro de curadoria passa a ser o `/docs` do pi. (optional)
- Licenças: cópias idênticas (`cmp`) em `docs/third-party/` (superpowers, mattpocock, addy, knowledge-work-plugins,
  `frontend-research`, proveniência da curadoria) e 15 links repontados em 14 arquivos de skill e no
  `code-reviewer`.
- Fica, por não ser vínculo: bloqueio de `~/.codex/auth.json` no `guard.py`, `safety.md` e na máscara da telemetria
  (segurança); rodapés "Ported from"/"Research synthesis"; menções a Codex como produto em conteúdo de terceiros
  (hallmark, impeccable, e2e, diagram-design, browser-harness); fixtures capturadas dos hooks.
- Custo x benefício: zero bytes a mais por sessão (o `CLAUDE.md` trocou um caminho por outro); compra um harness que
  não quebra quando o `~/.codex` muda e checagens que o pi controla.
- Achados da verificação, corrigidos na mesma rodada:
  - Bug no `skills/harness-audit/scripts/pi_harness_check.py` (TDD): o verificador de links lia código como link (optional)
    (`x[40]('/etc/passwd')` num bloco cercado, `` `[Child](./child/${f})` `` inline) e dava 11 "broken link" falsos.
    Teste `test_links_inside_code_are_not_links` vermelho antes (`assert errors == ['broken link references/gone.md']`
    falhou), verde depois; o conserto ignora blocos ``` e ~~~ e trechos de código inline só na checagem de link.
    Cobertura: ver a correção na 4ª rodada (o "100%" foi medido sem `--missing`, que o trace exige).
  - 4 links reais quebrados em `offensive-initial-access` (`exploit/edr.md`, `exploit/shellcode.md`, arquivos que nem o
    upstream tem) apontam para as skills irmãs `offensive-edr-evasion` e `offensive-shellcode`.
  - `skills/claude-red` (bundle-recurso sem `SKILL.md`, nenhuma skill o referencia por caminho) mudou para
    `~/.pi/agent/vendor/claude-red`; o `pi_harness_check` acusava "no SKILL.md".
  - `agents/test-author.md` cita "pi's global contract" em vez do nome do arquivo (regra do `check-agents.py`).
  - Resultado: `pi_harness_check --quiet` 16 erros → 0 (rc 0; os 29 avisos foram zerados na 4ª rodada, abaixo),
    `check-agents` OK (53),
    `check-instructions` 0 problemas, `structure_gate` do Codex 36 OK, gate do patch `== GATE pass`.
  - `security-audit/references/companion-tools.md:7` dizia que as `offensive-*` não foram portadas (estão em
    `skills/`); texto corrigido.

## 4ª rodada: avisos zerados, pins, cobertura (2026-11-12)

O avaliador do /goal apontou os 29 avisos do `pi_harness_check`, o pi-code sem versão fixada, os pins VENDORED e o
`harness-check` do Codex. Tratamento:

- Bugs de checador, com TDD (vermelho observado antes, verde depois):
  - `pi_harness_check.py`: (1) a regra de expansão agora segue a gramática real do pi-code
    (`internal/command-file.ts` argPattern: `${N:-x}` só com `:-`; `internal/command-spans.ts`: `` !`cmd` `` só no
    início da linha ou depois de espaço e fora de bloco cercado; bloco ```` ```! ```` sem recuo executa). Os 10 avisos
    das `offensive-*` (`${7*7}`, `WIN!`) eram falsos positivos. (2) Nome entre aspas é menção (tabela de tradução),
    não uso; o uso sem aspas continua avisado. (3) `npm:@3d24rd0/x` sem versão contava como fixado (o `@3` do escopo):
    falso negativo; só versão exata conta, como o `isExactNpmVersion` do pi.
  - `bin/checks/check-agents.py`: apagava comentários HTML antes de checar, supondo que não chegam ao agente; o pi-code passa
    o corpo inteiro (`subagent/agents.ts`: `systemPrompt: body`). Falso negativo: 10 agentes tinham caminhos do Claude
    em comentários. Teste novo `bin/tests/test_check_agents.py` (6 testes; o arquivo não tinha nenhum).
- Texto: 9 linhas de proveniência (`~/.claude/agents/X.md` → "the Claude agent `X`"), `Explore`, `pente-fino` e 6
  skills (`agent-routing`, `context-economy`, `e2e`, `evidence-research`, `harness-audit`, `pelo-em-ovo`) sem caminho
  ou ferramenta do Claude; o mapeamento da `impeccable` e da `e2e` fica entre aspas.
- Pins de pacote: `settings.json` fixa `npm:pi-code@1.7.0` e `npm:@3d24rd0/pi-antigravity-bridge@1.3.1` (as duas
  últimas no npm, `npm view` em 2026-11-12). Motivo: os 8 patches do pi-code, o patch do bridge e os pins de
  estrutura valem para uma versão; `pi update` agora não move os pacotes debaixo deles. O pi não reinstala: a versão
  instalada satisfaz a fixa (`package-manager.js` `installedNpmMatchesConfiguredVersion`). Para não perder versão
  nova, `~/.claude/bin/harness_currency.py` ganhou `pi_packages()` (lê os `npm:` do `settings.json` do pi) e os dois
  nomes em `HARNESS`, então o aviso semanal do SessionStart mostra versão nova. Atualizar:
  `pi install npm:pi-code@<versão>`; o wrapper reaplica os patches e o gate refaz a verificação dos pins. Rollback:
  voltar o `source` sem versão (cópia em `/tmp/settings.json.bak` nesta sessão).
- Estrutura: os 7 arquivos excluídos são dependência comprovada, a exclusão que o contrato prevê ("exclude only
  proven generated, dependency and build artifacts"). Prova: `npm pack pi-code@1.7.0` → `git hash-object` dos 7 =
  instalado = pin (MATCH nos 7). A raiz de `subagent/` tem os mesmos 13 arquivos do upstream (o patch não acrescenta
  nenhum à raiz); contando só os 6 que o patch altera, a raiz fica em 6 ≤ 7. Código próprio: `fleet/` 6 arquivos
  (máx. 287 linhas), `fleet-ui/` 4 (máx. 391), `nesting/` 1 (94).
- Cobertura (trace stdlib com `--missing`; sem ele o trace conta só linhas executadas e sempre dá 100%, então o "100%"
  da rodada anterior para `pi_harness_check.py` não valia): `pi_harness_check.py` 97,4%, `check-agents.py` 93,9%,
  `harness_currency.py` 83,5%, `bin/structure/structure.py` 96,4%.
- `harness-check` do Codex: 13 checks passam, 2 reprovam só no `cua-driver` (`symlink-skill` e
  `unsafe-or-missing-project-root`), nenhum achado cita `.pi/`. É o checador do Codex, que o pi não roda mais, e o
  item ficou por decisão explícita do usuário ("Deixar o link e aceitar que o harness-check do Codex continue
  reprovando nesse item").
- ~~Nota fora do escopo: `cua-driver` 0.47.8 bloqueado por `curl | bash`~~ superada: atualizado para 0.47.24 sem
  `curl | bash` (seção "cua-driver 0.47.24" abaixo).

- Verificação final (`gate-runner`, uma vez, mais os itens rodados depois): gate `== GATE pass` com estrutura
  `findings: []`; estrutura 16 OK; harness-audit 13 passed; `test_check_agents` 6 OK; `harness_currency` 16 passed;
  `check-instructions` 0 problema; `check-agents` 53 agentes OK; `pi_harness_check` `{"error":0,"warn":0,"info":47}`;
  hooks 30 OK + dispatch 29 OK; obsidian-cli 97 OK (a 1ª tentativa usou `discover -t`, que exige pacote; o comando de
  `references/operations.md:39` passa); `structure_gate` do Codex 36 OK (rodado à mão, fora do pi).
- Ajustes finais: `harness_currency.py` importava `urllib.parse` e o `import urllib.request` local o sombreava
  (ruff F401); agora `from urllib.parse import quote`, 16 passed e ruff limpo. `test_main_exit_codes` passou a
  capturar a saída e conferir a mensagem de cada caso (antes só o código de saída, e o texto vazava no terminal).
- Tema: ver `pi-ui-sota.md`, "Correção 2026-11-12" (NO_COLOR gravava o tema mono; volta ao Tokyo Night).

## cua-driver 0.47.24 (2026-11-12)

- Canal: o upstream marca todas as tags estáveis `cua-driver-rs-v*` como prerelease no GitHub; o próprio instalador
  diz "tag syntax—not the prerelease flag—defines the channel" (a 0.47.8 instalada também era `prerelease=true`).
  `cua-driver update` (só checagem) depois: "Already up to date".
- Sem `curl | bash`: `install.sh` e `_install-rust.sh` baixados para arquivo e lidos; repetidos à mão só os passos
  do ramo Linux (diretório versionado, troca atômica do link `current` com `mv -Tf`, ajudante GNOME). Ficaram de
  fora os passos de "conectar Claude Code, Codex e Cursor" e de alterar o PATH.
- Proveniência: `SHA256SUMS` confere com o binário e o pacote de skill; `cosign verify-blob` 3.1.4 (rodado com
  `mise exec`, desinstalado depois) deu "Verified OK" nos três (binário, skill e `SHA256SUMS`), com a identidade
  `https://github.com/trycua/cua/.github/workflows/cd-rust-cua-driver.yml@refs/tags/cua-driver-rs-v0.47.24`. O
  `sigstore` 4.5.1 em Python não lê o formato antigo de pacote de assinatura do cosign.
- Skill (presente-de-grego): `grego.py` sem achados; diffs lidos à mão (versão, remoção da seção "history",
  remoção das ações de página do navegador legado, avisos de depreciação). `MACOS.md` e `WINDOWS.md` novos foram lidos
  inteiros por um subagente Explore; os passos de credenciais e permissões são só de macOS/Windows e exigem
  autorização explícita do dono. Instalação filtrada para Linux, como a 0.47.8 (o `SKILL.md` prevê "Other
  platform files may be absent from a host-filtered installation"); o resultado é igual ao pacote assinado menos
  esses dois arquivos. O link `~/.agents/skills/cua-driver` ficou (decisão do usuário); `skills status`: Pi, Codex
  e Cursor "✅ linked".
- Ajudante GNOME `winrects@cua`: versão 12 nas duas; o `extension.js` novo só remove ~264 linhas de desenho
  (`drawActionCue`) e não acrescenta spawn, E/S ou rede. Copiado como o instalador faz em versão igual; vale ao
  recarregar a sessão GNOME.
- Serviço: `systemctl --user restart cua-driver.service` → `active`, processo `cua-driver serve` novo.
  `health_report` 0.47.24: `binary_version`, `platform_supported`, `session_active`, `ax_capability`,
  `screen_capture_capability` = pass; `tcc_*` e `bundle_identity` = skip ("not applicable on Linux"); `wayland_backend`
  = skip (backend experimental, opt-in por `CUA_DRIVER_RS_ENABLE_WAYLAND=1`, deixado desligado).
- Observado e igual antes e depois: `cua-driver test` sai 1 nos passos `accessibility` e `screen_recording` tanto na
  0.47.24 quanto no binário 0.47.8. A correção que ele sugere é `permissions grant`, que a ajuda descreve como
  "macOS only"; o diagnóstico de ponta a ponta do driver (`health_report`) passa no Linux.
- Reverter: apontar `~/.cua-driver/packages/current` para `releases/0.47.8-x86_64-unknown-linux-gnu` (mantido),
  reinstalar a skill e o `extension.js` do release assinado `cua-driver-rs-v0.47.8` e reiniciar o serviço.
- A cópia `~/.claude/skills/cua-driver` é um `SKILL.md` próprio do usuário (3,7 KB, 2026-11-08), não o pacote do
  fornecedor; ficou intacta.

## Separação total do Codex (decisão do usuário, 2026-11-13)

Pedido: "desassociar o codex do harness check e do pi"; opção escolhida: "Separar de vez". Substitui o item
"Link `~/.agents/skills/cua-driver`: mantido" de "Desvínculo do Codex" e a nota do link em "cua-driver 0.47.24".

- O pi carrega a skill por caminho próprio: `settings.json` `"skills": ["~/.cua-driver/skills/cua-driver"]`.
  Prova (RPC `get_commands`, sem modelo): antes `skill:cua-driver` vinha de `~/.agents/skills/cua-driver/SKILL.md`; (optional)
  depois vem de `~/.cua-driver/skills/cua-driver/SKILL.md`; total 251 comandos (206 skills) igual.
- Link compartilhado `~/.agents/skills/cua-driver` removido (só o symlink; a pasta fica vazia). `cua-driver skills
  status`: Codex, Pi e Cursor "not linked". Efeito: Codex e Cursor deixam de ver a skill (escolha do usuário).
  Os dois itens do `harness-check` do Codex vinham desse link (`catalog.py:52` `symlink-skill`; `structure.py:143`
  inclui a pasta e `scan` rejeita raiz symlink, `structure.py:74-75`); com a pasta vazia deixam de existir.
  Inferido pela leitura do código, não executado: o pi não roda nada do Codex (memória `pi-no-codex`).
- Cuidado: `cua-driver skills install|update` recria o link para os agentes detectados. Atualizar como em
  "cua-driver 0.47.24" (manual, verificado) ou apagar o link depois.
- `skills/harness-audit/SKILL.md`: saiu "optionally the Codex harness"; o Codex agora é fora de escopo ("never (optional)
  audit, run or modify it").
- Licenças: os rodapés de 15 agentes apontavam a atribuição MIT para `~/.codex/docs/agent-research-20260920/`.
  Copiados `research-core.md`, `source-manifest.json` e 9 `sources/*/LICENSE*` para
  `docs/third-party/agent-research-20260920/` (sha256 11/11 iguais à origem) e os 15 rodapés reapontados.
  "Ported from ~/.codex/agents/..." fica como história.
- Rollback: tirar `skills` do `settings.json` (cópia em `~/.cache/pi-terminal-sota/settings.json.bak`), `ln -s
  ~/.cua-driver/skills/cua-driver ~/.agents/skills/cua-driver`, reverter os 15 rodapés com `sed`.
- Não apagar o diretório vazio `~/.agents/skills`: o `catalog.py:46-47` do Codex reprova `missing-skill-root:shared`
  quando ele falta; vazio, `paths()` (`catalog.py:13-16`) e `structure.py:143` não acham entradas, então nem
  `symlink-skill` nem `unsafe-or-missing-project-root` podem sair (leitura do código, sem executar o Codex).
