# ny-pi: leveza e fluidez (perf SOTA)

Registro vivo do plano aprovado em 2026-11-18. Fonte: `~/.pi/agent/plans/2026-11-18-01a1f089.md`.

## Plano

Tier: T2 (sinais: objetivo vago "SOTA em leveza e fluidez", vários módulos, patch em dependência vendorizada)

## Resumo
- R1: diagnosticar o ny-pi (`~/code/pi-harness`) com evidência de logs, traces e processo vivo.
- R2: corrigir os erros e avisos reais capturados.
- R3: deixar o ny-pi leve e fluido, com metas medidas e reproduzíveis, sem perder qualidade.
- Estimativa: 8 tarefas, 2 ondas de escritores (até 4 em paralelo, arquivos disjuntos), 1 gate final. Registro vivo: `docs/perf-sota.md`.

## Diagnóstico (fatos medidos em 2026-11-18, `~/.pi/agent/diag/{diag,traces}.jsonl*`)
- F1: `edit` p50 3.005 ms e `write` p50 2.603 ms. Causa: `vendor/pi-lsp/extensions/pi-lsp/index.ts:547` dorme `diagnosticsWaitMs` fixo (1.000–6.000 ms em `lsp.json`) por servidor, em série.
- F2: os 53 agentes mandam ler `$CLAUDE_CONFIG_DIR/docs/agent-contract.md`; o `read` não expande variável (só `~`, `path-utils.js:42`). Mais de 50 falhas ENOENT em 3 dias, uma chamada perdida por subagente.
- F3: `git-delivery`, `swarm-worker` e `gate-runner` pedem `timeout` de 2.000–3.600 s ao `bash`; o teto é 1.800 s (`extensions/bash-timeout/index.ts:25`). Mais de 35 recusas e 6 alertas de "tool em laço".
- F4: o processo `pi` desta sessão usou 7 min 17 s de CPU em 16 min 20 s (44,6% de um núcleo) e 647 MB de RAM. Hipótese não comprovada: animações contínuas a 33 ms (`working-status`, shimmer e pulso das ferramentas, título) redesenham o transcript inteiro.
- F5: o detector marca `question` como "tool travada" após 10 min, embora ela só aguarde o usuário (falso alerta, 3 ocorrências).
- F6: o cartão 08 aplicado em `extensions/ui-visual/tools.ts` só foi validado pelo E2E do mock; os testes unitários de `ui-visual` não foram rodados.
- Sem defeito no ny-pi: erros 429 e falhas de compactação (cota da conta), Exa 402 (créditos), timeouts do hook de status de 5 s (máquina com carga 20–46), crash `hintLine` de 14/11 (já ausente do código).

## Decisões e suposições
- A1 (~70%, ⚠ base: regra do dono "decidir sozinho, opção recomendada"): metas de R3 no mock com histórico de 400 entradas: CPU em repouso ≤ 1% de um núcleo; CPU com animação ativa ≤ 12%; sobrecarga pós-edição do LSP p50 ≤ 400 ms quando o servidor responde; tempo até o prompt sem regressão acima de 10%. Vetar se quiser outros números.
- A2 (~75%, ⚠ base: a instrução "sem subagents" foi dada para a tarefa do mock): este plano usa `swarm-worker` em faixas paralelas, conforme o contrato. Vetar para execução só na sessão principal.
- A3 (~90%, base: `git status` com 195 arquivos em andamento no ramo `feat/ui-onda9-harness`, incluindo `tools.ts`): nada de commit, push ou PR neste plano; as mudanças ficam na árvore de trabalho junto com a onda em curso.
- A4 (~92%, base: `path-utils.js:42` expande `~`; `bin/pi:131` fixa o diretório; `scripts/check-refs.py:35` aceita o prefixo): F2 se corrige trocando o texto dos agentes para `~/.pi/agent/claude-home/docs/agent-contract.md`, sem código novo.
- A5 (~90%, base: hooks custam ~60 ms + ~50 ms por ferramenta contra turnos de 5–17 s): hooks (`guard.py`, `hook-dispatch.sh`, status) ficam fora; mudar o guard é decisão de segurança do dono.
- D1: espera do LSP guiada por evento, com teto no valor atual. Rejeitado: só reduzir os números de `lsp.json` (perde erros em projetos lentos).
- D2: limitador de cadência por ocupação do laço de eventos (`performance.eventLoopUtilization`), só se o perfil confirmar a hipótese de F4. Rejeitado: baixar a cadência fixa para todos (piora a fluidez em sessão leve).

## Aceitação
AC1: WHEN `edit` ou `write` termina e o servidor LSP publica diagnósticos da nova versão do documento THE SYSTEM SHALL devolver o resultado até 400 ms após a última publicação, sem esperar `diagnosticsWaitMs` inteiro.
AC2: IF nenhuma publicação da nova versão chegar THEN THE SYSTEM SHALL esperar no máximo `diagnosticsWaitMs` e devolver o que estiver guardado, como hoje.
AC3: WHEN o servidor publica uma lista vazia e, dentro da janela de assentamento, uma lista com erros THE SYSTEM SHALL relatar os erros.
AC4: WHEN um arquivo casa com mais de um servidor LSP THE SYSTEM SHALL consultar os servidores em paralelo e manter a ordem atual da saída.
AC5: WHEN um subagente segue a primeira instrução do seu arquivo THE SYSTEM SHALL abrir o contrato de agentes na primeira leitura, sem ENOENT.
AC6: WHEN um agente de entrega ou de gate roda um comando longo THE SYSTEM SHALL instruí-lo a usar `timeout` de no máximo 1.800 s e a retomar com `status`.
AC7: WHEN a ferramenta `question` fica aberta por mais de 10 min THE SYSTEM SHALL não registrar "tool travada".
AC8: WHEN o medidor roda no mock com histórico de 400 entradas THE SYSTEM SHALL gravar CPU em repouso, CPU com animação, memória e tempo até o prompt em `docs/perf-sota.md`.
AC9: WHEN o ny-pi está em repouso no cenário medido THE SYSTEM SHALL usar no máximo 1% de um núcleo.
AC10: WHEN uma ferramenta está em execução com animação no cenário medido THE SYSTEM SHALL usar no máximo 12% de um núcleo.
AC11: WHEN os testes de `extensions/ui-visual` rodam THE SYSTEM SHALL passar com o cartão 08 aprovado, sem alterar o diff de `edit` nem os blocos de código.

## Limites, riscos e rollback
- Fora de escopo: hooks e guard (A5); apagar `checkpoints` (368 MB, 1.792 entradas) e `sessions` (512 MB), que é exclusão e pede decisão do dono; atualizar pi-code 1.7.0→1.9.0 e os outros 2 componentes; créditos e cotas de contas; redesenho de UI.
- Riscos: servidor que publica erros semânticos depois da janela de assentamento → teste de equivalência com servidores reais e campo opcional `diagnosticsSettleMs` por servidor; medição ruidosa com a máquina carregada → medir tempo de CPU do processo, não tempo de relógio, em fila única; limitador mascarar um gargalo real → só entra se o perfil apontar renderização.
- Rollback: reverter os arquivos tocados na árvore de trabalho (`git checkout -- <arquivo>` apenas nos arquivos novos deste plano; em `tools.ts` e outros com trabalho alheio, reverter só os trechos). O patch do pi-lsp volta reaplicando o `pi-lsp.patch` anterior.

## Fase 1: medir e corrigir defeitos independentes (onda paralela)
1. Criar medidor e gravar a linha de base
   - agente: swarm-worker (Sonnet) · arquivos: `docs/perf-sota.md`, `bin/ny-pi-mock-src/perf.mjs`, `bin/ny-pi-mock` · after: nenhum · AC: AC8.
   - Ler antes: `docs/ny-pi-mock.md`, `bin/ny-pi-mock-src/{e2e.test.mjs,history.ts}`.
   - `perf.mjs` abre o mock em tmux privado, semeia 400 entradas de histórico e mede por 20 s cada: repouso e ferramenta em execução. Métricas: tempo de CPU do processo `node` do sandbox (ticks de `/proc/<pid>/stat`), RSS e tempo até `MOCK offline`.
   - `bin/ny-pi-mock` aceita `NY_PI_MOCK_PROF_DIR`: quando definido, monta o diretório com escrita no sandbox e passa `--cpu-prof --cpu-prof-dir` ao node. Sem a variável, nada muda.
   - Gravar em `docs/perf-sota.md`: objetivo, AC, números da linha de base e os 10 maiores pontos do perfil com percentual.
   - check: `node bin/ny-pi-mock-src/perf.mjs --json` · pronto: quatro métricas e o perfil registrados.
2. Trocar a espera fixa do LSP por evento
   - agente: swarm-worker (Sonnet) · arquivos: `~/.pi/agent/vendor/pi-lsp/extensions/pi-lsp/{index.ts,post-edit.ts,post-edit.test.ts}`, `patches/third-party/pi-lsp.patch`, `third-party.json`, `lsp.json.example` · after: nenhum · AC: AC1–AC4.
   - Ler antes: `scripts/install-lib.sh` (como o patch é aplicado e conferido), `index.ts:200–230` (armazenamento com `version`) e `index.ts:528–560`.
   - Teste primeiro (falhando): servidor falso que publica em 50 ms; sem publicação; vazio seguido de erro; dois servidores.
   - Implementar: após `didSave`, esperar a primeira publicação da URI com `version` ≥ versão do documento (sem versão: a primeira recebida depois do `didChange`); depois, 300 ms sem nova publicação (`diagnosticsSettleMs`, opcional por servidor); teto total `diagnosticsWaitMs`. Servidores em `Promise.all`, saída na ordem original.
   - Equivalência: com `typescript` e `pyright` reais, um arquivo com erro de tipo deve gerar o mesmo texto da espera fixa.
   - Regenerar `pi-lsp.patch` a partir do tarball fixado em `third-party.json`.
   - check: `node --test ~/.pi/agent/vendor/pi-lsp/extensions/pi-lsp/post-edit.test.ts && bash scripts/test_install.sh` · pronto: AC1–AC4 verdes e patch reaplicável.
3. Corrigir caminho do contrato e teto de tempo
   - agente: swarm-worker (Sonnet) · arquivos: `claude-home/agents/*.md` (53), `claude-home/skills/{atualizador,git-workflow}/SKILL.md` · after: nenhum · AC: AC5, AC6.
   - Trocar `$CLAUDE_CONFIG_DIR/docs/agent-contract.md` por `~/.pi/agent/claude-home/docs/agent-contract.md` na instrução de leitura.
   - Em `git-delivery.md`, `gate-runner.md` e `swarm-worker.md`: uma linha dizendo que o `bash` recusa `timeout` acima de 1.800 s; para `git-deliver`, limitar cada chamada a 25 min com a opção de tempo que o `--help` do script define e retomar com `status` e `ship`. Conferir a opção em `claude-home/bin/git-deliver` antes de escrever.
   - check: `python3 scripts/check-refs.py && python3 scripts/ci/instruction_budget.py` e `rg -l 'CLAUDE_CONFIG_DIR/docs/agent-contract' ~/.pi/agent/claude-home/agents` vazio · pronto: zero ocorrências e orçamento de instruções respeitado.
4. Tirar `question` do alerta de tool travada
   - agente: swarm-worker (Sonnet) · arquivos: `extensions/diagnostico/` (detector e seu teste) · after: nenhum · AC: AC7.
   - Teste primeiro: `question` aberta há 11 min não gera alerta; `bash` aberto há 11 min continua gerando.
   - check: `node --test extensions/diagnostico/test/` · pronto: os dois casos verdes.

## Fase 2: fluidez (depois da linha de base)
5. Corrigir o maior consumo de CPU
   - agente: swarm-worker (Sonnet) · arquivos: `extensions/ui-visual/motion/{motion.ts,vivo.ts,test/motion.test.ts}` e o arquivo próprio apontado pelo perfil · after: 1 · AC: AC9, AC10.
   - Regra: se a renderização da TUI tiver 50% ou mais das amostras com animação ativa, implementar D2 em `motion.ts`: fator 1, 2, 4 ou 8 sobre a cadência contínua (teto 250 ms); dobra quando a ocupação do laço passa de 0,30 em 1 s e cai à metade abaixo de 0,12; transições de 16 ms não mudam; sem assinantes o fator volta a 1.
   - Caso contrário: corrigir cada ponto de código próprio com 5% ou mais das amostras; ponto em pi core ou pi-code só entra em `docs/perf-sota.md` como pendência, sem patch.
   - Teste primeiro para o limitador (relógio e ocupação injetados).
   - check: `node --test extensions/ui-visual/motion/test/motion.test.ts && node bin/ny-pi-mock-src/perf.mjs --json` · pronto: AC9 e AC10 dentro da meta, ou diferença explicada no registro.
6. Conciliar testes do cartão 08
   - agente: swarm-worker (Sonnet) · arquivos: `extensions/ui-visual/test/tools/*.test.ts`, `docs/ny-pi-mock.md` · after: 5 · AC: AC11.
   - Rodar os testes; onde falharem por causa do cartão aprovado pelo dono, atualizar a expectativa e registrar contrato antigo e novo em `docs/perf-sota.md`. Não afrouxar asserções de `edit`, diff e blocos de código.
   - check: `node --test extensions/ui-visual/test/` · pronto: suíte verde e mudança de contrato registrada.

## Fase 3: fechamento
7. Rodar o gate final uma vez
   - agente: gate-runner (Sonnet) · arquivos: nenhum · after: 2, 3, 4, 5, 6 · AC: AC1–AC11.
   - check: `bash scripts/ci/run-static.sh && node --test bin/ny-pi-mock-src/e2e.test.mjs && node bin/ny-pi-mock-src/perf.mjs --json` · pronto: tudo verde; falhas voltam ao dono da tarefa (até 2 rodadas).
8. Revisar a execução e registrar o aprendizado
   - agente: plan-reviewer (Sonnet), depois sessão principal · arquivos: `docs/perf-sota.md` · after: 7 · AC: AC1–AC11.
   - Fechar o registro com antes e depois por métrica, pendências fora de escopo (hooks, limpeza de `checkpoints`, atualização do pi-code) e capturar no IA-Brain a causa da espera do LSP.
   - check: `rg -n 'Antes|Depois|Pendências' docs/perf-sota.md` · pronto: `PLAN_REVIEW: complete`.

## Fase 4 (acrescentada pelo dono em 2026-11-18): sincronia e observabilidade entre Plano, Agentes e Runs

Pedido literal: "inclua no plano correcoes se acha para sincronia total do estado do Plan, agent real time ver oque estao fazendo e estados e observabnilidade precisa entre agents, plan e Runs, sincronia total tmb entre eles". Ordem de execução: 9 → 10 → 11 → 7 (gate) → 8 (revisão). O rastreador do plano só conhece as etapas 1–8; as etapas 9–11 são acompanhadas aqui e pelo `todo`.

Sintomas já observados nesta sessão (sementes da auditoria):
- S1 (RETIRADO em 2026-11-19: erro do orquestrador, não defeito): as tags `[DONE:1] [DONE:3] [DONE:4]` nunca foram escritas; a resposta de 23:48:20Z relatou os resultados sem as tags e o rastreador estava correto. Fica como pergunta de auditoria, não como defeito: o rastreador depende só de uma tag em texto livre que o modelo pode esquecer, e nada avisa quando uma resposta relata etapa concluída sem a tag, nem liga as caixas de `## Progresso` do registro ao rastreador.
- S2: `persistState()` grava o estado inteiro do plano a cada `turn_end`, inclusive em cada nova tentativa com erro de rede (12 erros `EAI_AGAIN` seguidos): 105 entradas, 671 KB no arquivo da sessão, sem mudança de conteúdo.
- S3: com uma chamada paralela de 2 faixas rodando, `subagent {status: true}` respondeu "No background runs in this session" e listou só `fg-472d685c (swarm-worker) running — moved to the background`; a segunda faixa não aparece e o id é `fg-`.
- S4: três fontes de progresso sem ligação: rastreador do plano, caixas de `## Progresso` neste registro (marcadas pelos workers) e a ferramenta `todo`.
- S5: o detector avisa "tool subagent rodando há 10 min" para subagentes longos e legítimos (ruído).

AC12: WHEN o modelo conclui uma etapa do plano THE SYSTEM SHALL registrar a conclusão no estado do plano mesmo que a mensagem tenha chamadas de ferramenta e nenhum bloco de texto gravado.
AC13: WHEN o estado do plano não mudou desde a última gravação THE SYSTEM SHALL não acrescentar nova entrada `plan-mode` à sessão.
AC14: WHEN uma chamada `subagent` paralela ou em segundo plano está em andamento THE SYSTEM SHALL listar em `status` cada faixa com agente, estado e id.
AC15: WHEN um agente ou run muda de estado (iniciou, rodando, concluiu, falhou, cancelado) THE SYSTEM SHALL refletir o mesmo estado no painel de agentes, na seção de runs e na seção do plano no desenho seguinte.
AC16: WHEN a auditoria termina THE SYSTEM SHALL ter em `docs/sync-observabilidade.md` cada defeito com evidência `arquivo:linha`, reprodução e correção mínima proposta.

9. Auditar sincronia Plano, Agentes e Runs
   - agente: swarm-worker (Sonnet), só leitura de código · arquivos: `docs/sync-observabilidade.md` · AC: AC16.
10. Corrigir estado do plano
   - agente: swarm-worker (Sonnet) · arquivos: definidos pela auditoria (patches em `claude-home/patches/pi-code/` e/ou `extensions/todo-sync`, `extensions/plan-gate.ts`) · after: 9 · AC: AC12, AC13.
11. Corrigir visibilidade de agentes e runs
   - agente: swarm-worker (Sonnet) · arquivos: definidos pela auditoria · after: 9 · AC: AC14, AC15.

## Progresso

- [x] 1 medidor e linha de base
- [x] 2 espera do LSP por evento
- [x] 3 caminho do contrato e teto de tempo
- [x] 4 question fora do alerta de tool travada
- [x] 5 maior consumo de CPU
- [x] 6 testes do cartão 08
- [x] 9 auditoria de sincronia Plano / Agentes / Runs (registro: `docs/sync-observabilidade.md`)
- [x] 10 corrigir estado do plano (D1–D7 + canal `pi-code:plan-state`; D13 depende do grupo B e fica para o fim; ver `## Registro de decisões`)
- [x] 11 corrigir visibilidade em tempo real de agentes e runs (patch `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-fleet-sync.patch`; D8–D12 e cache do contexto do painel)
- [x] 12 D13 agente na seção do plano
- [x] 13 D14 marcação só na resposta final
- [x] 14 D15 retorno de faixa sobrevive ao /reload
- [x] 7 gate final (executado; vermelho por causas anteriores ao plano, ver `## Gate final`)
- [x] 8 revisão e aprendizado (`plan-reviewer`: 1ª passada `gaps` em 4 pontos do registro, corrigidos; ver `## Revisão`)

## Linha de base

Medido em 2026-11-18, mock `ny-pi-mock` (tmux 120x40), transcript de 400 entradas, execuções em série, máquina carregada (`uptime` no início: load 30,11 / 25,68 / 31,26 na 2ª execução; 14,7–15,8 nas demais). Métrica: tempo de CPU (utime+stime) do processo `pi` do sandbox, em % de um núcleo.

Comando: `node bin/ny-pi-mock-src/perf.mjs --json` (saída `{startup_ms, entries, idle_cpu_pct, active_cpu_pct, idle_rss_mb, active_rss_mb}`).

Como funciona o medidor (`bin/ny-pi-mock-src/perf.mjs`, sem dependências):
- Abre o mock em `tmux -L ny-perf-<pid>` e espera `MOCK offline` (`startup_ms`, relógio, inclui o preflight do bwrap).
- O pid do node é o descendente do painel tmux (python > bwrap > bwrap > `pi`) cujo `/proc/<pid>/comm` é `pi` (o pi renomeia o processo, então `cmdline` não serve). Ticks de `/proc/<pid>/stat` (campos 14+15) ÷ `CLK_TCK` ÷ intervalo; RSS de `VmRSS`.
- Histórico: `/mock-ui historico completo` e depois `/mock-ui ferramentas leitura` repetido (5 entradas cada) até >= 400. `historico` troca a sessão (não acumula), por isso a repetição usa o turno de leitura. A contagem é verificável: linhas do `.jsonl` da sessão em `/proc/<pid>/root/tmp/h/agent/sessions` menos o cabeçalho (todas as execuções: exatamente 400).
- Repouso: 20 s com o prompt ocioso. Animação: `/mock-ui chat cancelar`, o turno que o mock segura por até 120 s com o spinner de "trabalhando" (nenhum cenário mantém uma ferramenta rodando; este é o turno ativo mais longo e usa a mesma cadência de animação). Depois Esc e `/quit`; o servidor tmux é sempre morto no `finally`.
- Perfil: `NY_PI_MOCK_PROF_DIR=<dir existente>` (em `bin/ny-pi-mock`, sem editar o `launcher.py` compartilhado) monta o diretório com escrita em `/tmp/prof` no sandbox e põe `--cpu-prof --cpu-prof-dir=/tmp/prof` depois do executável node; o `.cpuprofile` só é gravado na saída graciosa, por isso o medidor termina com `/quit`. Sem a variável, o launcher é idêntico ao anterior.

| execução | startup_ms | entries | idle_cpu_pct | active_cpu_pct | idle_rss_mb | active_rss_mb |
|---|---|---|---|---|---|---|
| 1 | 1665 | 400 | 1,30 | 25,62 | 259,9 | 318,8 |
| 2 | 1775 | 400 | 1,00 | 26,65 | 256,8 | 315,4 |
| 3 (com `--cpu-prof`, sobrecarga do perfilador) | 2436 | 400 | 4,15 | 42,54 | 290,5 | 348,6 |
| 4 (com `--cpu-prof`, perfil analisado) | 2605 | 400 | 3,00 | 30,79 | 280,5 | 340,4 |

Linha de base (execuções 1–2 sem perfilador): repouso ~1,0–1,3% (meta AC9 ≤ 1%: no limite), animação ativa ~26% (meta AC10 ≤ 12%: 2x acima), RSS 257–260 MB em repouso e 315–319 MB ativo, tempo até o prompt ~1,7 s. As execuções com `--cpu-prof` inflam a CPU e não valem como linha de base.

Perfil: `/tmp/ny-pi-prof-base/CPU.20261118.234437.2.0.001.cpuprofile` (execução 4, 58 s, amostragem 1 ms; a janela de animação = últimos 22 s do perfil, a de repouso = os 20 s anteriores; script `/tmp/ny-prof-an.mjs`). Percentuais sobre as amostras não ociosas (`(idle)` excluído; o node fica ocioso 76% do tempo na janela ativa).

Dez maiores pontos de *self time*, janela de animação ativa (4.793 amostras não ociosas):

| # | % | função | arquivo |
|---|---|---|---|
| 1 | 22,4 | `(program)` | nativo |
| 2 | 20,6 | `truncateToWidth` | bundle do pi (`chunk-FF6XOTWB.js`) |
| 3 | 18,9 | `horaDe` | `extensions/ui-visual/tools.ts:137` |
| 4 | 5,6 | `(garbage collector)` | nativo |
| 5 | 2,2 | `render` | bundle do pi (`chunk-FF6XOTWB.js`) |
| 6 | 1,9 | `proto.render` | `extensions/chat-margin/index.ts:52` |
| 7 | 1,6 | RegExp `(?:\x1b\[(?:0\|49)?m\|…)*$` | bundle do pi (corte de ANSI) |
| 8 | 1,5 | `estimateTokens` | bundle do pi (`chunk-VEJDBY3O.js`) |
| 9 | 1,4 | `fit` | `extensions/ui-visual/motion/chrome.ts:20` |
| 10 | 1,3 | `render` | `extensions/ui-visual/tools.ts:190` |

Janela total do perfil (51.416 amostras, 12.298 não ociosas): `(program)` 17,1%, `truncateToWidth` 15,5%, `horaDe` 15,1%, GC 6,4%, `render` 2,1%, `estimateTokens` 1,3%, `chat-margin proto.render` 1,2%, RegExp ANSI 1,0%, `ansiCodeLength` 1,0%, `fit` 0,9%. Em repouso (597 amostras não ociosas, 96,9% ocioso): `truncateToWidth` 19,6%, `(program)` 19,4%, GC 18,1%, `horaDe` 15,6%.

**Renderização da TUI com animação ativa: 69,6% das amostras não ociosas** (ancestral `doRender`, `renderLayoutFrame`, `layoutComponent`, `measureHeight` ou `renderCached` na pilha; 16,9% de todas as amostras). Janela total: 55,8%; repouso: 58,3%. Isso passa do limiar de 50% da tarefa 5, que então implementa D2 (limitador de cadência em `motion.ts`).

Código das extensões `ny` na pilha: 64,4% das amostras não ociosas na animação ativa, quase todas dentro da renderização (63,6%): ou seja, o desenho chama código nosso. Achado para a tarefa 5: `horaDe` (`tools.ts:137-151`) sozinho é 18,9% do self time; ele chama `toLocaleTimeString('pt-BR', …)` a cada desenho de cada ferramenta com hora (cria um formatador Intl por chamada). Memoizar o texto por `toolCallId` (ou um `Intl.DateTimeFormat` único) tende a eliminar esse custo. `truncateToWidth` (pi core, 20,6%) é chamado por `fit`/`render` das extensões e pelo core; se não for corrigido nas extensões, fica como pendência de pi core.

Limitações: o perfil pega a janela por posição no fim da execução (inclui ~2 s do Esc e `/quit` na janela ativa); o cenário ativo é turno "trabalhando" do mock, não uma ferramenta de fato; carga alta da máquina varia a CPU de relógio, mas não o tempo de CPU do processo.

## Surpresas

- Os 19 testes de `ui-visual` que falhavam na primeira rodada falhavam em parte porque o shell do subagente tem `PI_CODE_SUBAGENT=1`: `tools.ts` não registra nada nesse caso (`on.session_start is not a function`). Rodar com `env -u PI_CODE_SUBAGENT` (como a CI) reduziu a 11 falhas, todas causadas pelo cartão 08.
- A ocupação do laço (ELU) sobe pouco no mock: com a CPU já em ~14% o limitador D2 raramente passa de f = 2; o ganho vem sobretudo de `horaDe` e do cache da linha terminada.

## Registro de decisões

- Etapa 10 (D1–D7, `docs/sync-observabilidade.md`; patch `zzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-state.patch`, `plan-mode/{index,section,done-view}.ts`): contrato antigo → novo, razão: AC12/AC13. Antigo: `persistState` grava a cada `turn_end`; `plan-gate` e plan-mode divergem sobre marcador; seção sem espera/bloqueio/todo; sem `session_tree`; marcas/pausa só em memória. Novo: grava só se o JSON do estado mudou (D1); `plan-gate` só reconhece marcador em linha própria (D2) e o bloqueio lista os passos abertos (D5); seção mostra `em espera`/`bloqueado` e `todo d/t · item` no rodapé (D3/D4, relógio da etapa parado durante a espera); `restoreFromBranch` também em `session_tree` (D6); `marks` e `paused` persistem, relógios não (rodapé "desde a retomada") (D7).
- Etapa 10, `DONE_RULE`: acrescenta "tick box n under `## Progresso` of the task's /docs record" (D5); `plan-done-rule.test.ts` ganhou a asserção de `Progresso`, nada afrouxado. Canal `pi-code:plan-state` `{executing, step?, done, total}` (step = 1ª etapa aberta) publicado só quando muda, para o grupo B (D11c).

- Etapa 11 (D8–D12, `docs/sync-observabilidade.md`): contrato antigo → novo, razão: AC14/AC15. `subagent {status}` lista toda faixa do fleet (qualquer profundidade; em curso e terminadas há < 30 min) como `id agente estado [depth N] · Nt · $x · mm:ss · atividade`, sem "(Ctrl+B)" e sem "No background runs" quando há faixas; a faixa nasce em `run.ts` antes do spawn (`activity: starting`); `/new`/resume contam as faixas `fg-` vivas.
- Etapa 11, D9/D10/D11: a Run section lê o fleet (horários e estado do registro, `onChange` em vez de poll); `partial` aditivo no `RunRecord` (rótulo `parcial` na Run section; o painel `fleet-ui/panel.ts`/`viewer.ts` não era dono desta etapa: `row.partial` já vem do view-model, falta só o texto); `toolCallId`/`planStep` aditivos (planStep só se `pi-code:plan-state` existir), evento `pi-code:subagent` e traço `pi.subagent start|stop` com `pi.run.id`. D12: `subagent` entra em `TOOLS_SEM_ALERTA` do detector (testes antigos que usavam `subagent` como tool travada passaram a usar `bash`/`web_fetch`).
- Etapa 11, item de desempenho: `getContextUsage()` do painel guardado por 1000 ms (relógio `now`), zerado em `turn_end`, `message_end`, `session_compact`, `agent_settled` e `session_start`.
- T5 D2 implementado (a renderização da TUI tinha 69,6% das amostras ativas, ≥ 50%): `relogio.ocupacao()` (delta de `performance.eventLoopUtilization`), janela ≥ 1000 ms; > 0,30 dobra, < 0,12 divide, entre os dois mantém; teto 250 ms; sem assinantes f = 1. A 1ª leitura de cada ciclo só abre a janela. `vivo.ts` não mudou: `parado` já usa `intervaloContinuo()`.
- T6, cartão 08 (contrato antigo → novo, razão: pedido do dono "Aplica ele real já", 2026-11-18): linha da chamada de read/bash/grep/find/ls. Antigo: `  ícone texto`, sem preenchimento, largura inteira (78 em w = 80, 198 em w = 200), `renderShell` padrão. Novo: cartão de 60 colunas (margem 2 + 58), 1 coluna de respiro (`   ícone`), preenchido até a borda com fundo, `renderShell: 'self'`; a hora fica na borda direita do cartão. Testes atualizados: `ficha()` em `base.ts` devolve o texto do cartão no formato antigo (recuo de 2, sem preenchimento) para as asserções de conteúdo; largura 78/198 → 60; `renderShell` 'self' para esses 5; tema de marcas `<cor>` (largura visível) → `ansiTags` de largura zero nos 2 testes de cor do estado, porque o cartão corta pela largura visível; no teste "fundo do Box" a largura exata (texto + 2) virou 60 fixa e "um a menos corta" virou "encolhe o preenchimento" (o corte com `…` segue testado no laço do grep longo). Asserções de edit, diff e blocos de código intocadas. Limite desta afirmação (revisão do plano): "edit e diff intocados" vale só para as mudanças deste plano; o diff desses testes contra `HEAD` também contém reescritas da onda ui-onda9 (edit Variante 2, subagente, run, todo, memory), anteriores ao plano e não separáveis sem commit. O AC11 foi aceito pela suíte verde (141), não por diff contra `HEAD`.

- T2 (LSP): `beginDiagnosticsWait` em `post-edit.ts` (assina antes do didChange; 1ª publicação com version ≥ enviada + 300 ms de assentamento; teto `diagnosticsWaitMs`); servidores em `Promise.all`. Real: pyright ~560 ms (antes 2500), typescript-language-server ~660 ms com erro, mas edição limpa→limpa não gera publicação e segue no teto (2500 ms, como antes). `diagnosticsSettleMs` por servidor exige 1 linha em `_shared/config/config.ts` (+ tipo): fora do escopo, pendente. (Superado em 2026-11-19: `diagnosticsSettleMs` por servidor foi implementado depois, em `_shared/config/config.ts`, `_shared/types.ts` e `lsp.json.example`, com teste; não é mais pendência.)
- Etapas 12–14 (D13–D15, `docs/sync-observabilidade.md`): D13: a linha da etapa em andamento ganha `· <agente> <estado>` das faixas do fleet com `RunRecord.planStep === step` e `running` (`plan-mode/section.ts` assina `fleetSourceForUi().onChange`; sem `planStep` ou sem fonte, igual a hoje). D14: contrato antigo → novo, razão: o provedor entrega o texto antes de chamadas de ferramenta como bloco `thinking` resumido, sem a tag; antigo: "escreva `[DONE:n]` na resposta", novo: a tag conta só na resposta final do turno (sem chamada de ferramenta) e se repete lá; ler `thinking` rejeitado; `plan-gate` alinhado. D15: o evento de fim de faixa passa pela instância atual (`results.deliver`) e `run.ts` isola o sink; o resultado de cada faixa não é mais trocado por erro de ctx velho.

## Resultados (Antes / Depois)

Mesmo medidor, 400 entradas, execuções em série sem perfilador (carga da máquina 11–26 durante o "depois"; antes: 15–30). % de um núcleo.

| métrica | antes (2 exec.) | depois (4 exec.) | meta |
|---|---|---|---|
| CPU em repouso | 1,30 / 1,00 | 1,80 / 2,35 / 1,15 / 2,40 | ≤ 1% (AC9) |
| CPU com animação | 25,62 / 26,65 | 16,95 / 12,35 / 14,24 / 15,63 | ≤ 12% (AC10) |
| RSS repouso (MB) | 259,9 / 256,8 | 185,9 / 184,7 / 186,1 / 182,7 | – |
| RSS ativo (MB) | 318,8 / 315,4 | 243,9 / 240,8 / 243,1 / 239,7 | – |
| startup_ms | 1665 / 1775 | 1772 / 4800 / 2571 / 6784 | sem regressão > 10% (ruído de carga) |

Veredito: animação ~26% → ~12–17% (queda de ~45%): **AC10 não atingido de forma estável** (1 de 4 execuções ≤ 12%). Repouso: **AC9 não atingido** (1,15–2,4%, pior que a linha de base, mas sem mudança de código nesse caminho: o ruído da máquina carregada domina; no perfil o repouso tem 95% de ociosidade). Nenhum número foi maquiado; o medidor não foi alterado.

Perfil depois (`/tmp/ny-pi-prof-depois`, analisador `/tmp/ny-prof-an2.mjs`), 10 maiores pontos de *self time* na janela de animação (2.145 amostras não ociosas): `truncateToWidth` pi core 11,8%; `(program)` 8,5%; `render` pi core 6,9%; GC 6,9%; `estimateTokens` pi core 5,0%; `proto.render` chat-margin 4,6% (arquivo alheio); RegExp ANSI do pi 3,8%; `render` `tools.ts:256` 2,3%; `inset.ts:18` chat-margin 2,2%; `inset.ts:34` chat-margin 1,5%. `horaDe` saiu da lista (18,9% → 0). A renderização da TUI segue em 80% das amostras ativas, mas o código próprio nos meus arquivos tem no máximo 2,3% (< 5%): nada mais a corrigir ali.

Mudanças: (a) `horaDe` com `Intl.DateTimeFormat` único e memo por chamada (limite 300); (b) cache da linha terminada em `callComponent` (chave: largura, estado, duração, hora, `uiRight/uiStatus/uiDica/uiLinha`, atalho, cores do tema; `invalidate()` limpa; chamada rodando ou dentro do assentamento recalcula); (c) D2 em `motion.ts` (fator 1/2/4/8, teto 250 ms, ELU por `relogio.ocupacao`). Não medi cada passo isoladamente: o D2 foi feito primeiro por TDD e os três entraram juntos na medição.

### Fechamento da etapa 5 pela sessão principal (2026-11-19)

O perfil depois da onda 2 ainda mostrava código do ny-pi refeito a cada quadro para o histórico inteiro. Corrigido, sem mudança visual:
- `extensions/ui-visual/tools.ts`: `memo` por chave em `lines` (linhas fixas) e `diffComponent` (diff do edit), e pintura guardada em `boxed` enquanto o interior, a largura e o fundo não mudam (eram 4,6% + 2,5% + 1,2% das amostras não ociosas).
- `extensions/chat-margin/{index,inset}.ts`: `mesmaSaida` guarda a margem aplicada por componente enquanto as linhas de entrada não mudam (6,3%); teste novo em `inset.test.ts`.
- `extensions/ui-visual/header.ts`: cabeçalho guardado por largura depois da abertura (2,6–3,0%).

| métrica | antes (2 exec.) | onda 2 (4 exec.) | final (3 exec., carga 26–34) |
|---|---|---|---|
| CPU com animação (% de um núcleo) | 25,62 / 26,65 | 16,95 / 12,35 / 14,24 / 15,63 | 7,40 / 9,60 / 8,75 |
| CPU em repouso | 1,30 / 1,00 | 1,80 / 2,35 / 1,15 / 2,40 | 1,15 / 1,25 / 1,40 |
| RSS repouso (MB) | 259,9 / 256,8 | 182,7–186,1 | 169,8–174,3 |
| RSS ativo (MB) | 318,8 / 315,4 | 239,7–243,9 | 197,8–202,2 |

AC10 (≤ 12%): atingido nas 3 execuções. AC9 (≤ 1%): não atingido de forma estável (1,15–1,40% sob carga alta; a linha de base já era 1,0–1,3%); nenhum ponto de código próprio aparece no repouso, o resto é o redesenho de 1 Hz do pi core. Amostras não ociosas na janela de animação do perfil: 4.793 → 1.915.

Resta no perfil, fora dos arquivos desta etapa: `getContextUsage`/`estimateTokens` chamado a cada desenho por `pi-code/extensions/subagent/fleet-ui/index.ts:45` (`getMain`), 6,3% das amostras não ociosas: entra na etapa 11 (mesmos arquivos); e o pi core redesenha todos os filhos do chat a cada quadro (sem recorte por janela visível): pendência de pi core.

## Gate final (2026-11-18 21:47–21:49, árvore de trabalho do ramo `feat/ui-onda9-harness`, sem commit)

Comando: `env -u PI_CODE_SUBAGENT -u PI_CODE_SUBAGENT_DEPTH bash scripts/ci/run-static.sh; node --test bin/ny-pi-mock-src/e2e.test.mjs; node bin/ny-pi-mock-src/perf.mjs --json; structure.py --project-root . --json`. Logs: `/tmp/gate-static.log`, `/tmp/gate-e2e.log`, `/tmp/gate-structure.json`.

| verificação | resultado | causa |
|---|---|---|
| E2E do mock (`e2e.test.mjs`) | passa, 2/2 | |
| medidor (`perf.mjs --json`) | sai 0: repouso 1,45%, animação 7,65%, RSS 171/199 MB, prompt em 1,9 s | AC10 atingido; AC9 (≤ 1%) não |
| estrutura (`structure.py` e `structure (changed)`) | passa | |
| skill-lint, install tests (offline), bench oracles | passam | (c) do install pulado: exige rede |
| `run-static.sh` | **falha (exit 1)** | ver abaixo |

Falhas de `run-static.sh`, separadas por origem (busca dos arquivos deste plano no log):
- Deste plano: `check-refs` acusa `bin/ny-pi-mock:31` e `docs/ny-pi-mock.md:32` (a pasta `pi-mock-src` do sandbox não existe no repositório: o `ny-pi-mock` depende do sandbox instalado só em pasta `pi-mock-src` do sandbox instalado no diretório do agente). Tentativa de trazer o sandbox para o repositório desfeita: abria 111 erros de `mypy --strict` e 3 testes que dependem do local instalado. Fica como pendência com decisão do dono. A terceira linha (`docs/sync-observabilidade.md:170`) foi corrigida.
- Anteriores ao plano (nenhum arquivo deste plano citado): `install harness (runner HOME)`, `ruff check/format (changed)`, `mypy --strict (changed)`, `biome`, `shellcheck`, `shfmt`, `markdownlint`, `pytest + coverage` (exit 127), `diff-cover`, `check-refs` (3 caminhos em `compact-at-400k.ts`, `headless-lean`, `bin/pi`), e 6 arquivos de teste node (`extensions/ui` ×3, `hook-msgs`, `claude-compat`, `bypass-permissions`) mais 4 casos de `extensions/diagnostico/test/obs/correlacao.test.ts` em trechos não alterados (ex. linha 104, subcomando `nivel`).
- Não verificado: `zzzzzzz-subagent-model-effort/replay.test.ts` (2 casos) compara a pilha de patches com a árvore instalada e só pode passar depois que `bin/pi` aplicar os dois patches novos no próximo início; a aplicação limpa dos dois sobre a árvore viva foi verificada com `patch --dry-run`.

Testes dos itens do plano (rodados à parte, contra a cópia `/tmp/chk11/pc` com os dois patches): plan-state 10, plan-sota 26, plan-done-rule 1, plan-done-view 10, plan-gate 28, fleet-sync 3, reload 2, run-section 18, tracker 16, subagent-panel 114; `extensions/ui-visual` 141 (1 skip antigo); `extensions/chat-margin` 9; `detector.test.ts` 11; pi-lsp 16.

Ativação: os dois patches foram ligados em `~/.pi/agent/claude-home/patches/pi-code/` (symlinks para o repositório, como os demais); `bin/pi` os aplica no próximo início. Reverter: apagar os 4 symlinks e `patch -R` dos dois arquivos em `~/.pi/agent/npm/node_modules/pi-code/extensions`.

## Pendências fora de escopo

- Custo residual no pi core com animação ativa (perfil depois): `truncateToWidth` 11,8%, `render` (chunk-FF6XOTWB) 6,9%, `estimateTokens` 5,0%, RegExp de corte de ANSI 3,8%. Sem patch (pi core).
- (superado: `chat-margin` recebeu `mesmaSaida` no fechamento da etapa 5.) `extensions/chat-margin` (arquivo alheio): `proto.render` 4,6%, `inset.ts:18` 2,2%, `inset.ts:34` 1,5% das amostras ativas; recomputa o transcript por quadro. Sem patch.
- (superado: AC10 atingido no fechamento da etapa 5; AC9 segue aberto, linha abaixo.)
- `ny-pi-mock` depende de pasta `pi-mock-src` do sandbox instalado no diretório do agente (fora do repositório): `check-refs` fica vermelho nessas 2 linhas até o dono decidir entre trazer o sandbox para o repositório (com tipagem estrita e testes ajustados) ou tirar o `ny-pi-mock` dele.
- AC9 (repouso ≤ 1%): medido 1,15–1,45% sob carga 26–34; sem ponto de código próprio no repouso.
- pi core redesenha todos os filhos do chat a cada quadro (sem recorte pela janela visível): maior custo restante da animação.
- TypeScript: edição limpa→limpa não gera publicação de diagnóstico e ainda espera o teto (`diagnosticsWaitMs`, 2500 ms no `lsp.json` do dono); baixar o teto é decisão do dono.
- ruff, gopls, rust-analyzer e demais servidores do `lsp.json` não foram exercitados com a espera por evento.
- Ramo `feat/ui-onda9-harness`: as falhas anteriores do `run-static.sh` listadas em `## Gate final`.

## Revisão (plan-reviewer, 2026-11-19)

1ª passada: `PLAN_REVIEW: gaps`, sem defeito de código. AC1–AC8, AC10–AC14 e AC16 atendidos; AC9 não atingido (declarado); AC15 parcial (falta o rótulo `parcial` no painel `fleet-ui/panel.ts`, declarado em D10). Nenhuma asserção afrouxada; gate vermelho só cita arquivo do plano nas 2 linhas de `check-refs` já declaradas. Lacunas e tratamento: (1) registro dizia `diagnosticsSettleMs` pendente → marcado superado; (2) este registro citava o caminho do sandbox em forma de referência e reabria `check-refs` → reescrito; (3) etapa 8 aberta → fechada aqui, com a captura no IA-Brain; (4) edição limpa→limpa do TypeScript → pendência do dono, mantida; (5) e (6) alcance de "edit e diff intocados" e do AC11 → limite registrado na decisão T6. Notas do revisor mantidas como pendência: `biome` não analisou o código (config depreciada em `biome.json:6`, anterior ao plano); o aborto do LSP vira um aviso `aborted` por sessão; o teto do LSP conta a partir de `wait()`.

