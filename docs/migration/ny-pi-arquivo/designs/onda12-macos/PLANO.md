# Onda 12 · plano de execução

Status: em execução desde 2026-11-18. Sem commit. Escolhas do dono recebidas em 2026-11-18 (46 de 46).

## Classificação das escolhas

**Sem mudança (12):** paleta, cabeçalho, campo de entrada, estados do campo, fila, painel de detalhe do HUD, linha de trabalho, edit, erro do provedor, interrompido, /painel, /btw.

**Bloco de código:** "manter, com cabeçalho de linguagem + copiar e o corpo embaixo". É o que `code-blocks/blocks.ts:160` já desenha (o mock "hoje" estava simplificado). Nenhuma mudança; conferir na tela.

**Molduras "manter + B":** nenhuma troca global. O cartão arredondado entra só onde a variante escolhida o usa (confirmação; paleta de comandos, se a rodada 2 confirmar).

**Rodada 2 de variantes ([página](rodada-2/index.html)), pedidas nas observações:**
- R1 · ícone de subagente, hook e gate (item hook; também o ícone do subagente B).
- R2 · ícone de "modelos travados" sem emoji (item rodapé).
- R3 · cor de "iniciada" na Task, que hoje parece concluída (item task).
- R4 · pergunta respondida na conversa sem o `│` (item pergunta-chat).
- R5 · paleta de comandos: fusão de A (grupos e teclas) com a busca de B (item comandos).
- R6 · painel de agentes com fundo ou ícone por estado (item agentes).

Até a escolha, cada lane usa o ícone ou a cor de hoje nesses pontos.

## Decisões e interpretações (D1–D16)

- **D1 · ícones por família (icones B):** ler `○` (read, grep, find, ls, lsp), escrever `●` (edit, write, memory), executar `▸` (bash, run). Mantêm o ícone de hoje: web, Task (todo), plan, pergunta e o genérico. Subagente, hook e gate esperam R1. O conjunto ASCII não muda.
- **D2 · teclas em cápsula (teclas B):** helper `teclas()` em `folha/sheet.ts`; cada tecla com fundo `customMessageBg`, verbo em `dim`, no máximo 4 teclas mais `? mais` (regra da onda 4). Vale nos rodapés das folhas e painéis que este plano toca.
- **D3 · HUD "manter + A":** duas linhas (modelo; contexto, 5h e semana em colunas) quando a largura cabe, com o conteúdo de hoje (barras, cores, `renova em`); abaixo disso, as três linhas de hoje.
- **D4 · rodapé A:** `▲ bypass ligado`, `✕ 2 erros · ▲ 1 aviso · alt+e abre`; travados sem emoji (ícone em R2).
- **D5 · plano A:** sem linha de cabeçalho e sem régua; resumo `Plano ███╌╌╌╌╌ 3 de 8 · 12m · $0.42 · 1 bloqueado · 1 falhou`; tarefa em curso com `há 2m`.
- **D6 · título da aba:** o `●` de trabalhando passa a girar. **Supera** a regra "título de aba animado: rejeitado" (onda 10, `onda10-sota/README.md`). Respeita `/movimento`: reduzido e desligado ficam com `●` estático.
- **D7 · mensagem do usuário A:** sem as linhas vazias de fundo em cima e embaixo (paddingY 0 no Markdown do `UserMessageComponent`).
- **D8 · resposta do assistente A:** título sem `#`, código em linha numa cápsula neutra, marcador `•`.
- **D9 · raciocínio A:** fechado `◇ pensou por 8s · ctrl+t abre`; aberto, o texto sob um fio. A duração por bloco pede patch no core.
- **D10 · ferramenta de uma linha A:** sucesso não escreve `concluído` (read, grep, find, ls, write, web, MCP, lsp). `executando` anima do começo ao fim no movimento normal. Pílulas de tecla e hora ficam (decisão da onda 10).
- **D11 · bash A:** comando no título (`$ npm test · 400 linhas · 3.2s`), saída sem `│`; o caminho do log completo continua.
- **D12 · run A, subagente B, Task A:** run em uma linha; subagente sem fundo, em árvore `├ └`; Task com o verbo no título, `#2` apagado e sem percentual.
- **D13 · sinais:** caixas de aviso sem `│`; compactado, recarregado e sessão retomada em linha apagada centralizada (compactado mantém `ctrl+o abre`); notificação do sistema com o resultado.
- **D14 · limite de uso D sem `│`:** uma caixa âmbar com barra em oitavos que avança de verdade (redesenho quando muda o oitavo ou o minuto), depois "retomou" em verde ou "cancelada" em cinza; a caixa vermelha some quando o auto-resume assume; hora em 24 h. Executa a onda 11.
- **D15 · diálogos:** pergunta A com as teclas `1-3 escolhe · ↑↓ move · r recomendada · s pula · esc sai`; confirmação B (botões lado a lado num cartão) com o botão perigoso em vermelho (destrutivo), âmbar (arriscado) ou neutro; histórico A; atalhos A com mais espaço entre as cápsulas.
- **D16 · painéis:** diagnóstico A e /diff A como folha padrão; /avisos mantém a estrutura e a aba recentes ganha o estilo A (grupos por hora, estado em palavra); runs sem `│`; seletores A com busca; /todos B (círculos) com a barra de A e `esc fecha`; agentes em português (cor ou ícone em R6).

## Lanes

| Lane | Itens | Arquivos (donos) |
|---|---|---|
| A · conversa | D1, D7, D10, D11, D12 | `extensions/ui-visual/**`, `extensions/hook-msgs/**` (só ícones) |
| B · sinais | D13 (caixas, divisores), D14 | `claude-home/patches/pi-core/avisos/**`, `.../retomada/**`, `extensions/auto-resume/**`, `extensions/avisos/causa.ts` |
| C · folhas | D2, D4, D15 (confirmação, histórico, atalhos), D16 (diagnóstico, /diff, /avisos) | `extensions/folha/**`, `comandos/**`, `ui/history.ts`, `ui/diff.ts`, `diagnostico/**`, `avisos/painel.ts`, `bypass-permissions/**`, `travar-modelos/**`, `claude-compat/permissions/**` |
| D · pi-code | D5, D15 (pergunta), D16 (runs, /todos, agentes) | `claude-home/patches/pi-code/**` (patch novo no topo da pilha) |
| E · avulsos | D3, D6, D8, D9, D16 (seletores), notificação | `claude-home/bin/hud/**`, `ui/terminal.ts`, `code-blocks/**`, `avisos/notificar.ts`, `avisos/index.ts`, patch novo em `pi-core` |

Limites: 800 linhas por arquivo e 7 arquivos de código por pasta. `ui-visual/`, `ui/` e `avisos/` já têm 7; arquivo novo vai para subpasta. `tools.ts` tem 729 linhas.

## Verificação

Uma vez, no fim: todas as suítes tocadas, `structure.py`, diagnóstico LSP e conferência visual. Testes mudam só onde a decisão do dono troca o contrato; cada troca vai para "Surpresas e mudanças de teste".

## Progresso

- [x] Decisões registradas (este arquivo).
- [x] Rodada 2 de variantes: 10 itens, 31 mocks. Chrome 1400/390 px, seleção, exportação e persistência.
- [x] Cartão do limite e divisores no código. O cartão reaproveita o poll de cancelamento de 250 ms, sem timer adicional, e só pede render quando o oitavo ou o minuto muda. Sem escrita no histórico para o cartão. A instrução interna de retomada continua no contexto, sem aparecer em duplicata no chat.
- [x] HUD em duas linhas onde couber; título animado; tool de uma linha, bash, Task, run e árvore de subagentes no código.
- [x] Histórico, /diff, atalhos e /avisos em código; confirmação em cartão e notificação com trecho da primeira linha em código. Confirmação e cancelamento ainda sem teste de ponta a ponta no terminal.
- [ ] Diagnóstico: alinhar os testes com a folha aprovada, sem perder as verificações de seleção, atalhos, navegação e largura.
- [ ] Markdown, duração do raciocínio e patches de seletores, pergunta, agentes, runs, /todos e plano. Ícones, cor da Task, variantes da pergunta na conversa e paleta aguardam escolha na segunda rodada.
- [ ] Verificação final. Sem commit/push.

## Evidência e mudanças de teste

- Limite: teste `cartão de limite` em `extensions/auto-resume/index.test.ts` reproduziu o erro vermelho duplicado (2 nós em vez de 0), depois passou com barra que avança, um único componente e limpeza do timer. Fixture usa `retry-after` para não depender do cache local. Hora do fallback agora exige `HH:MM`.
- `claude-home/bin/tests/{avisos-core/runtime,retomada-core/retomada}.test.ts`: antigas réguas, ícones e barra vertical dos avisos deram lugar a divisores centralizados e texto alinhado; preservam largura, cor de aviso, resumo expandido e fallback.
- `extensions/ui-visual/test/{icons,tools/{tools,estado}}.test.ts`: famílias de glifos, ausência de `concluído` no sucesso, bash com comando no topo e saída recuada, Task sem percentual, subagente em árvore plana e run expandido com log e saída. Estados de erro, corte, duração e expansão continuam cobertos.
- `extensions/ui/test/terminal.test.ts`: o teste de título estático no modo normal agora avança o relógio e verifica quadros diferentes; os modos reduzidos permanecem estáticos.
- `claude-home/bin/hud/tests/calm-statusline.test.mjs`: testa duas linhas e fallback de três sem perder cores ou dados; o helper de cor localiza cada percentual na linha compartilhada.
- `extensions/avisos/test/painel.test.ts`: Recentes agora usa grupos e palavras com hora à direita; testa as duas faixas de tempo. Fixtures de avisos, diagnóstico e /diff copiam dependências usadas pelos renderizadores reais.
- `extensions/ui/test/history.test.ts`: usa SGR em vez de colchetes para medir largura; colchetes continuam no teste de foco com tema simulado. `extensions/comandos/test/painel.test.ts`: compara largura das cápsulas, não conteúdo.
- `extensions/folha/test/confirm.test.ts` adiciona foco seguro, gravidade visual, Esc, sinal e timeout; `extensions/avisos/test/notificar.test.ts` adiciona a primeira linha da resposta e da pergunta, mantendo o fallback sem trecho. A confirmação bloqueia aceite pelo cartão se a janela não comportar a mensagem e os botões.
- Execução focada em `/tmp/onda12-atual.log`: 367 testes, 343 passaram, 24 falharam (22 no diagnóstico, 2 em /diff). Os dois de /diff passaram na reprodução `/tmp/onda12-diff.log` após trocar as expectativas de seleção/moldura e limpar `l.txt` do teste do diff longo, que contaminava a contagem. O cartão passou novamente em `/tmp/onda12-fecho.log`. A execução ampla do HUD teve timeout. Não é gate final nem prova de ponta a ponta no terminal.
- Estrutura (`structure.py`): 786 arquivos analisados, 0 achados. Hook Impeccable: nenhum achado determinístico no HTML da rodada 2.
- `doces.py --json` sobre toda a árvore suja: 347 sinais, exit 1 (`/tmp/onda12-doces.json`). Mudanças de título de teste e comparação de layout foram sinalizadas como remoção/afrouxamento; os novos contratos correspondentes estão descritos acima. O restante da árvore e o diagnóstico não foram liberados.
- Inventário sem codegraph; leitura de código por `rg`. Consulta do vault: seção “Limite de conta (429) no pi” em `Resources/Patterns/pi-agent-fleet-panel-2026-11.md`; mantida a regra que separa o 429 de conta do retry transitório.
- Travamento (2026-11-18): pi novo a ~100% de CPU trabalhando e 36–60% parado (amostra de 2 min, `run rl7x81`). Causa: chamada `write` sem resultado no histórico (erro do provedor às 19:53) desenhada como "executando"; o brilho chamava `tocar` em todo quadro, o relógio contínuo nunca desligava e o fullscreen redesenhava o chat inteiro a 30 fps. Teste `chamada parcial que este processo não viu começar…` em `estado.test.ts` falhou antes (órfã entrou no redesenho) e passou depois. Correção em `tools.ts` (`runTextoVivo`): só anima com `tool_execution_start` visto neste processo. Suítes de tools e motion: 57/57. Falta medir o CPU parado depois de reabrir o pi.
- Decisão do dono (2026-11-18): "deixe animação e efeitos como tava". A correção em `runTextoVivo` (animar só chamadas vistas começando) e o teste dela foram revertidos; o brilho volta ao comportamento anterior. Achado em aberto, sem correção: com uma chamada sem resultado no histórico, o pi parado gastou 36–82% de CPU nesta sessão de ~1.250 entradas (12 MB). Perfil por inspetor não concluído. Saída combinada: trocar de terminal/sessão. Onda 12 pausada no estado deste arquivo; nada commitado.
