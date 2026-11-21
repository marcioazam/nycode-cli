# Mock interativo do ny-pi

## Objetivo e aceite
A vitrine anterior demonstrava controles genéricos do Pi. Este perfil deve carregar a UI do checkout ny-pi e usar mocks apenas para dados, LLM e efeitos externos. O modo normal não muda.

- `bin/ny-pi-mock` inicia o perfil offline ou recusa sem sandbox; `--list` mostra os cenários executáveis. Sem credenciais, extensões de produção automáticas, Git real, shell real ou rede. Estado descartável.
- Dentro da TUI, `/mock-ui` mostra por categoria os cenários e variantes; `/mock-ui <id> [variante]` aciona a UI e registra no chat o que foi solicitado. `/mock-ui inventario [onda]` lista IDs e indica o que ainda não tem cenário. Uma captura existente não conta como cenário executável.
- Paridade: cada cenário usa o componente, tema e interação reais do ny-pi; só dados, LLM e efeitos externos são fictícios. Usar `pi-claro/pi-noite` do checkout, igual ao ny-pi do dono, não o tema da galeria histórica. Testar tema ativo, estados, expansão por tecla e diálogos na TUI real. Igualdade de pixels depende também do emulador, fonte e dimensões; não presumir paridade para IDs sem cenário.
- Reusar o inventário de `docs/ui-ux-inventory.md` e as fixtures de `docs/ui-ux-gallery/capture` como referência. Validar em tmux componentes reais, pelo menos um fluxo interativo, estados do painel e o mock sem rede.

## Decisão e progresso
- Reusar o sandbox PTY `pi-mock` já instalado, sem servidor HTTP. Montar somente módulos de UI selecionados em leitura; o executável é separado e não toca configurações do Pi normal. Nenhum custo em sessões normais.
- Implementado em `bin/ny-pi-mock` e `bin/ny-pi-mock-src/`. Carrega `ui`, `ui-visual`, `footer-no-stats`, `sticky-prompt`, `comandos`, `chat-margin` e `code-blocks` do checkout. Para HUD, Plan, Fleet, question e todo, usa as implementações do pi-code instalado. A sessão normal e o mock genérico anterior não foram alterados.

## Surpresas e resultados
- A galeria histórica tem 147 IDs, dos quais 138 tinham evidência de captura/efeito na rodada documentada. O mock tem 9 famílias, 34 variantes e 22 IDs com rota; os outros 125 aparecem como “sem cenário executável”. Uma rota demonstra uma configuração do item, não todas as combinações, teclas ou modos de terminal do inventário.
- No E2E, o painel Plan só mostrou tarefas após abrir a aba nativa. A leitura primeiro renderiza o resumo do ny-pi; Ctrl+O expande o conteúdo. Para o erro de agente, a expectativa é o `✗ failed` do renderer (não o texto de atividade da fixture). O teste do inventário detectou a perda de D15 por causa de `\|` no título; o parser foi corrigido sem diminuir o número esperado.

## Como usar

```sh
cd ~/code/pi-harness
bin/ny-pi-mock --list
bin/ny-pi-mock
```

- `/mock-ui` ou `/mock-ui all`: mostra o catálogo de variantes no chat, sem rodar todas de uma vez.
- `/mock-ui inventario` resume a cobertura; `/mock-ui inventario C` mostra IDs e rotas; `/mock-ui C13` aciona o diff de edição.
- `/mock-ui historico completo` abre uma nova sessão descartável já preenchida com conversa, raciocínio, tabela, listas, citação, código, diff, leitura, tarefa, erro e recuperação. `revisao`, `incidente` e `planejamento` carregam recortes independentes. Não lê históricos reais nem executa os comandos representados. Use Ctrl+O para expandir ferramentas e Ctrl+T para alternar o raciocínio.
- Exemplos: `/mock-ui plano executando`, `/mock-ui agentes erro`, `/mock-ui pergunta multipla`, `/mock-ui ferramentas leitura` (Ctrl+O para expandir), `/mock-ui chat cancelar` (Esc), `/mock-ui avisos aviso`.
- Cartão do shell (Variante 04 "Trilho de status", escolha do dono em 2026-11-18, `extensions/ui-visual/motion/shell.ts`): `/mock-ui ferramentas executando` mostra a saída em streaming por ~4 s (barra indeterminada e `executando` no rodapé) e o dissolver para `OK`; `ferramentas aviso` termina em `OK · 2 avisos`, `ferramentas erro` em `Erro` e `ferramentas saida` em `OK`. Contrato substituído: o Cartão 08 do bash (linha única de 58 colunas com `código N` e saída recuada fora do fundo) virou um bloco de até 72 colunas com trilho `▎` na cor do estado; `código 1` virou `Erro`, outro código `Erro N`. Correção junto: o título do bash mostrava `…` durante toda a execução quando a chamada nascia em `tool_execution_start`, porque o pi só marca `argsComplete` no fim do streaming; agora `executionStarted` também conta como args prontos. Régua Run (dono, 2026-11-18, substitui o título `$ comando`): ícone pendurado (Nerd `\ueb91` cod-debug_alt, inseto com play; Unicode `▸`; ASCII `$`) + `Run ─ comando ───── hora`, com corpo e rodapé recuados até o `Run`; preparando mostra o comando chegando com cursor e `recebendo o comando · N caracteres` sob a barra; toda troca de estado (preparando → executando → final) dissolve em 600 ms com brilho do fundo; linha em branco entre a saída e o rodapé.
- Para todo, use `pendente` antes de `andamento` e `concluido`, que atualizam o primeiro item. Em `cromo historico`, Ctrl+R abre o histórico; envie antes uma mensagem de exemplo se a sessão estiver vazia.
- Requisitos locais: Linux, Python 3, Node, bwrap, Pi 1.5.2, pi-code instalado e o sandbox já disponível em `~/.pi/agent/claude-home/bin/pi-mock-src/`. tmux é necessário somente para teste. Nenhum `git init` ou servidor local é usado. Encerrar descarta a sessão; para reverter, deixe de usar o novo executável.

## Verificação

- `node --test bin/ny-pi-mock-src/e2e.test.mjs`: launcher e TUI real em tmux privado, com catálogo e contagem, argumento inválido, plano, agente com falha, leitura recolhida/expandida, confirmação de pergunta e recusa de shell.
- Correção de cores: o tema histórico `tokyo-night` não corresponde à configuração atual `pi-claro/pi-noite` (ver `docs/designs/onda9-noite/README.md`); o sandbox também descartava `COLORTERM=truecolor`. Agora carrega os dois temas reais e preserva a indicação de RGB sem herdar o ambiente inteiro. O teste verificou o tema na TUI e o fundo ANSI RGB 38/39/52 (`#262734`) da mensagem de catálogo no modo escuro. O teste anterior falhou contra `tokyo-night`; após a correção, os dois casos passaram. Não houve comparação pixel a pixel de todas as telas.
- Resultado local: 2/2 casos passaram; Ruff no launcher, sintaxe TS/JS e estrutura do checkout passaram. A auditoria de asserções apontou roteamento por literais na fixture: os ramos dependem do cenário fornecido pela UI, não da presença do runner, e os testes observam os renderizadores reais. Não foram removidos nem afrouxados testes existentes.
- O E2E cobre fluxos representativos, incluindo a troca entre as quatro variantes de histórico, não os 34 estados. O type-check completo, a cobertura percentual do código novo dentro do sandbox e o gate completo do repositório ainda não foram verificados.

## Medidor de CPU

- `node bin/ny-pi-mock-src/perf.mjs --json` mede, em tmux privado e com 400 entradas de histórico, o tempo de CPU do processo `pi` em repouso e com animação ativa (`docs/perf-sota.md`). Rode em série: a métrica é tempo de CPU, mas a máquina carregada a perturba.
- `NY_PI_MOCK_PROF_DIR=<diretório existente>` faz o `bin/ny-pi-mock` gravar um `.cpuprofile` do node no diretório (só na saída graciosa, que o medidor faz com `/quit`). O perfilador infla a CPU: não use essas execuções como medida.

## Escrita e raciocínio recolhido (dono, 2026-11-18)

Escolhas dos laboratórios `/escrita` e `/raciocinio`, aplicadas em `extensions/ui-visual/motion/escrita.ts`:

- **Raciocínio recolhido por padrão**: `hideThinkingBlock: true` em `settings.json` (e em `settings.json.example`). A tecla de `app.thinking.toggle` ou um clique abre.
- **Rótulo, variante 2 "Brilho no rótulo"**: enquanto pensa, `pensando… · 4 s · 31 palavras · <tecla> abre`, com a varredura de brilho da espera em `pensando…`; ao terminar, `raciocinou 7 s · 56 palavras · <tecla> abre`. Mensagem do histórico não tem duração: `raciocínio · N palavras · <tecla> abre`.
- **Escrita, animação 6 "Tinta secando" com ritmo suavizado**: as rajadas do modelo viram um fluxo de `CPS = 310` letras por segundo (o "rápido" do laboratório era 252; o dono pediu um pouco mais), nunca mais de `ATRASO_MAX_MS = 250` atrás do modelo; cada letra nasce na cor do fundo e chega à cor do texto em `TINTA_MS = 180`. Vale para a resposta e para o raciocínio aberto.
- **Como**: o pi 1.5.2 não tem gancho; o módulo envolve `AssistantMessageComponent.prototype.updateContent` e `render`. Erro no wrapper cai no componente nativo. Só anima em movimento `normal`, com cor e com foco; fora disso o texto entra a cada delta, como antes. O relógio é o contínuo (~30 fps, mais lento sob carga) e só fica assinado durante o streaming.
- **Cartão Run sem foco**: a barra e o cursor de `recebendo o comando` e de `executando` não somem mais quando o terminal perde o foco; andam 1 passo por segundo (antes pareciam travados).
- Reverter: tirar a chamada `instalarEscrita` de `ui-visual/index.ts` e a chave `hideThinkingBlock`.
- Verificação: `motion/test/escrita.test.ts` (8 casos), `/tmp/esc_real.mjs` (componente real do pi 1.5.2) e `/tmp/ver_escrita.py` (TUI real no mock).

## Marca nycode no cabeçalho (dono, 2026-11-18)

Escolha do laboratório `/marca`: abertura 3 "Letra a letra", tamanho "grande". `extensions/ui-visual/motion/nycode.ts` substitui o logo do pi.

- Grade de 70 × 13 pontos medida da imagem do dono, com letras de 10 pontos e vão de 2. Degradê vertical de 239 a 122, espelhado no tema claro. É desenhada em meio bloco, 70 colunas × 7 linhas, com duas cores por célula.
- Cabeçalho: 7 linhas da marca, uma em branco e `ny-pi <versão>   ? atalhos   / comandos   ! shell`. Abaixo de 71 colunas fica só a linha de texto. Antes eram o logo 4 × 2 do pi, `pi <versão>` e os atalhos em duas linhas.
- Abertura: n, y, c, o, d, e entram uma a uma (190 ms cada), caem 2 pontos e esfriam da luz ao degradê, com cursor de bloco na cor de destaque; tudo em ~1,6 s. Começa no 1º desenho (a carga do início comia a abertura) e só em movimento normal; reduzido e desligado mostram a marca assentada. Depois fica em cache por largura.
- Verificação: `test/header.test.ts` (a grade decodificada das células é igual à medida) e `/tmp/ver_marca.py` (TUI real: 15 quadros distintos na abertura, marca assentada, 60 colunas só texto).
- Fluidez (dono, 2026-11-18, "fps máximo"): 60 fps pelo relógio de transição (16 ms, fora do limitador de carga) e pelo piso de 16 ms do pi-tui. O relógio da abertura avança no máximo `PASSO_MAX_MS = 34` por quadro: um travamento atrasa a animação em vez de pular letras; acima de 4× a duração ela assenta de vez. O SGR só sai quando a cor muda (1,5 KB por quadro, antes ~4 KB); o quadro custa 0,06 ms.
- Sem trava ao abrir (dono, 2026-11-18): medido no pi real, o 1º desenho chega no meio da carga do início (bloco de ~214 ms com skills, shell e regras de ignore; mais hooks de ~30 ms), e a abertura congelava. Agora ela espera o laço acalmar: `CALMA_QUADROS = 6` desenhos seguidos a menos de 28 ms (ou `ESPERA_MAX_MS = 1500`), com só o cursor parado. Medição em 3 partidas do pi real: maior intervalo na abertura 44–50 ms (antes 102 ms + 77 ms).
- Refino: letra nasce do escuro (120 ms, ease in-out), cai 2 pontos em ease-out (200 ms), acende na luz tingida 18% pelo destaque e esfria ao degradê (420 ms); `LETRA_MS = 165`; cursor desliza contínuo e sai pela direita (antes pulava de letra em letra e piscava); brilho diagonal de 480 ms assenta a marca. Total 1,6 s; o último quadro já é a marca assentada. Teste: nenhum ponto muda mais de 140 níveis entre quadros de 16 ms.

## Barra de digitação em cápsula e logo com quique (dono, 2026-11-18)

- Escolha do laboratório `/barra`: variante 2 "Cápsula". `extensions/ui/editor.ts` fecha o composer numa caixa `╭╮│╰╯` (respiro de 4 colunas, `│ ❯ texto`); a lista de autocompletar fica fora, abaixo da base. Status do turno, nome da sessão, rascunho, shell, NORMAL, apagado e dica de fila continuam nas réguas, agora com os cantos arredondados.
- Enquanto o agente trabalha a borda respira entre a cor da régua e o ciano (`RESPIRO_MS = 700`, relógio contínuo, só com movimento normal e foco); sem resposta há 10 s fica âmbar parada (`working.ts` publica `Symbol.for('pi-harness:travado')`). Fora do turno e no modo shell, a cor de sempre.
- Escolha do laboratório `/logo`: variante 4 "Quique", sem o âmbar (degradê cinza mantido). `motion/nycode.ts`: a letra desloca 4 pontos e quica ao assentar (`QUEDA_MS = 420`); duração total igual (1,6 s).
- Testes: `ui/test/editor.test.ts` (cápsula, respiração, âmbar; contratos antigos de régua reta anotados) e `ui-visual/test/header.test.ts` (quique), vermelhos sem a mudança. `ui/test/editor.test.ts` e `ui/test/vim/editor-vim.test.ts` voltaram a carregar: a cópia de teste não levava `folha/sheet.ts` nem `ui-visual/icons.ts`.

## Blocos na largura inteira e respiro no Run (dono, 2026-11-18)

- Antes: cartão Run com teto de 72 colunas; ficha de read/grep/find/ls com margem 2 e teto de 58; linha da chamada até 100.
  Agora: todos ocupam a largura inteira dentro da margem do chat (`extensions/chat-margin`), a partir da coluna 0.
- O cartão Run ganhou uma linha de respiro com trilho e fundo em cima e embaixo (`motion/shell.ts`).
- Testes: `test/tools/base.ts` (`reguaRun`, `semRespiro`, que exige as linhas de respiro), largura `w` em 120 e 200.

## Read em chips com contador (dono, 2026-11-18; laboratório /read desenho 4 e animação 4)

- Antes: `ícone read · alvo :faixa · N linhas` em texto corrido. Agora, com cores no tema, o verbo fica numa pílula tingida
  pelo estado (ciano lendo, verde lido, vermelho erro), a faixa, a contagem e o `truncado` em pílulas, a contagem à direita antes da hora.
- Contador: ao terminar, a contagem sobe de 0 ao total em 400 ms (`CONTADOR_MS`, saída cúbica); histórico e movimento reduzido mostram o total.
- Sem cores no tema, a linha de antes. Testes: `extensions/ui-visual/test/tools/leitura.test.ts` (vermelhos sem a mudança).

## Read com varredura e transições; escrita "Tinta longa" (dono, 2026-11-18; laboratório /refino read 2 + escrita 1)

- Read (`extensions/ui-visual/read/chips.ts`, fora de `tools.ts` pelo limite de 800 linhas): lendo, um brilho atravessa a
  pílula do verbo (700 ms por passada). Antes a cor trocava de uma vez e não havia estado de aviso. Agora o desfecho funde em
  300 ms do ciano ao verde (lido), ao âmbar (truncado = aviso) ou ao vermelho (erro, com o fundo do cartão indo a `toolErrorBg`).
  Há um clarão de 260 ms, e a contagem e o `truncado` nascem do fundo, um depois do outro (260 ms, 120 ms de intervalo).
- Tinta longa (`motion/escrita.ts`): `TINTA_MS` 180 → 320 ms, curva de entrada e saída (`tintaAlfa`); antes saída cúbica.
  Vale na resposta e no comando do Run chegando (`motion/shell.ts`: hora de chegada por letra em `context.state.uiChegada`,
  porque o pi refaz o `renderCall` a cada args novo). O cursor do Run respira em vez de piscar.
- Testes: `test/tools/leitura.test.ts`, `test/tools/shell.test.ts` (tinta longa), `motion/test/escrita.test.ts`; vermelhos sem a mudança.
  `bin/ny-pi-mock-src/e2e.test.mjs` atualizado à linha em chips (estava vermelho desde a mudança anterior).

## Cursor "Barra que respira" e escrita ~15 % mais rápida (dono, 2026-11-18; laboratório /cursor variante 3)

- Resposta (`motion/escrita.ts`, `barra`/`barraAlfa`): `▏` no destaque no 1º espaço após a última letra visível, acesa
  enquanto chegam letras, respirando (0,4–1) depois de `PAUSA_MS` = 160 ms sem letras; some no fim do streaming. Antes não havia cursor.
- Run chegando (`motion/shell.ts`): cursor `▏` (antes `▌`) com o mesmo brilho; ao começar a executar escorrega 3 colunas e
  some em `SAI_MS` = 450 ms.
- Marca (`motion/nycode.ts`): cursor da abertura em barra de 1 coluna (antes 2).
- Velocidade: CPS 310 → 360; `TINTA_MS` 320 → 270; marca 165 → 140 ms por letra (queda 420 → 360, acende 120 → 100,
  esfria 420 → 360); abertura 1,6 → 1,5 s.
- Testes novos (vermelhos sem a mudança): `motion/test/escrita.test.ts` (barra e componente), `test/tools/shell.test.ts`
  (saída da barra), `test/header.test.ts` (barra de 1 coluna). Contratos antigos do `▌` e de 320 ms atualizados com comentário.

## Read sem fundo de cartão, pílula na margem do chat (dono, 2026-11-18)

- `tools.ts`: o read em chips não pinta mais o fundo `customMessageBg` do cartão nem o espaço de recuo; a pílula do verbo
  começa na coluna da margem do chat e a linha usa a largura inteira (hora no canto direito, como os outros blocos).
  As pílulas seguem tingidas a partir de `customMessageBg`; no erro só a pílula vai ao vermelho (antes o cartão ia a `toolErrorBg`).
- Testes: `test/tools/leitura.test.ts` (sem fundo de cartão, coluna 0, erro só na pílula); vermelhos sem a mudança.

## Read com régua e `·` antes da hora (dono, 2026-11-18)

- `tools.ts`: entre o alvo e a contagem, a régua `─` em `borderMuted` (como no título do Run); a hora sai da pílula à parte
  e fica depois da contagem com `·`: `read  src/demo.ts ──────  1 linha  · 14:17`. Testes: `test/tools/leitura.test.ts` e
  `bin/ny-pi-mock-src/e2e.test.mjs` (contrato antigo anotado).

## Blocos do /reload em chips com "divisor primeiro" (dono, 2026-11-19; laboratório /recarga desenho 1 + animação 5)

- `claude-home/patches/pi-core/avisos/runtime.mjs` (copiado ao core pelo wrapper `bin/pi`): os avisos `regras` e `memória`
  do pi-code (notify marcado com U+2063) viram pílulas sem fundo de cartão na margem do chat (rótulo tingido pelo destaque,
  números em pílulas neutras, orientação em verde, `/memory` no destaque, hora à direita). Antes: caixa com fundo neutro.
  O `recarregado` vira divisor `──── ↻ recarregado · HH:MM ────` (ícone Nerd Font no kitty). Antes: texto dim centrado.
- Animação: no reload, `extensions/avisos` marca `globalThis[Symbol.for('pi-harness:recarga')]` no `session_shutdown`
  (reason `reload`); os avisos do novo início esperam o divisor (até 1,5 s), que se desenha do centro às pontas em 340 ms,
  e abrem a partir dele, o mais perto primeiro (300 ms + 110 ms por bloco, 280 ms cada). Na partida, nascem do fundo em
  cascata de 90 ms (no máximo 3 passos). Um só relógio de 16 ms com prazo e teto de 3 s; movimento reduzido ou desligado: fixo.
- Sem RGB no tema: o desenho de antes. Outros avisos marcados seguem na caixa.
- Testes: `claude-home/bin/tests/avisos-core/runtime.test.ts` (3 novos, relógio falso). No mock só o divisor aparece
  (o sandbox não carrega regras nem memória do pi-code).
- Ajuste (dono, 2026-11-19): só o rótulo (`regras`, `memória`) em pílula de fundo neutro (`customMessageBg`); o resto sem
  fundo, separado por `·`: `⚖ regras  2 globais · nenhuma do projeto · sempre ativas`. Antes rótulo tingido e números em pílulas.
- Ajuste do read (dono, 2026-11-19): `imagem · 11:48` com um espaço de cada lado do `·` (a pílula da contagem já fecha num espaço; antes ficavam dois).
- Ajuste (dono, 2026-11-19): regras e memória sem fundo nenhum, rótulo com `:` — `⚖ regras: 2 globais · nenhuma do projeto · sempre ativas`.

## Abertura em sequência e `Regras:` sem ícone (dono, 2026-11-19)

- `Regras: 2 globais · …` e `Memória: 30 notas · …`: maiúscula, sem ícone, sem hora (antes `⚖ regras: … HH:MM`).
- Na partida (`extensions/ui-visual/header.ts`, só movimento normal e truecolor): quando a marca começa (t0, depois da
  partida calma), a linha `ny-pi versão   atalhos` nasce do fundo em 340 ms; Regras e Memória abrem depois dela como no
  /reload (t0 + 300 ms + 110 ms por bloco, 280 ms cada; `globalThis[Symbol.for('pi-harness:abertura')]`, lido pelo runtime
  dos avisos; sem t0 em 3 s aparecem sozinhos); editor, status e rodapé (filhos 3–6 do TUI) sobem do fundo em 360 ms
  (`esmaecer` em `motion/motion.ts`), e o embrulho sai no fim.
- Mock (`bin/ny-pi-mock`): settings `quietStartup: "header"` como no do dono (sem `[Extensions]`), e `rg`/`fdfind` do host
  ligados só-leitura no PATH do sandbox (sem os avisos `fd/ripgrep not found`, que eram só do mock).

## Bash no lugar de Run (dono, 2026-11-19)
- O cartão do bash mantém a mesma UI e as mesmas animações da régua Run. Mudam só o nome (`Run` → `Bash`) e o ícone: `\ueb91` (inseto com play) → `\uebca` (cod-terminal_bash). Arquivos: `extensions/ui-visual/motion/shell.ts` e `icons.ts`. Depois (dono, 2026-11-19): `\u{f018d}` (md-console), opção 6 da lista de ícones.
- Testes: `icons.test.ts`, `tools/base.ts`, `tools/shell.test.ts` e `tools/tools.test.ts`. Com o código antigo restaurado, 14 falhas; com o novo, a suíte completa passa (547 testes, 546 passam, 1 ignorado).

## Diagnóstico no ctrl+e (dono, 2026-11-19)
- O atalho do painel de diagnóstico passou de `alt+e` para `ctrl+e` (`extensions/diagnostico/index.ts` `ATALHO`, `comandos/catalog.ts`); o rodapé mostra `ctrl+e abre`.
- `~/.pi/agent/keybindings.json` ganhou `"tui.editor.cursorLineEnd": ["end"]`: o ctrl+e saiu do fim de linha do editor (End continua), sem aviso de conflito do pi. Backup: `/tmp/keybindings.pre-ctrle.json`.
- Verificado no pi real (tmux): ctrl+e abre o painel, inclusive com texto no editor; alt+e não abre mais.

## Compactação: Barra verde (dono, 2026-11-19, /compacta desenho 5 + "Nasce do fundo")
- Antes: `compactado · 252 mil → ~6 mil tokens · alt+o abre · 14:42`, em dim e centrada. Agora: `compactado  98% ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱  251 mil → ~6 mil tokens · alt+o abre · 12:51`, centrada, sem ícone e sem fundo. A % fica em verde e negrito; a barra tem 20 segmentos, os verdes mostram quanto foi liberado.
- A compactação feita agora nasce do fundo em `COMPACTA_MS` 360 ms (curva suave). A do histórico e a reaberta com alt+o já aparecem prontas. Sem truecolor, ou com movimento reduzido, a linha fica parada nas cores do tema.
- Em largura estreita somem, nesta ordem: a hora, a tecla, os tokens e por fim a barra.
- Código: `claude-home/patches/pi-core/avisos/runtime.mjs` (`linhaBarra`, `pctCompactado`), já aplicado ao 1.5.2. `extensions/ui-visual/compact.ts` publica o TUI em `globalThis[Symbol.for('pi-harness:tui')]` para o relógio do fade.
- Testes: `runtime.test.ts` com 2 testes novos e 1 ajustado. Com o código antigo, 3 falham.
- Verificação: no componente real do 1.5.2, 6 quadros distintos durante o fade.

## Escrita sem cursor (dono, 2026-11-19)
- A "Barra que respira" (`▏`) saiu da resposta e do raciocínio em streaming; segue só no comando do Bash chegando (`motion/shell.ts`, `barraAlfa`).
- O relógio da escrita para quando a tinta seca e nada muda (`motion/escrita.ts`: descarta marcos secos antes de decidir o quadro). Teste: `motion/test/escrita.test.ts` (o código antigo falha). Backup: `/tmp/escrita.pre-semcursor.ts`.

## Seleção copia no mock (dono, 2026-11-19)
- Causa: no sandbox não há Wayland/X, então o pi copia por OSC 52, e o relé do pi-mock (`claude-home/bin/pi-mock-src/terminal.py`) descartava todo OSC 52. O pi mostrava "Copied!" sem copiar.
- Correção: `SequenceFilter(clipboard_write=True)` / `run_pty(..., clipboard_write=True)` deixa passar só a escrita `52;c;<base64>` (sem consulta `?`, sem outras seleções, até 100 000 bytes, o teto do pi). O padrão do pi-mock segue bloqueando; só o `bin/ny-pi-mock` (e o do laboratório) liga a opção.
- Testes: `claude-home/bin/tests/pi-mock/test_launcher.py` `test_clipboard_write_opt_in` (vermelho sem a mudança). E2E em tmux com `set-clipboard on`: arrastar sobre "Cenário" põe `Cenário` no buffer; com o launcher antigo o buffer fica vazio.

## Mensagem do usuário: ❯, hora e faixa fina de volta; caixa de extensão fina (dono, 2026-11-19, opção "os dois")
- Causa: o pi guarda um transformador de Markdown por extensão (`loader.js`: `extension.markdownTransformer = …`). O `ui-visual` registrava dois (usuário e assistente) e o segundo apagava o primeiro: sem ❯, sem hora, sem brilho e com a linha de fundo em cima e embaixo.
- Correção: um transformador só (`messageTypes: ['user', 'assistant']`), que despacha por `messageType` (`extensions/ui-visual/index.ts`). A mensagem do usuário volta a ser uma faixa de uma linha, com a linha vazia acima separando do bloco anterior.
- Mensagens de extensão sem renderer (`[estados]`, `[envio]`…): `afinarCaixa` zera o `paddingY` da caixa padrão do `CustomMessageComponent`; ficam `[tipo]`, linha vazia e texto, sem a linha de fundo em cima e embaixo; o espaço acima continua.
- Testes: `test/index.test.ts` (registro único, contrato antigo comentado; `afinarCaixa`). O código antigo falha o registro.

## Laboratório /status (dono, 2026-11-19)
- `~/ny-labs/blocos/bin/ny-pi-mock-src/status.ts`: informação (Atual, Git, Tokens, Turno, Agentes e fila, Linha extra) × separação (Atual, Linha em branco, Régua fina, Régua com rótulo, Faixa de fundo, Abas em pílulas), cenas Ocioso, Trabalhando e Com abas. As três linhas de hoje ficam iguais em todas as variantes; a info nova nasce do fundo em 300 ms. Aguarda a escolha do dono.

## Rodapé escolhido no /status, abas e respiro da mensagem (dono, 2026-11-19)
- **Rodapé (claude-home/bin/hud/calm-statusline.mjs):** na 1ª linha vem o git, com o ícone `\ue725` (ou `⎇` quando `PI_ASCII_ICONS=1`), o ramo, `↑n ↓n` e `+n −n` do `git diff HEAD --shortstat`, que só roda quando o ramo está sujo. Os medidores ficam na 2ª linha. A 3ª linha é nova e traz `↓ entrada ↑ saída · cache n% · turno m:ss · n tok/s`; `turnStats` calcula o turno e a velocidade a partir do fim do transcript (256 KiB). O aviso de cache ruim (`▲ cache n%`) agora entra nessa 3ª linha. O bypass continua por último, no footer.
- **Outras abas (extensions/footer-no-stats.ts):** fora da aba Status aparece só a linha do footer (avisos · ctrl+e · bypass); com qualquer aba aberta, inclusive a Status, uma linha vazia a separa do conteúdo da aba. A aba aberta vem de `Symbol.for('pi-code.group-nav').shown()`.
- **Mensagem enviada (extensions/ui-visual/index.ts `acolchoar`):** a Faixa com o Brilho ganhou meia linha de fundo em cima (`▄`) e embaixo (`▀`) na cor userMessageBg. O Spacer do pi continua como margem para o bloco anterior.
- **Testes:** calm-statusline com 22 casos, footer-no-stats com 5 e ui-visual index com 9. Cada um falha com o backup em /tmp (`calm.pre-git.mjs`, `footer.pre-abas.ts`, `uiv-index.pre-acolchoa.ts`).

## /reload sobe a tela inteira do fundo (dono, 2026-11-19)
- `extensions/ui-visual/header.ts` `recarregar`: no `session_start` com reason `reload` (movimento normal e truecolor), os filhos 0 a 6 do TUI sobem do fundo em `RECARGA_MS` = 420 ms: chat, editor, abas e rodapé. O relógio começa no 1º desenho depois da recarga, não durante a carga.
- Do documento só passam pelo `esmaecer` as últimas N linhas, com N = altura do terminal; o histórico fora da tela vem intacto, sem custo. O embrulho sai no fim. Reaproveita `subirBase` (novas opções `de`, `ultimas`, `ms`, `noPrimeiro`).
- Teste: `test/header.test.ts` "reload: todos os filhos…", que falha com o backup `/tmp/header.pre-recarga.ts`. No mock (tmux, `/reload`), a mensagem do chat e o editor vão do fundo `43;44;58` até a cor final em cerca de 0,45 s.

## Laboratório /compactada (dono, 2026-11-19)
- `~/ny-labs/blocos/bin/ny-pi-mock-src/compactada.ts`: o aviso "compactada N vezes", que aparece ao retomar uma sessão já compactada (`runtime.mjs` `linhaCompactada`). São 6 desenhos: Atual, Uma linha, Pílula, Divisor, Medidor ● e Barra lateral ▎. São 4 animações: Nasce do fundo, Da esquerda, Pulso e Fixo. As cenas mostram N = 1, 2 e 12; a dica `/new` só aparece com N ≥ 3.
- Teste: `~/ny-labs/blocos/test_compactada.py` passa nas 6×4 combinações das 3 cenas.
- **Aplicado (dono, 2026-11-19): desenho 5 Medidor + animação 1 Nasce do fundo.** Em `claude-home/patches/pi-core/avisos/runtime.mjs` (`compactada`, `medidorCompactada`, `linhaCompactada`; `MAX_BOLAS` 10, `COMPACTADA_MS` 360) o aviso fica assim:
  `compactada ●●●●●●●●●● +2  12 vezes`
  `cada compactação perde detalhe do contexto · /new recomeça limpo`
  - As bolinhas vão do muted ao amarelo, e as duas linhas sobem do fundo em 360 ms. Em largura estreita, a dica `/new` desce para a linha de baixo.
  - Movimento reduzido: o aviso aparece pronto, sem animação. Sem RGB no tema: as mesmas partes nas cores do tema.
  - Antes: `compactada N vezes` em amarelo e negrito.
  - Aplicado ao 1.5.2 (`cmp` igual). Verificado no pi real com `--session` numa cópia de sessão compactada: o aviso foi da cor do fundo ao amarelo `224;175;104`.
  - Teste: `runtime.test.ts` "medidor em gradiente…" e o contrato do texto atualizado. Ambos falham com o backup `/tmp/runtime.pre-medidor.mjs`.
  - Ajuste (dono, 2026-11-19): o aviso agora começa na margem do chat, na mesma coluna do texto da resposta. Antes havia um recuo extra de `outputPad`. Conferido no pi real.

## Mensagem enviada mais justa (dono, 2026-11-19)
- `extensions/chat-margin/index.ts`: a mensagem do usuário saiu de `RECUADOS`. Antes ela tinha RECUO 2 de cada lado além do padding do Markdown; agora fica só o padding, 1 coluna. Teste: `extensions/chat-margin/index.test.ts`, com um pi-tui de fachada que exporta `isImageLine`; falha com o backup `/tmp/cm-index.pre-pad.ts`.
- `extensions/ui-visual/index.ts` `acolchoar`: o respiro passou de meia linha (`▄`/`▀`) para 1/8 de linha (`▁` em cima, `▔` embaixo). Ele agora cobre só as colunas da faixa, medidas na 1ª linha (do `48;2` ao `49`). Antes cobria a largura toda, e sobravam quadradinhos na margem do chat. Teste: `test/index.test.ts` (contrato comentado), que falha com `/tmp/uiv-index.pre-pad.ts`.
- Mock: com 80 colunas, faixa e fios ocupam as mesmas 78 colunas, com 1 coluna de margem de cada lado.
- Coluna da hora (dono, 2026-11-19): o texto da mensagem não entra mais na coluna da hora. Em `ui-visual/icons.ts`, a função `coluna` quebra todas as linhas comuns em largura − hora − 2 colunas, na palavra ou no corte quando a palavra não cabe. Antes, só a 1ª linha respeitava esse limite. Cercas de código e linhas de bloco Markdown ficam intactas. Teste: `icons.test.ts` "todas as linhas quebram antes da coluna da hora", que falha com `/tmp/icons.pre-coluna.ts`.

## Read sem pílula e imagem em fundo neutro (dono, 2026-11-19)
- `ui-visual/read/chips.ts` `pilulaVerbo`: o verbo perdeu a pílula de fundo. A cor do estado agora fica no ícone e na palavra: ciano lendo, depois verde, âmbar (truncado) ou vermelho (erro), com o clarão e a varredura nas letras. A palavra é `Read`, com maiúscula, só no Read com cores; o texto corrido sem cores no tema segue com `read`. Antes: ` ícone read ` numa pílula tingida.
- `image-open/fundo.ts`: o fundo atrás da imagem é neutro (`customMessageBg`). Só muda em erro (`toolErrorBg`) e em aviso (truncado), quando é o neutro puxado 28% ao âmbar. Antes era o verde de sucesso, e o ciano enquanto executava. Agora o fundo respeita a margem do chat: com o chat-margin por dentro, ele pinta na largura interna e a margem volta sem fundo. Antes ia de ponta a ponta e perdia a moldura.
- Testes: `leitura.test.ts` (contrato comentado), `fundo.test.ts` "instalarFundo…" e e2e do mock. Falham com os backups `/tmp/chips.pre-semfundo.ts`, `/tmp/tools.pre-semfundo.ts` e `/tmp/fundo.pre-neutro.ts`.
- Falha pré-existente, fora do escopo: `image-open.test.ts` "nativo: clique SGR…" falha também com o código antigo.

## Fim do run = cartão do Bash (dono, 2026-11-19)
- `extensions/hook-msgs/index.ts` `cartaoFim`: o aviso `run-finished` (fim de `run … await`) agora é desenhado por `cartaoShell` (`ui-visual/motion/shell.ts`). O cartão é o mesmo do Bash:
  - trilho `▎` e fundo neutro, ou o fundo de erro;
  - título régua `Bash ─ <nome do run> ──── hora`;
  - últimas 5 linhas, com `ctrl+o` ou clique para abrir;
  - rodapé `OK` / `OK · N avisos` / `Erro` / `Erro N` / `interrompido` · duração · linhas · log.
  - Dissolver: só quando a mensagem chega (até 3 s); vinda do histórico, já aparece assentada.
- Antes: caixa própria com fundo verde ou vermelho de ponta a ponta, `▶ run · terminou nome`, hora em pílula e saída numa barra `│`. Esse caminho saiu; a caixa antiga fica só para conteúdo que não segue o formato.
- Verificado no pi real (`--session` com um `run-finished`): cartão idêntico ao do Bash, dentro da margem.
- Testes: `hook-msgs/index.test.ts` (contrato comentado e dissolver), que agora entram na suíte. Falham com `/tmp/hook.pre-cartao.ts`.

## Laboratório /rodando (dono, 2026-11-19)
- `~/ny-labs/blocos/bin/ny-pi-mock-src/rodando.ts` mostra o cartão do `run start` (comando em segundo plano, hoje uma caixa verde `▸ suite8 · rodando · sem saída`). São 6 desenhos (Atual, Cartão Bash, Régua sem fundo, Uma linha, Pílula de estado, Trilho fino) × 4 animações (Barra, Brilho, Pulso, Fixo), em 3 cenas (start, tail com 3 linhas, wait com exit 1). `test_rodando.py` passa nas 72 combinações; os quadros estão em `/tmp/rodando-frames.txt`. Falta a escolha do dono; ela será aplicada em `ui-visual/tools.ts` (`runCorpo`/cabeçalho do run).

## Effort no rodapé (dono, 2026-11-19)
- `calm-statusline.mjs` `head`: o effort vai entre parênteses logo depois do modelo, sem o `·`: `Claude Opus 5.5 (medium) · dir`. A cor sobe com a intensidade (`EFFORT_COR`): off e minimal em cinza (`sec`), low em verde (`ok`), medium em azul (`usage`), high em roxo (`high`), xhigh e max em vermelho (`crit`). Antes: `· medium` em cinza.
- Teste: `calm-statusline.test.mjs` "effort: (nível)…" e o contrato da linha 1 atualizado. 4 testes falham com `/tmp/calm.pre-effort.mjs`.

## Edit no estilo do Read (dono, 2026-11-19)
- `ui-visual/tools.ts` (ramo `edit` de `callComponent`): ícone de lápis (`icons.ts` NERD `edit` = `\uea73` cod-edit; antes `\uea71`, o mesmo do write) + `Edit` na cor do estado via `pilulaVerbo` (o mesmo do Read: ciano → verde/vermelho, varredura enquanto roda), `·` entre verbo, arquivo, pasta e placar, régua `─` até a hora em dim sem pílula. Sem `concluído` (o estado aparece só em execução/erro), na coluna 0. O cabeçalho saiu da caixa (`boxed`); o diff segue na caixa neutra com régua e rodapé.
- Testes: `leitura.test.ts` "edit: lápis + Edit…" (novo) e os contratos de `tools.test.ts` atualizados com comentário; 8 falham com `/tmp/tools.pre-edit.ts` + `/tmp/icons.pre-edit.ts`.
- Cabeçalho do Edit com o fundo da caixa e ícone neutro (dono, 2026-11-20; antes ícone na cor do estado e cabeçalho sem fundo): `ui-visual/read/cabecalho-edit.ts` (`comFundoEdit`) pinta a linha com o mesmo fundo (`boxName`: pending/neutro/erro), recuo `outputPad` e largura das linhas do diff; `pilulaVerbo(..., marcaNeutra)` deixa o lápis em `muted` e só a palavra `Edit` segue o estado (o Read não mudou). Sem cor no tema, layout antigo sem fundo. Mock `/mock-ui C13` (tmux): cabeçalho e corpo em `48;2;38;39;52`, lápis `38;2;169;177;214` (muted `#a9b1d6`), `Edit` verde. Testes `tools.test.ts`/`leitura.test.ts` reescritos com comentário; 3 vermelhos com `/tmp/{tools,chips}.pre-editbg.ts`.

## Clique na imagem do chat abre (dono, 2026-11-19)
- Causa: no pi 1.5.2 `ToolExecutionComponent.handleMouse` com `renderShell 'self'` (todos os blocos do ny-pi) só repassa o clique ao próprio conteúdo; as imagens vêm depois e nunca recebiam o clique, então o `Image.handleMouse` do image-open não rodava.
- `extensions/image-open/index.ts` `rotearImagens(proto)`: embrulha o `handleMouse` e leva o clique abaixo do conteúdo à imagem certa (linha vazia, conteúdo, por imagem um espaço + a imagem), com y local. Marca na função (o chat-margin restaura o original no `/reload`). Teste novo em `image-open.test.ts` (vermelho sem a mudança).

## Effort max em arco-íris (dono, 2026-11-19)
- `extensions/footer-no-stats.ts` `arcoNoHud`: embrulha o render dos widgets abaixo do editor (`tui.children[5]`) e troca o `(max)` do HUD por letras do arco-íris que giram (uma volta a cada 2,4 s) no relógio único `assinarQuadro`; movimento reduzido: arco-íris parado. Teste em `footer-no-stats.test.ts`.
- Diretório temporário por processo (`pi-images-<uid>-<pid>`, dono, 2026-11-19): antes todas as sessões do mesmo usuário usavam `pi-images-<uid>` e cada uma o apagava inteiro ao sair, levando imagens que outra sessão estava abrindo. Teste "outra sessão saindo não apaga…" (vermelho sem a mudança).
- Pendente: o e2e "nativo: clique SGR…" falha ~1 em 20 rodadas (`/tmp/nat.fail.7`): o editor está pronto e a tela correta, mas o abridor não é chamado em 8–20 s. Esperar o rodapé e provar a leitura de entrada (digitar e apagar) não mudou a taxa; foram revertidos. Hipótese aberta: o clique sintetizado pelo caminho de seleção do `tui-alt-screen.js` (o `press` da imagem não é tratado, então não há `mousePressTarget`).

## Separador entre a aba e o rodapé (dono, 2026-11-19)
- `extensions/footer-no-stats.ts`: com qualquer aba aberta, a linha entre o conteúdo da aba e o rodapé (avisos, bypass) é um separador `─` em `borderMuted` na largura inteira; antes, uma linha vazia. Contrato atualizado em `footer-no-stats.test.ts`, que falha com `/tmp/footer.pre-sep.ts`.

## Run em segundo plano: "Uma linha" + Barra (escolha do dono no lab /rodando, 2026-11-19)
- `ui-visual/run/banda.ts` `bandaRun`: o cartão do `run` reconhecido (start, wait, tail) virou uma faixa só, neutra (`customMessageBg`; `toolErrorBg` no erro): `▸ nome  [barra] estado · tempo[ · N linhas]` à esquerda e `id[ · tecla abre] · hora` à direita. Rodando = "em segundo plano" (ciano); terminado = `exit N`/`sinal X` na cor do estado. Antes: caixa com o fundo do estado, linhas em branco acima e abaixo e `▸ nome · rótulo · tempo · resumo`.
- Barra: enquanto o registro do pi-code (`Symbol.for('pi-code.run.registry')`) diz `running`, o tempo corre desde `startedAt` e a barra ━ de 10 colunas do Bash anda (70 ms por passo, `tocar` só enquanto desenhada); terminado, ou sem registro (histórico), a faixa fica como o texto da tool a deixou.
- `tools.ts`: `RunVisto` ganhou `id`, `tempo` e `linhas` (sem `resumo`); `caixa` não pinta o run reconhecido; a saída aberta vem logo abaixo, sem fundo. O texto não reconhecido (list, stop, erro) segue na caixa antiga.
- Testes: `estado.test.ts` "run A" (contrato novo, com comentário) e "run vivo…" (novo); 2 falham com `/tmp/tools.pre-run1.ts`. Os testes que copiam o ui-visual para um tmp passaram a copiar `run/`. Pi real: `/tmp/runband.py` mostra `▸ interface-dev-stack  em segundo plano … re1k8 · alt+o abre · 19:40` em fundo neutro.
- O lab `~/ny-labs/blocos/bin/ny-pi-mock-src/rodando.ts` fica até o dono pedir a remoção.

## Labs removidos (dono, 2026-11-19)
- `~/ny-labs/blocos` (todos os laboratórios de blocos: /rodando, /compactada, /envio, /status, etc.) foi apagado a pedido do dono ("remover blocos"). Antes, os links `docs`, `extensions` e `themes` (para o repo) foram removidos à parte; o repo ficou intacto. A escolha pendente do `/envio` ficou sem lab; para retomá-la, recriar a partir das notas deste documento.

## Lab /gate (dono, 2026-11-19): aviso do completion gate
- `~/ny-labs/lab` (antes `~/ny-labs/gate`) (cópia do mock com `bin/ny-pi-mock-src/gate.ts`; `docs`, `extensions`, `themes` são links para o repo). Abrir: `~/ny-labs/lab/bin/ny-pi-mock`, depois `/gate`.
- 6 desenhos: Atual (o `render` real de `hook-msgs`), Uma linha (faixa neutra como o run), Régua (sem fundo, estilo Read), Barra lateral ▎, Pílula de estado, Faixa âmbar (o fundo de hoje numa linha só). 4 animações: Nasce do fundo, Da esquerda, Pulso, Fixo. 3 cenas: 2 arquivos, 1 arquivo, aberto.
- `~/ny-labs/lab/test_gate.py` percorre as 72 combinações no mock real (rótulos, título, resumo da cena, largura ≤ 110): 0 falhas. Quadros em `/tmp/gate-frames.txt`. Aguarda a escolha do dono; aplicação em `hook-msgs/index.ts` `montarCaixa` (vale também para hook e subagente).

## Avisos em Faixa âmbar + Nasce do fundo (escolha do dono no lab /gate, 2026-11-19)
- `hook-msgs/index.ts` `montarCaixa`/`desenhar` (gate, hook e subagente): antes caixa no fundo do estado com linha em branco acima e abaixo, padding lateral e atalho e hora em pílulas; agora UMA faixa no fundo do estado na largura inteira, ` ⚑ gate · atenção · resumo …  alt+o abre · 19:42 `, ícone na cor do estado. Prévia e detalhe vêm logo abaixo, sem fundo, recuados com `│`. Gate: o resumo perdeu `conclusão · ` e `· ao parar`.
- Chegando agora (timestamp < 450 ms), a faixa nasce do fundo (`esmaecer`, respeita `anima()`); do histórico vem assentada. Sem invalidate no renderer de mensagem: a animação anda com os desenhos do turno que o aviso abre (`ponytail:` no código).
- Testes: `hook-msgs/index.test.ts` 18/18 (contratos reescritos com comentário; teste novo "faixa: chegando agora nasce do fundo"); 12 falham com `/tmp/hookmsgs.pre-faixa.ts`.

## Read: `·` depois do verbo e margem acima da imagem (dono, 2026-11-19)
- `ui-visual/tools.ts`: `Read · alvo` (antes `Read alvo`); imagem lida devolve uma linha em branco como corpo, somando ao espaçador do pi. `leitura.test.ts` 10/10; 2 falham com `/tmp/tools.pre-readdot.ts`.

## Labs /fila e /leitura (dono, 2026-11-19)
- `~/ny-labs/lab/bin/ny-pi-mock-src/kit.ts` (eixos desenho × animação × cena; animações Nasce do fundo, Da esquerda, Pulso, Fixo), `fila.ts` (6 desenhos: Atual = `up-dequeue` restyleQueue real, Régua, Cartões, Marcador de quando, Compacta, Moldura; 3 cenas) e `leitura.ts` (5 desenhos do conteúdo do Read para imagem, texto e binário: Atual, Com legenda, Recolhida, Trilho, Miniatura + ficha; sem animação).
- O relé do PTY do mock descarta APC (kitty): a imagem no lab é um bloco ▒ do mesmo tamanho.
- `~/ny-labs/lab/test_labs.py` percorre todas as combinações. Aguardam a escolha do dono.

## Lab: teclas sem Tab (dono, 2026-11-19)
No terminal do dono o Tab não chegava ao lab. Agora ← → desenho, ↑ ↓ animação (sem animações, a cena), Espaço cena, Enter escolhe. `test_labs.py` refeito: 0 falhas.

## Read de imagem: Miniatura + ficha (escolha do dono no lab /leitura, desenho 5, 2026-11-19)
`extensions/image-open/fundo.ts`: no Read, a imagem cai para `MINI_COLS` (16) colunas (`options.maxWidthCells` + `invalidate` uma vez) e, à direita da moldura, a ficha: nome do arquivo, `tipo · L×A · tamanho` e `clique abre` (cortados com `…`; se a imagem tem menos linhas, as últimas se juntam com ` · `). Outras tools mantêm a largura de antes. Testes: `fundo.test.ts` (2 novos, vermelhos sem a mudança). Backups `/tmp/fundo.pre-mini.ts`, `/tmp/fundo.test.pre-mini.ts`.

## Fila: Atual + Nasce do fundo, alinhada à cápsula (escolha do dono no lab /fila e pedido, 2026-11-19)
`extensions/up-dequeue/index.ts`: sem padding lateral (antes 3 colunas): `▎` na coluna do `│` da cápsula e o texto termina na coluna do `╮` (conferido no pi real via lab). Mensagem nova na fila: o bloco nasce do fundo em `NASCE_MS` (450 ms, `esmaecer` + `assinarQuadro`, relógio injetável). Testes: contratos de padding reescritos + "mensagem nova nasce do fundo" (6 vermelhos sem a mudança). Backups `/tmp/updq.pre-margem.ts`, `/tmp/updq.test.pre-margem.ts`. O lab registra o up-dequeue para a fila real aparecer.

## /reload: `recarregando` com três pontinhos em loop (dono, 2026-11-19)
`claude-home/patches/pi-core/avisos`: a caixa do `/reload` trocou o "Reloading keybindings…" por `runtime.recarregando` (`recarregando  • • •`, um ponto aceso por vez a cada `PONTO_MS` = 300 ms, em loop). O relógio pede quadro enquanto a caixa está no `editorContainer` e para sozinho quando ela sai (sucesso ou erro); movimento reduzido deixa os pontos parados. Nova âncora em `apply.mjs` (casa uma vez no interactive-mode e no chunk). Testes: `runtime.test.ts` (novo) e `apply.test.ts` (gancho + âncora ausente); 3 vermelhos sem a mudança. Pi real (tmux): o quadro aparece 33 ms depois do Enter e os pontos andam durante a recarga (~0,7 s). Limite: trechos síncronos da carga de extensões seguram o quadro. Backups `/tmp/{runtime,apply}.pre-pontos.mjs`, `/tmp/{rt,ap}.test.pre-pontos.ts`. Dist reaplicado (revert + apply, `cmp` ok).

## Write igual ao Read, com a bolinha cheia (dono, 2026-11-19)
`extensions/ui-visual/tools.ts`: o write passou a `renderShell: 'self'` e usa a linha do Read: `● Write · alvo ──── N linhas · hora`, sem fundo, ícone e palavra na cor do estado (antes cartão verde do shell padrão com `write` minúsculo e a contagem colada ao alvo). Testes: `leitura.test.ts` "write: mesma linha do Read…" (novo) e o contrato de `renderShell` em `tools.test.ts` reescrito; 2 vermelhos sem a mudança. Pi real (sessão copiada `/tmp/sesswr/s.jsonl`): `  Write · .pi/agent/settings.json ──── 19 linhas · 20:25`, sem fundo. Backups `/tmp/tools.pre-write.ts`, `/tmp/{tools,leitura}.test.pre-write.ts`.

## Separador da aba quase invisível (dono, 2026-11-19)
`extensions/footer-no-stats.ts` `fraca()`: o `─` entre a aba e o rodapé usa borderMuted puxado ao customMessageBg (antes borderMuted puro): 75% (`38;2;43;46;63` no pi real), depois 90% a pedido (`38;2;40;42;57`); sem RGB no tema, borderMuted. Teste novo em `footer-no-stats.test.ts` (vermelho com `/tmp/footer.pre-fraca.ts`).

## Miniatura do Read: moldura alinhada e sem o tipo antes da hora (dono, 2026-11-19)
- **Preview bugada:** o chat-margin entrega a linha da imagem com 1 espaço de margem dos dois lados (` ␛_G… `); `instalarFundo` (`image-open/fundo.ts`) agora tira essa margem antes de emoldurar. Antes o `│` direito e a ficha saíam 2 colunas à direita. Teste novo em `fundo.test.ts` (vermelho com `/tmp/fundo.pre-margemimg.ts`). Diagnóstico: pi real em tmux com `env -u TMUX TERM_PROGRAM=kitty` (o tmux descarta o APC, mas o texto mostra o desalinhamento) na sessão mínima `/tmp/sessimg/p.jsonl`.
- **Sem `imagem ·` antes da hora:** `read/chips.ts` `pilulasDireita` e `tools.ts` `rightOf` não mostram mais o tipo no Read de imagem (truncado continua). Testes: `leitura.test.ts` (novo) e o contrato de `tools.test.ts` "resumos" reescrito; 2 vermelhos sem a mudança. Backups `/tmp/{chips,tools}.pre-semtipo.ts`, `/tmp/{tools,leitura}.test.pre-semtipo.ts`.

## /reload limpa a tela primeiro (dono, 2026-11-19)
`claude-home/patches/pi-core/avisos/runtime.mjs` `limparTela` (chamado por `recarregando`): enquanto a caixa do reload está no `editorContainer`, os outros filhos do TUI (chat, cabeçalho, widgets, rodapé) desenham nada; quando ela sai, o render original volta (se ninguém embrulhou por cima no meio; senão o nosso vira passagem) e a tela é redesenhada inteira (`requestRender(true)`). Pi real (tmux): durante a recarga só `recarregando • • •`; depois chat, HUD e rodapé voltam. Teste novo em `runtime.test.ts` (vermelho com `/tmp/runtime.pre-limpa.mjs`). Dist reaplicado, `cmp` ok.

## Tela do /reload: Centro + Crescendo fluido (escolha do dono no lab /carregando, 2026-11-19)
- Lab `/carregando` (`~/ny-labs/lab/bin/ny-pi-mock-src/carregando.ts`): 6 desenhos (Atual, Só a linha, Centro, Cápsula, Marca, Barra) × 6 animações em loop (Onda, Crescendo, Respira, Pulo, Cometa, Fixo) × 2 cenas; `test_labs.py carregando`: 0 falhas.
- Aplicado em `runtime.mjs` `recarregando`: `recarregando  ...` no centro exato da tela vazia (altura de `ui.terminal.rows`), sem as réguas e espaços da caixa nativa; os três `.` acendem um a um com cor contínua do fundo ao accent (`brilhoPonto`, smoothstep, PONTO_MS = 300), seguram e apagam juntos, ciclo CICLO_MS = 1600, quadro a cada QUADRO_MS = 33. Movimento reduzido: três acesos e parados.
- Pi real (tmux 90×24): linha 12, coluna 35; 31 quadros distintos numa recarga de 0,65 s. Testes: `runtime.test.ts` (contrato reescrito + limparTela atualizado); 2 vermelhos com `/tmp/runtime.pre-centro.mjs`. Dist reaplicado, `cmp` ok.

## Fade do /reload não se perde na tela vazia (dono, 2026-11-19)
`ui-visual/header.ts` `subirBase` (noPrimeiro): o relógio do fade só começa no 1º desenho com conteúdo. Antes começava no 1º desenho, que podia cair enquanto `limparTela` mantinha a tela vazia (pontinhos pedem quadro a cada 33 ms) e a tela voltava já pronta. Teste novo em `header.test.ts` (vermelho com `/tmp/header.pre-vazio.ts`). Pi real: rodapé (Status, HUD, bypass) e chat sobem do fundo em ~0,4 s depois da recarga.

## Separador do rodapé tracejado (dono, 2026-11-19)
`footer-no-stats.ts`: o separador acima de `▲ bypass ligado` passou de ─ contínuo para ╌ tracejado, com a mesma cor `fraca`. Contrato do teste atualizado (2 vermelhos com `/tmp/footer.pre-tracejado.ts`).

## Compactação aberta sem faixa escura (dono, 2026-11-19)
`avisos/runtime.mjs` `linhaBarra(..., comFundo)`: aberta, a caixa pinta `customMessageBg` na linha inteira, mas as células sem fundo (`\x1b[49m`) e o `\x1b[0m` final da linha `compactado` apagavam esse fundo e ela virava uma faixa escura. Agora, aberta, cada célula leva o fundo da caixa, a linha é completada até a largura e o fundo é reaberto depois do reset. Teste novo (vermelho com `/tmp/runtime.pre-compexp.mjs`). Pi real (`/tmp/compexp.py`, sessão `/tmp/sesscx`): sem `49m` na linha.

## Editor mais perto das abas (dono, 2026-11-19)
`footer-no-stats.ts`: o embrulho de `tui.children[5]` (widgets abaixo do editor) tira a linha vazia que as abas do pi-code (`fleet-ui/chrome.ts`) põem no topo. Pi real: `╰──╯` logo acima de `Status`. Teste novo (vermelho com `/tmp/footer.pre-perto.ts`).

## Modo junto ao bypass, com cor por modo (dono, 2026-11-19)
`claude-compat/permissions/controller.ts` `statusPartes`: o modo sempre aparece no rodapé, junto ao bypass: `⏵ ask` (verde, `success`), `⏵⏵ auto` (azul, `accent`), `⏸ plan` (roxo, `bashMode`), depois `▲ bypass ligado` (vermelho). Antes: só `⏵⏵ auto on` e/ou o bypass; Ask não aparecia e o `⏸ plan` amarelo do pi-code ficava no HUD. O `Sink.status` passou de `(texto, perigo)` para partes tipadas; `wiring.ts` `COR` pinta. `footer-no-stats.ts` esconde o `plan-mode` do pi-code no rodapé e na ponte do HUD. Testes: controller/slot (contrato reescrito com comentário), cores do sinkFor, rodapé (vermelhos com os `.pre-modos` em /tmp). Pi real (`/tmp/modos.py`, shift+tab): ask 158;206;106 → auto 122;162;247 → plan 187;154;247, sem outro `plan` na tela.

## Interrompido: Ícone e tecla + Pulso (dono, 2026-11-19, lab /interrompido)
`runtime.mjs` `linhaInterrompido`/`faixaInterrompido`: uma linha só no fundo de erro (antes 3, com respiro), ícone de parada pequeno `▪` (o `\uf04d` do lab ficou grande; pedido do dono), frase em negrito, `esc · hora` dim à direita (sai quando não cabe); recém-criada, o vermelho pulsa duas vezes em `PULSO_MS` = 1200 e assenta (parado com movimento reduzido). Testes: 5 strings reescritas com comentário, naMargem aceita a faixa de 1 linha, teste novo do pulso/tecla; 4 vermelhos com `/tmp/runtime.pre-interr.mjs`. Precisa reaplicar o dist e reiniciar o pi.

## Projeto não confiável: Uma linha + Nasce do fundo (dono, 2026-11-19, lab /confianca desenho 6)
`runtime.mjs` `confianca`/`linhaConfianca` + gancho em `apply.mjs` (interactive-mode.js e chunk, `renderProjectTrustWarningIfNeeded`): o texto do core em inglês todo em warning virou `\uf071 projeto não confiável · recursos .pi do projeto ignorados · /trust salva a decisão (reinicie)` (ícone e frase em warning, resto dim, /trust accent; `!` sem Nerd Font), recuo 1; sobe do fundo em `CONFIANCA_MS` = 450. Testes: runtime (novo) e apply (asserção nova); 2 vermelhos com `/tmp/{runtime,apply}.pre-conf.mjs`. Precisa reaplicar o dist e reiniciar o pi.

## Read/Write: Pulso no erro e no aviso (dono, 2026-11-19, lab /rwerro desenho 1 + "Pulso", "também para warning")
`ui-visual/read/chips.ts` `PULSO_MS` = 1200, `janelaLeitura`: depois da transição, a cor do ícone e do verbo pulsa duas vezes no erro (Read e Write) e no aviso (Read truncado), e assenta; sucesso não pulsa. `tools.ts`: Read/Write ficam vivos (sem guardar o desenho) até o fim da janela; antes o desenho do erro era guardado no 1º quadro com args estáveis (a transição do erro não animava no pi real). Testes em `test/tools/leitura.test.ts`: 2 esperas reescritas com comentário, teste novo do pulso (vermelho com `/tmp/{chips,tools}.pre-pulso.ts`).

## Rolagem: Duas linhas (dono, 2026-11-19, lab /rolagem desenho 6 + Fixo)
`sticky-prompt/sticky.ts` `stickyLinhas` (rótulo `▎ você · HH:MM` em accent/dim acima da faixa) e `indicadorFim` (pílula `↓ voltar ao fim · ctrl+end`, ou `N novas · ↓ ctrl+end` com a contagem em verde; antes ` ↓ Jump to latest message · Ctrl+End `). `index.ts` troca `tui.scrollToEndIndicator` (campo interno do pi-tui 1.5.2, restaurado no dispose; atalho lido do texto original) e conta respostas do assistente que chegam fora do fim (zera ao voltar). Bug achado no caminho: prompt de uma linha chega como `133;B 133;C 133;A texto` e o sticky nunca o achava; `ZONE_START` aceita B/C antes do A (teste vermelho antes). Pi real (`/tmp/rolchk2.py`): topo `▎ você · 20:23` + faixa `❯ nao leia nada do .claude`, base `↓ voltar ao fim · ctrl+end`.

## Subagente: Chips + Brilho no nome (dono, 2026-11-20, lab /subag desenho 5 + animação 8)
`ui-visual/sub/chips.ts` (novo; `tools.ts` `subCorpo` e a linha da chamada só delegam). Antes: `◎ 2 agentes · 6 turnos · 1 falhou` + árvore `├ agente · concluído · resultado`, `Subagent was aborted` como erro. Agora, por agente: ` <ícone> [agente] [estado] [N turnos] [tokens] [custo]` + tempo em pílula à direita e, recuado, tarefa (rodando), resultado (ok) ou erro/motivo (muted). Turnos, tokens e custo só quando `details.results[].usage` os traz (turns; contextTokens ou input+output; cost). `interrompido` = `stopReason: 'aborted'` ou a chamada que lançou `Subagent was aborted` (erro sem details; motivo `interrompido antes de terminar`). Ao assentar: cor do estado surge do dim (ok, interrompido) ou pulsa 2x (erro) em 600 ms; só quem foi visto rodando anima, histórico já nasce assentado. Brilho do accent corre pelo nome a cada 1,3 s só rodando. Sem spinner braille (regra do dono, 2026-11-20): o ícone (robô) respira dim ↔ syntaxType (`motion.ts` `respira`). Ordem = a da chamada (antes: quem falhou primeiro). Segundo plano (`enviado para segundo plano`) não mudou. Tempo: rodando corre do início da chamada (`vivo.ts` `inicioDe`); assentado, intervalo dos timestamps das mensagens ou `durationMs` se for um agente só.
Testes: `test/tools/subagente.test.ts` (chips só com dado real, interrompido por stopReason e por abort, transição dim→verde e pulso do erro com relógio injetado, brilho só rodando/estático/reduzido/NO_COLOR, tempo, respiração sem braille); `estado.test.ts` (2 testes de subagente reescritos com `(dono, 2026-11-20): antes …`). Vermelho: com o `tools.ts` anterior falham interrompido + os 2 de subagente; sem `sub/chips.ts` os testes nem importam; a respiração ficou vermelha com o ícone trocado por `⠋`.

## Faixa do run em segundo plano: "Atual" + Nasce do fundo (dono, 2026-11-20, lab /segplano)
`run/banda.ts` `bandaRun`: o desenho não mudou; ao aparecer ao vivo sobe do fundo em 450 ms (`esmaecer`, de customMessageBg ao texto), uma vez por run (`nascidas` por id do run), pronta no histórico, sem flash com movimento reduzido/NO_COLOR. `vivo.ts` `idadeFim(ctx, ms, agora)` ganhou o relógio injetável. Teste: `test/tools/banda.test.ts` (vermelho com o `banda.ts` anterior).

## Marcador do run de subagente (dono, 2026-11-20)
`banda.ts` `marca`: run de subagente (`[agent]` no texto do pi-code, id fg-/bg-) usa md-cog_play `\u{f1935}` no lugar de `▸` (mesma cor do estado); shell e sem Nerd Font mantêm `▸`. `tools.ts` lê o tipo em `RUN_LINHA` (`RunVisto.agente`). Teste em `banda.test.ts` (vermelho antes).

## MCP: Uma linha · barra fina · chave + Flash na troca (dono, 2026-11-20, lab /ferramcp desenho 21)
`ui-visual/mcp/linha.ts` (novo) para ferramentas `mcp__<servidor>__<ferramenta>` (shell 'self', sem caixa/fundo; antes cartão de estado com args e JSON). ` <chave \uf0ad> servidor › ferramenta  args…` e à direita: rodando só o tempo vivo (dim, sem `aguardando`) com a barra fina embaixo (trecho accent deslizando); ok/erro/aviso uma linha só com resumo (ok muted: `imagem · N KB`; erro: 1ª linha do erro; aviso = `details.truncation.truncated`) + duração. Chave: accent respirando (sem spinner) / success / error / warning. Na troca de estado a linha sobe do fundo em 500 ms, uma vez (histórico e movimento reduzido: assentada). Expandido (ctrl+o) mostra o corpo nativo recuado; imagens seguem pelo `image-open`. Teste: `test/tools/mcp.test.ts` (vermelho com o `tools.ts` anterior no de integração).

## Question: Resposta em destaque + entrada (dono, 2026-11-20, lab /pergunta desenho 7)
`ui-visual/pergunta/bloco.ts` (novo; usa `details` do pi-code). Sem fundo; por pergunta ` cabeçalho · texto (dim)` (+ `ctrl+o abre` e hora na 1ª) e ` ❯ resposta` (success negrito; `sem resposta · Esc`/`tempo esgotado` warning; `(outra)` dim; `aguardando resposta` respirando); linha em branco entre perguntas; aberto lista as opções. Entrada: sobe do fundo em 450 ms na 1ª vez ao vivo, histórico pronto. `chrome.ts` `perguntaLinhas` ficou sem uso (não removida). Testes: `test/tools/pergunta.test.ts` + 2 testes de question reescritos em `estado.test.ts` (com `(dono, 2026-11-20): antes …`); vermelho com o `tools.ts` anterior.

## Plano aprovado: "Lista de etapas" + Desliza (dono, 2026-11-20, lab /execplano desenho 9 + animação 7)
`ui-visual/plano/` (novo: `modelo.ts` lê o ramo, `mensagem.ts` desenha, `index.ts` liga `registerMessageRenderer('plan-mode-execute')`). Antes: caixa `customMessageBg` com o texto inglês do agente (~10 linhas). Agora: ` \uf0ae  Plano · executando` + `feitas/total` dim à direita e uma janela de 3 etapas (anterior, atual, próxima) em `├ └`: `\uf42e` success feita, `○` borderMuted pendente, `●` que respira (`motion.ts` `respira`, sem spinner braille) na atual, `n. título` (atual em `text`, outras dim). Estados: executando (syntaxType), concluído (success), encerrado (warning). O agente recebe o texto original; só a exibição muda, e expandido (ctrl+o/alt+o) o pi mostra o texto original (o renderer devolve `undefined`).
- Dados: a entrada `custom` `plan-mode` do pi-code (`todos: [{step, text, completed}]`, gravada antes da mensagem e a cada mudança) dá títulos e progresso; `plan-complete` / `plan-cancelled` ou uma nova `plan-mode-execute` fecham a execução. Cada mensagem acha a sua entrada pelo conteúdo + timestamp mais próximo. O renderer não recebe `ctx`: o ramo vem de `sessionManager` guardado em `session_start` (relido só quando a folha muda). Sem entrada: só o texto (`Start with: <1ª etapa>`), sem total nem contador; sem etapas rastreadas: só o cabeçalho. O canal `pi-code:plan-state` não traz títulos, não é usado.
- Entrada "Desliza": 12 colunas da direita em 400 ms (`easeOutCubic`) só quando a mensagem acabou de chegar (< 400 ms); histórico nasce pronto; `anima()` desliga (movimento reduzido, NO_COLOR, sem foco). Relógio injetável (`agora`). Redesenho pelo relógio único (`assinarQuadro('ui-visual-plano')`), só enquanto é desenhado.
- Testes: `test/plano.test.ts` (9) e o novo caso de `index.test.ts`; vermelhos sem `plano/` e sem a linha `plano(pi)` do `index.ts`.

## Memory: Frase compacta + Nasce do fundo (dono, 2026-11-20, lab /memoria desenho 9)
`extensions/ui-visual/memoria/linha.ts` (novo; `tools.ts` só o chama): a chamada da ferramenta `memory` é uma linha ` <MEM> <Memory> · <saved|read|deleted|listed|failed> · <nome>` (erro: `· <motivo>`), sem cartão e sem o texto cru fora dele (antes cartão neutro `● memory · save nome · descrição…` + `Saved memory x`). Estado na cor da ação (save success, read accent, delete warning, list syntaxType, erro error); `·` dim; hora no estilo padrão (dim, sem pílula) à direita; ícone `\u{f09d1}` muted. read e list ganham o trecho embaixo (recuo 3, muted; 2 linhas do corpo no read, 3 nomes e `+N` no list; list diz `N memórias` com a contagem real). Executando: sem spinner, o ícone respira (`respira`). Entrada: ao terminar a linha sobe do fundo em 450 ms uma vez (`moldura/nasce.ts`, `idadeFim`, relógio injetável); histórico e movimento reduzido já nascem assentados.
Fonte dos dados (pi-code `memory.ts`, só leitura): args `{action, name}`; o resultado é texto cru em inglês e o erro NÃO vem como `isError` (`No memory named x.`, `… could not be read`, `… requires name`…), então `resumoMemoria` classifica pelo texto (não encontrada, leitura falhou, nome ausente, indisponível…) e conta as linhas `- [nome](…)` do list. Escolha: trecho em muted (como o `segunda()` do lab; o pedido dizia dim). Testes: `test/tools/memoria.test.ts` (novo, 7) e contrato de `estado.test.ts` trocado (`// … (dono, 2026-11-20): antes …`). Vermelho com os backups `/tmp/{tools,base}.pre-memmold.ts`. Pi mock (tmux `-L laneK`, injeção temporária restaurada por `cmp`): as 5 ações e o erro saem como acima.

## Read/Write: Moldura + Nasce do fundo (dono, 2026-11-20, lab /pertence desenho 5)
A régua `─` do cabeçalho dobra em `╮`, `│` desce dos dois lados do corpo e `╰─…─╯` fecha; borderMuted, error no erro. `extensions/ui-visual/moldura/quadro.ts` (novo) faz o cabeçalho curvo e o corpo emoldurado (fundo neutro mantido); `image-open/fundo.ts` (`pintarImagem(..., marco)`) emoldura a caixa da miniatura + ficha. O corpo só existe (e a moldura só aparece) onde já havia resultado visível: imagem, erro (Read erro), expandido (alt+o) e o aviso de sintaxe do Write; o Read/Write recolhido de texto continua sem corpo e sem `╮` (o lab mostra um código que o real não tem recolhido). Sem cor no tema, NO_COLOR, ASCII, < 24 colunas ou sem miniatura emoldurada (iTerm2, sem kitty): desenho de antes. O pulso do Read/Write (`janelaLeitura`) e o clique na imagem não mudam: o clique roteia por linha (a moldura só soma colunas e uma linha de fecho depois da imagem). Decisões: Read de imagem aberto não escreve mais o texto nativo `Read image file…` entre cabeçalho e miniatura; o cabeçalho dobra na imagem só com `getCapabilities().images === 'kitty'` (mesma condição que torna a miniatura emoldurada). Entrada: a caixa sobe do fundo em 450 ms uma vez, só se foi vista executando (histórico assentado, movimento reduzido sem efeito). Testes: `test/tools/moldura.test.ts` (novo, 7), `fundo.test.ts` (+3; o contrato do teste de alinhamento com a margem do chat ganhou `// … (dono, 2026-11-20): antes …`). Vermelho com `/tmp/{tools,base}.pre-memmold.ts`, `/tmp/fundo.pre-memmold.ts`. Pi mock: Read erro sai `○ Read · erro · alvo ───── hora ╮` / `│ ENOENT… │` / `╰──╯`; a miniatura de imagem não foi vista no tmux (descarta o APC kitty): coberta por teste.

## plan_mode_complete: Expandido + Cascata (dono, 2026-11-20, lab /planopronto desenho 10 + animação 4)
`extensions/ui-visual/plano/pronto.ts` (novo; `tools.ts` só o chama): sem cartão verde, sem `plan_mode_complete` e sem o corpo em inglês. Aberto: ` <ícone>  Plano · <estado> ──── hora  <tecla> recolher`, tier completo (muted, quebrado), etapas numeradas (`1. …`, extraídas dos args `plan`) e o arquivo (dim, `~`); ícone muted e `Plano` bold em `text` (dois espaços entre eles), estado colorido (success enviado, error não aceito/não enviado, syntaxType enviando), `·` e hora dim sem pílula; enviando o ícone respira, sem spinner. Erro em pt-BR a partir do texto cru do pi-code (`Plan not accepted` + problemas `- …`, `No plan file…`, `Not in plan mode…`). Escolha: recolhido = só o cabeçalho (`<tecla> expandir`) e o arquivo (o lab só define o aberto); a tecla é a configurada (`keyText`). Aprovado/ajustes pedidos do lab não aparecem: dependem de ação do dono depois da chamada e não do resultado. Cascata: ao chegar o resultado cada linha se revela da esquerda, 80 ms depois da anterior, 300 ms cada, uma vez (`idadeFim`, relógio injetável); histórico e movimento reduzido assentados. Testes: `test/tools/pronto.test.ts` (novo, 7); vermelho com `/tmp/{tools,base}.pre-memmold.ts`. Pi mock (injeção temporária restaurada por `cmp`): recolhido e aberto (ctrl+o do mock) conferidos.

## Bloco de progresso do plano (lab /progplano desenho 10 "Trilho" sem a barra + Pulso): feito por patch do pi-code (2026-11-20)
Antes "bloqueado" (o bloco é o texto de `renderDoneTags`, embutido por `plan-mode/index.ts:241`; sem gancho de renderer). O dono delegou a decisão e escolheu o patch: `claude-home/patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-bloco-hook.patch` (último da pilha; `bin/pi` aplica em ordem de nome, pula com aviso se não encaixar, manifesto `patches.sha256` regenerado). O patch só adiciona `viaGancho` em `done-view.ts` nos 3 pontos que produzem o bloco (tags `[DONE:n]`, `PLAN WAITING|BLOCKED`, `PLAN CANCELLED`) e `theme` no `paint` de `index.ts`: consulta `globalThis.__nyPlanoBloco(estado)` (`PlanoBloco`: kind progresso|espera|bloqueado|cancelado, steps, total, nums, reason, bgId, sentAt, width, streaming, theme); texto devolvido vale, `undefined`, não-texto ou exceção = exibição original (sem gancho, byte a byte igual).
O harness registra o gancho em `extensions/ui-visual/plano/index.ts` e desenha em `plano/bloco.ts` (novo): 4 linhas sem fundo nem trilho `▎` — ` <ícone>  plano · <estado> · etapa N de T` + hora dim à direita (sem pílula), `<barra 12 células> <pct%>`, `atual: <etapa> · <saldo>`, `<motivo> · <o que fazer>`. Estados: em espera (bashMode), executando (syntaxType), aguardando subagentes (espera com id de segundo plano, bashMode), bloqueado (warning, ícone `\uf421`), concluído (success, `\uf42e`), cancelado (muted). `·` dim neutro, sem spinner. Pulso (`pulsar`): a cor do estado pulsa duas vezes em 1,2 s na primeira vez que o bloco é desenhado e a cada mudança de estado (chave kind|tags|motivo|id|total|hora|feitas), relógio injetável, só com `anima()` (movimento reduzido/sem foco: fixo); NO_COLOR = texto puro. Decisões: a linha 4 junta motivo e ação (`falta X · precisa de você · …`) porque o lab descartava o motivo; progresso usa a última tag do bloco (histórico estável); sem título da etapa, sem plano ou sem tema: devolve `undefined` (pi-code desenha). Testes: `test/plano.test.ts` (+4), `patches/pi-code/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-plan-bloco-hook/plan-bloco-hook.test.ts` (4: sem gancho idêntico, gancho inválido, dados do gancho, tema no paint). Vermelho: sem `bloco.ts` (backup `/tmp/bloco.pre-progplano.ts`, `cmp`) e com o teste do patch apontado à cópia sem o patch. Ativação: copiar `claude-home/patches` e `extensions/ui-visual` do repo para `~/.pi/agent`, reiniciar o pi pelo wrapper `bin/pi` (aplica o patch no pi-code instalado; `/reload` não reaplica patches).

## Read de imagem: buraco entre `╮` e a caixa (dono, 2026-11-20)
Print do kitty real: a linha de respiro que `moldura/quadro.ts` devolvia para a imagem era `''` (sem `│`), então entre o `╮` do cabeçalho e a caixa da miniatura (`image-open/fundo.ts`) ficava uma linha sem bordas e os lados não ligavam. Agora `moldurado` devolve `│ … │` (`linhaVazia`, mesmo fundo/cor, com Nasce do fundo) na largura do corpo. Bordas já alinhadas medidas: `╮`, `│` e `╯` na mesma coluna. Testes: `ui-visual/test/tools/moldura.test.ts` (+2; contrato do teste do kitty atualizado), larguras 80/110/180, imagem (kitty mockado, sem APC/ANSI), Read aberto e erro. Vermelho com `/tmp/quadro.pre-bordas.ts`, `/tmp/moldura.test.pre-bordas.ts`.

## Subagentes: Chips sem fundo + Brilho no nome (dono, 2026-11-20, lab /subag3 desenho 7 + animação 4)
Supersede o card em chips com fundo (lab /subag desenho 5). `sub/chips.ts` `cartaoSub`: cabeçalho ` <robô>  Subagentes · 1 executando · 1 ok · 1 erro` (contagem por estado colorida, `·` dim neutro) com `alt+o abre · hora` em dim, sem pílula, e a hora na última coluna do chat (a mesma do Read); uma linha por agente `├/└ agente · estado · mm:ss · texto`. Um agente: ` <robô>  Subagente · <estado> · N turnos · tok · custo` (turnos/tokens/custo só com `usage` real) + a mesma linha. Nome da tool sempre capitalizado (`Subagente`/`Subagentes`). Estados: executando/concluído/erro/interrompido; `aviso` não é emitido (o pi-code não o distingue). Sem spinner: executando respira (`respira`) e um brilho accent corre pelo nome só enquanto roda; transição 600 ms (surge do dim, pulso duplo no erro); assentado estático; sem movimento/cor, plano. `enviado para segundo plano`: 1ª linha em faixa neutra `customMessageBg` de ponta a ponta com a hora dim dentro (`cabecalhoFaixa`), linha 2 sem fundo. `tools.ts` só passa `hora` e a largura cheia `w`. Testes: `test/tools/subagente.test.ts` (+paralelo), `estado.test.ts` (reescritos com `(dono, 2026-11-20): antes …`, +hora/faixa). Vermelho com `chips.ts`/`tools.ts` anteriores (backups `/tmp/*.pre-subag3.ts`, `cmp`): 9 falhas.

## Miniatura do Read: ficha centrada na moldura (dono, 2026-11-20, "alinha a img às infos")
`image-open/fundo.ts` (`pintarImagem`): a moldura da miniatura tem F = linhas+2 linhas; a ficha agora é centrada nela (3 linhas de texto se F é ímpar, 2 se par; as últimas se juntam com ` · `), começando em floor((F-n)/2). Antes o nome ficava na 1ª linha da imagem e a última linha na borda de baixo (imagem larga, F=3: moldura nas linhas 0-2, texto nas 1-2). Supersede o "da 1ª linha da imagem até a borda de baixo" de 2026-11-19. Nenhuma linha foi somada, então o roteamento do clique (`rotearImagens`, por linha) não muda. Testes: `fundo.test.ts` (+1: larga 1675×75, quadrada, alta × 80/110/180; 1 atualizado), vermelhos com `/tmp/fundo.pre-alinha.ts`.
Ações sem run (send/status/cancel/resume, dono, 2026-11-20): corpo de texto com `│` dim e o texto na coluna da palavra `Subagente` (`corpoDeAcao`, `sub/chips.ts`, cortado com `…`); cabeçalho ` <robô>  Subagente · <mensagem|status|cancelar|retomar> · <agente, se conhecido> <id dim>` e, antes da hora, o desfecho real do resultado do pi-code (`na fila` accent, `entregue`/`cancelado`/`retomado` success, `falhou` error; texto não reconhecido = nada). O agente vem do aviso `Started background run <id> (<agente>)` da mesma sessão (`registraRun`); após reload fica omitido. Testes em `estado.test.ts`; vermelho com os backups `/tmp/*.pre-sendpipe.ts`/`*.pre-sendhdr.ts`.
Ação pendente (sem resultado): `cabecalhoAcao` (`sub/chips.ts`) monta ` <robô>  Subagente · <ação> · <agente?> <id dim>` já na chamada, sem desfecho (que chega com o resultado); antes `Subagente · mensagem para bg-…`. Teste em `estado.test.ts`; backups `/tmp/*.pre-sendpend.ts`.

- **Subagent (dono, 2026-11-20):** o nome da ferramenta passa a `Subagent`/`Subagents` (antes `Subagente`/`Subagentes`), como `Read`, `Edit` e `Memory`; no corpo de texto puro o `│` fica na coluna do nome e o texto 2 colunas depois (antes o `│` 2 colunas antes do nome). Testes: `estado.test.ts`, `subagente.test.ts` (24/24; 7 vermelhos com `/tmp/{chips,tools}.pre-subagent.ts`); ui-visual 275/276, 0 falhas.

## Tela do /reload pronta antes de aparecer (dono, 2026-11-20)

Antes: a tela voltava no quadro em que a caixa `recarregando` saía do editor, com rodapé, abas e infos ainda vazios, e depois
"pulava". Agora (`claude-home/patches/pi-core/avisos/runtime.mjs`, `recarregando` + `limparTela`):

- **Porteiro de pronto**: depois que a caixa sai, a carga continua no lugar do editor e os outros filhos do TUI seguem escondidos.
  A cada quadro do relógio existente (`QUADRO_MS`, sem timer novo) `tick()` amostra o `render` original dos filhos escondidos
  (menos o chat, que anima). Pronto = rodapé (último filho) não vazio **e** desenho dos filhos igual por `ESTAVEL_N` = 3 quadros
  e 3·`QUADRO_MS`. Teto `PRONTO_MAX_MS` = 1500 ms depois da saída da caixa; sem rodapé libera na hora.
- **Animação**: pronto, a carga apaga em `SAI_MS` = 180 ms (ease; palavra e pontos se misturam com o fundo) e só então os filhos
  voltam; o fade de entrada da tela inteira (`ui-visual/header.ts`, `recarregar`) começa no 1º quadro de conteúdo real, como antes.
  A palavra `recarregando` respira muted→text com período `CICLO_MS`. Pontos Crescendo inalterados. Sem spinner braille.
- **Movimento reduzido** (`parado()`) ou tema sem RGB: sem fade nem respiração; troca direto quando pronto.
- **Regras e Memória** do /reload (`chipsAviso`): cada linha numa faixa neutra `customMessageBg` de ponta a ponta, recuo 2, cores
  do texto e separadores `·` dim iguais; o "nasce do fundo" inclui a faixa. Sem cor (sem truecolor): sem faixa.
- Testes: `claude-home/bin/tests/avisos-core/runtime.test.ts` (relógio injetável `agora`, `comp.quadro()`).
- Aplicar no pi: `apply.mjs <dist> --revert` e `apply.mjs <dist>`; **reiniciar o pi** para o dist novo valer.

## Título do Bash sem régua (dono, 2026-11-20)
- `motion/shell.ts`: título `<ícone> Bash · <ESTADO> · <comando>` + espaços + hora dim na mesma coluna (antes `Bash ─ comando ───── hora`; sem `─`). Estado logo após o nome: `OK`/`OK · N avisos`/`Erro…` (cor do desfecho, dissolve dim→alvo), `executando` (accent respirando via `respira`, sem spinner braille) e `recebendo` (dim). Separadores `·` dim. Estreito: o comando encolhe com `…`, o estado nunca é cortado. O rodapé final perde o estado (`dur · N linhas · K acima · atalho · log`) e some se vazio; rodando mantém barra + descrição + tempo + linhas. Substitui a régua de 2026-11-18/19; o cartão `run-finished` (hook-msgs) herda. Testes: `ui-visual/test/tools/shell.test.ts`, `tools.test.ts`, `hook-msgs/index.test.ts`. O e2e do mock não afirma o título do Bash.
- (2026-11-20, dono) Card do subagente (rodando, concluído, paralelo): cabeçalho com a faixa neutra customMessageBg de ponta a ponta (hora dim dentro; sem cor, sem faixa), ícone do robô na coluna 0 como o Read, `├/└` e o `│` do corpo na coluna da palavra `Subagent` (texto 2 colunas depois), estado rodando continua respirando; `sub/chips.ts` (`colSub`), testes em `test/tools/{estado,subagente}.test.ts`.

- 2026-11-20 · Subagent: ícone e nome em accent em todos os cartões; `status` legível (sub/status.ts: contagem no cabeçalho, um run por linha, texto desconhecido sob `│`). Lab /subag2 desenho 3 "Cabeçalho + └" + Brilho: um agente `Subagent · agente · estado · fatos` e `└ texto`; segundo plano `Subagent · agente ⚙ · enviado` + `└ tarefa` (vários: `Subagents · N enviados`, `├ agente ⚙ · tarefa`).
- 2026-11-20 · Fila: shift+↑/↓ escolhe um item (patch send-now, `globalThis.__piFilaSel`); shift+⌫ remove só ele, shift+← leva só ele ao editor; sem escolha, como antes. Vista (up-dequeue): número accent e texto em negrito, janela acompanha. Precisa reiniciar o ny-pi.
