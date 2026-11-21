# Faixa extensoes-ui (relatório bruto do subagente, 2026-11-19)

**Escopo.** Revisão somente leitura, sem alterar nada e sem rodar build ou suíte. Sem índice codegraph, então a cobertura é degradada: usei Read e rg. Li inteiros `extensions/ui/{editor,history,diff,terminal,a11y,btw}.ts`, `extensions/ui-visual/**` (menos `motion/nycode.ts`), `code-blocks`, `chat-margin`, `sticky-prompt`, `image-open` e os `.mjs` do hud. Não repeti o que `docs/perf-sota.md` já fechou (memo de `horaDe`, `mesmaSaida`, cadência ELU).

**Evidência executada:**
- Medi `toLocaleTimeString` em 2000 chamadas: 49 ms (25 µs cada), contra 1 ms com `Intl` compartilhado.
- Medi `toString` e `split` de 8 MB: 43 ms.
- Medi `git status` neste repo: 0,00 s.
- Confirmei no pi-tui instalado (`pi-coding-agent` 1.1.0) que `markdown.js` não tem `blockHighlightedCode`.
- Confirmei em `tui-main-screen.js:485` que linha mais larga que o terminal lança erro e derruba o pi.

## Achados

`ALTA | bug | code-blocks/blocks.ts:171 (via index.ts:112) | Fence com info-string longa e sem espaço (` ```typescript:src/…/Foo.tsx `): o `lang` vira o rótulo sem truncar. `gap = max(1, …)` deixa a linha do cabeçalho com mais colunas que `width`, e o pi-tui lança "Rendered line exceeds terminal width" e encerra o processo. Pega mais em terminal estreito, mas passa de 45 colunas de rótulo em 60 colunas. | Truncar o rótulo com `truncateToWidth(lang, inner - visibleWidth(button) - 1)` antes de montar a linha.`

`ALTA | perf | code-blocks/index.ts:79,93 | `md.blockHighlightedCode?.get/set` não existe no pi-tui instalado, então o cache de realce nunca age. O Markdown só guarda cache do resultado inteiro (texto+largura). Qualquer delta de texto, ou cada tick de 30 fps do `suavizar` com `falta`, refaz o lexer e o `hljs.highlight` de todos os blocos da mensagem, inclusive os já fechados. Custo O(blocos·linhas) por tick, sem teto de tamanho de bloco. | Guardar o realce num `Map` local do módulo (chave: grammar+texto, teto de ~200 entradas) e não realçar blocos acima de ~2000 linhas.`

`ALTA | bug | code-blocks/index.ts:28 | `remember(token.text)` roda a cada render do token, e durante o stream cada prefixo do código vira uma entrada nova (`blockId` muda). Em ~17 s de stream de um bloco (30 ticks/s) o limite `MAX_BLOCKS=500` é atingido. Isso expulsa os blocos antigos, e o clique no "⧉ copiar" responde "Bloco não está mais em memória". Cada entrada guarda o texto inteiro (O(n²) de memória). | Só chamar `remember` quando o bloco estiver fechado (`next !== undefined`), ou substituir a entrada anterior do mesmo bloco por posição.`

`MÉDIA | perf | sticky-prompt/sticky.ts:19 (chamado por index.ts:17) | `opts.visible` roda a cada quadro. Sem cache, `findSticky` caminha de `scrollTop` para trás aplicando regex por linha. Em cada `ZONE_START` o laço interno aplica `strip`+`trim` até `ZONE_END`, e vai até o fim do transcript se o fim não existe (zona em stream). Rolando dentro de uma resposta longa, custa O(linhas × zonas) por frame, com alocação. | Memoizar por `(scrollContentLines, scrollTop)` e indexar as zonas `ZONE_START` uma vez por mudança de array.`

`MÉDIA | perf | ui-visual/tools.ts:356 (e diff.ts:199) | `diffComponent` usa `w` na chave do memo e `renderDiff` refaz parse, LCS de palavras e `highlightCode` linha a linha a cada largura. Arrastar a janela re-realça todos os diffs de `edit` do histórico a cada passo de resize (centenas de edits × dezenas de linhas). | Cachear em WeakMap, por string do diff, as entradas já parseadas e realçadas, e deixar só `fit` e `pad` dependerem da largura.`

`MÉDIA | bug | ui-visual/compact.ts:60,102 × chat-margin/inset.ts:92 | HIPÓTESE (não executada; ver Notas). `attach` devolve false se `chat.render` já é propriedade própria, mas o widget faz `done = true` mesmo assim. O `hookContainer` do chat-margin grava `c.render` próprio no mesmo contêiner (`doc.children[2]`). Na ordem alfabética de carga ele monta antes, então a compactação das tools seguidas nunca instala. Na ordem inversa o `hookContainer` sobrescreve o embrulho do compact. | Marcar `done` só se `attach` devolveu true, e fazer o chat-margin encadear o `render` existente em vez de usar `proto.render`.`

`MÉDIA | perf | ui/editor.ts:186 (getter `borderColor`) e 367 (`respiro`) | O getter roda a cada uso da borda (≥3 por frame). Cada chamada executa `getText()` (join de todas as linhas) em `shellLabel`, `busy()`, `anima()`, 2× `getFgAnsi` + regex e `performance.now`. Com colagem grande (100 KB), são ~6 joins de 100 KB por frame a 30 fps com o agente ocupado. | Calcular `shellLabel` e `respiro()` uma vez por `render()` e reutilizar nas bordas.`

`MÉDIA | perf | ui-visual/compact.ts:25 | `compactRender` reescreve o chat inteiro a cada frame: `layout.push` com objeto novo por filho, `rows.slice(1)` por tool e `push` linha a linha. Custa O(linhas do histórico) por quadro de animação, além do render do core. | Reaproveitar o resultado quando o `render` dos filhos devolve as mesmas referências (comparar por filho) e só montar `layout` quando a largura muda.`

`MÉDIA | perf | chat-margin/inset.ts:92 | `hookContainer.render` percorre todos os filhos do chat a cada frame. Para filhos não "soltos", `isLoose` roda `instanceof`, `getPrototypeOf` e `constructor.name` a cada frame, porque só os embrulhados são marcados. O custo é O(n) por frame. | Guardar os já vistos num `WeakSet` e chamar `onChild` só para filhos novos.`

`MÉDIA | perf | ui-visual/motion/marcas.ts:68,100 | `ligarCaminhos` roda a cada render do Markdown do assistente (a cada tick do suavizador). O regex `CAMINHO` varre a mensagem toda, e `statSync` síncrono corre dentro do render para caminhos novos (cache de 500). `hostname()` é chamado por link. Com um stream longo repleto de caminhos, cada tick bloqueia o laço de eventos. | Memoizar por `md` (último texto de entrada→saída) e chamar `hostname()` uma vez no módulo.`

`BAIXA | bug | ui-visual/motion/marcas.ts:68 | `existe` também guarda `false`. O caminho citado antes de o arquivo existir (por exemplo, criado por `write` logo depois) nunca vira link, até o mapa passar de 500 e ser limpo. | Não cachear `false`, ou dar TTL de poucos segundos aos negativos.`

`BAIXA | bug | ui-visual/index.ts:56-66 | `vistas` é chaveado só pelo texto. A 2ª mensagem viva idêntica a uma anterior ("continue", "sim") herda a hora da 1ª e não recebe o brilho. Ao chegar a 200 entradas o `clear()` faz as mensagens antigas ao vivo reganharem `Date.now()` e reanimarem o brilho no próximo re-render (resize ou Ctrl+L). | Chavear por identidade da mensagem (componente ou `c`) e usar LRU em vez de `clear`.`

`BAIXA | perf | ui-visual/index.ts:58 e 66 | O transformer do usuário roda `afinarMensagem(tuiAtual(), md)` (DFS de profundidade 6 por mensagem) e `new Date(t).toLocaleTimeString(…)` (~25 µs medidos) a cada render do Markdown de cada mensagem. No resize, o custo é O(mensagens × árvore). | Usar um `Intl.DateTimeFormat` único (como `HORA_FMT` em `tools.ts:135`) e marcar mensagens já afinadas.`

`BAIXA | perf | ui-visual/tools.ts:156 | `horaDe` varre `historico()` inteiro (`getBranch`) por chamada de ferramenta na 1ª pintura (resume, `/reload`). O custo é O(ferramentas × entradas); para 5000 entradas e 2000 ferramentas são ~10⁷ comparações, mais a cópia do ramo a cada chamada. | Montar uma vez um `Map<toolCallId, timestamp>` a partir de `historico()` e invalidá-lo em `session_start`.`

`BAIXA | vazamento | ui-visual/motion/vivo.ts:13 | `inicio` só limpa em `terminou`. Se `tool_execution_end` não chegar (reload, troca de sessão no meio da execução), `rodando(id)` fica true. O cartão de shell e a linha da tool redesenham a 30 fps para sempre enquanto o card estiver visível, e o mapa cresce sem teto. HIPÓTESE: depende de o pi sempre emitir o evento de fim. | Limpar `inicio` em `session_start` e `session_shutdown`, e podar entradas com mais de N minutos.`

`BAIXA | bug | ui-visual/icons.ts:187 | `largura()` conta code points, não colunas (o próprio comentário admite). Mensagem do usuário com CJK ou emoji larga calcula `gap` curto demais. A hora estoura a 1ª linha e o Markdown a quebra, desalinhando ou jogando a hora para a linha seguinte. | Trocar por `visibleWidth` do pi-tui e cortar `corte` por colunas, não por índice UTF-16.`

`BAIXA | bug | claude-home/bin/hud/calm-statusline.mjs:39 | `width()` conta code points (CJK, emoji e Nerd Font larguras 2). A linha `head` nunca é truncada, e o fallback `tries.at(-1)` pode passar de `columns`. Branch, dir ou modelo longos, ou terminal <60 colunas, deixam a linha mais larga que o rodapé. HIPÓTESE sobre o que o pi faz com linha excedente. | Medir com largura real (mesma tabela do pi-tui) e truncar `head` e o último fallback a `columns`.`

`MÉDIA | perf | claude-home/bin/hud/calm-statusline.mjs:60 | `gitState` roda `execFileSync` de `git status --porcelain -b` síncrono a cada execução da statusline, sem cache. Em repo grande ou NFS lento ele bloqueia até 400 ms e, ao estourar o timeout, devolve `undefined`: a branch some da linha de forma intermitente. Aqui `git status` leva 0,00 s, então não medi o pior caso. | Cachear `{cwd, branch, dirty}` em arquivo por 5–10 s e, em timeout, reaproveitar o último valor em vez de omitir.`

`MÉDIA | perf | claude-home/bin/hud/claude-hud-provider.mjs:10 | Quando o payload não traz `model.provider` (patch pendente), `lastModelChange` lê até 8 MB, converte para string e faz `split('\n')` (~43 ms medidos para 8 MB) a cada execução da statusline, e só depois varre de trás para frente. | Ler o arquivo de trás para frente em blocos de 64 KB e parar no 1º `model_change`.`

`BAIXA | bug | claude-home/bin/hud/claude-hud-pi-transcript.mjs:133 | `syncTranscript` lê o offset, anexa ao `out` e grava `state.json` sem trava nem escrita atômica. Duas execuções concorrentes da statusline (por exemplo, duas mensagens em sequência) leem o mesmo offset e duplicam linhas no transcript, e um `state.json` pela metade vira reset completo. HIPÓTESE: depende de o pi sobrepor execuções. | Gravar o estado em `tmp`+`rename` e tomar um lock simples (`O_EXCL`) durante a sincronização.`

`BAIXA | bug | claude-home/bin/hud/calm-statusline.mjs:106 | `ctxHistory` usa o mesmo `${file}.tmp` para todas as sessões, então duas sessões que gravam juntas se sobrescrevem ou falham no `rename`. O erro é engolido e o histórico perde pontos. | Usar `${file}.${process.pid}.tmp`, como `claude-hud-usage.mjs` já faz.`

`BAIXA | perf | claude-home/bin/hud/claude-hud-usage.mjs:135 | Com o cache de 60 s vencido, a statusline espera o `fetch` até 3 s. Se a rede cair, ela fica parada uma vez por minuto (falhas entram no cache, que limita o dano). Várias sessões renovam juntas no vencimento (sem lock). | Servir o cache vencido de imediato e renovar em processo separado e desacoplado (como o helper do antigravity).`

`BAIXA | perf | image-open/index.ts:23 | `writeTemp` roda no clique na imagem, no laço principal: `trim()` copia a string de até 70 MB, o regex `^[A-Za-z0-9+/]+={0,2}$` a percorre, `Buffer.from`, sha256 e `writeFileSync` são síncronos. Uma imagem de 50 MB trava o TUI por centenas de ms. | Cachear caminho por `base64Data` (WeakMap por componente) e gravar de forma assíncrona.`

`BAIXA | perf | ui-visual/diff.ts:225 | `Math.max(NUM_MIN, ...entries.map(…))` com spread: diffs acima de ~120 mil linhas lançam RangeError. `diffComponent` captura e cai no nativo sem aviso (degradação silenciosa). | Trocar por `reduce`.`

`BAIXA | perf | ui-visual/motion/escrita.ts:211 | Cada tick do suavizador chama o `updateContent` nativo com a mensagem inteira cortada, o que refaz o lexer do Markdown a ~30 fps enquanto há texto atrasado. O custo é O(len) por tick, ou O(n²) no stream de uma resposta longa (20 KB ≈ 2–5 ms/tick, estimativa sem medição). | Aplicar o corte só se o ganho de letras do tick for ≥ N, ou limitar a cadência quando `len` passa de um limiar.`

`BAIXA | gap-de-teste | code-blocks/index.ts:28-130 | `remember`, `highlighted`, `themePalette`, `syntaxPalette`, `copyBlock`, `hookClicks` e o `renderToken` embrulhado não têm teste (`blocks.test.ts` e `syntax.test.ts` cobrem só a lógica pura). Isso inclui os dois defeitos ALTA acima. | Teste com um `Markdown` falso: stream de 600 prefixos não pode expulsar o bloco 1, e rótulo de 80 colunas não pode passar de `width`.`

`BAIXA | gap-de-teste | sticky-prompt/index.ts, chat-margin/index.ts, ui-visual/motion/vivo.ts, claude-home/bin/hud/calm-statusline.mjs (`gitState`, `ctxHistory`) | Sem teste de integração de `attach`/`findBox`/`hookDocument`. `vivo.ts` (leak de `inicio`, `idadeFim`) e `gitState` (timeout, sem cache) não têm teste (`grep gitState` em `hud/tests` retornou vazio). | Caso de `gitState` com `git` falso lento, e teste de ordem chat-margin→compact no mesmo contêiner.`

`BAIXA | a11y | code-blocks/syntax.ts:46 e blocks.ts:23 | Paleta One Dark/Light e `TEXT_COLOR #8b9bb4` ficam fixas, ajustadas só por contraste (≥4,5:1) ao fundo, e ignoram o tema do usuário. Em tema de alto contraste ou daltonismo escolhido pelo dono, o realce não o acompanha; o NO_COLOR cai no nativo. | Permitir `syntaxPalette` derivada de tokens `syntax*` do tema quando existirem, mantendo o ajuste de contraste.`

`BAIXA | perf | ui-visual/motion/marcas.ts:84 | `repoGithub` faz `execFileSync('git', …, {timeout:2000})` no `session_start`, no caminho de abertura. Em disco lento, o 1º prompt demora até 2 s. | Chamar de forma assíncrona (`execFile`) e preencher `repo` quando voltar.`

## Top 5 ganhos de performance (ganho/risco)

1. **Cache de realce local em `code-blocks` + teto de tamanho** (`index.ts:79,93`). Ganho alto, risco baixo (função pura com Map).
   - Medir: rodar `perf.mjs` com o cenário de resposta longa com 3+ blocos de código em stream (hoje só `/mock-ui chat cancelar`, que não tem código) e comparar o CPU ativo antes e depois.
   - Medida pontual: `--cpu-prof` com `NY_PI_MOCK_PROF_DIR`, somando `hljs.highlight` e `hljsToAnsi`.
2. **`remember` só em bloco fechado** (`index.ts:28`). Corrige a perda do botão copiar e a memória O(n²); risco mínimo.
   - Medir: `process.memoryUsage()` (ou `idle_rss_mb`/`active_rss_mb` do `perf.mjs`) antes e depois de um stream de ~100 KB de código, e `state.codes.size` ao fim.
3. **Cache de zonas no `findSticky`, por (array, scrollTop)** (`sticky.ts:19`). Ganho médio-alto com histórico longo, risco baixo.
   - Medir: `idle_cpu_pct` do `perf.mjs` com 400+ entradas e rolagem simulada; ou micro-bench de `findSticky` com 20 mil linhas e ~200 zonas.
4. **Diff de `edit` independente da largura** (`tools.ts:356`, `diff.ts:199`). Evita re-realce de todos os diffs a cada passo de resize.
   - Medir: ganho no resize (tmux `resize-window` em loop com 100 edits no histórico, CPU de `truncateToWidth`/`highlightCode` no perfil).
   - Não aparece em `idle`/`active` do `perf.mjs`; criar variante com `resize`.
5. **`borderColor` e `respiro` uma vez por render** (`editor.ts:186,367`) **+ `compactRender` com reuso por filho** (`compact.ts:25`). Corta trabalho por frame com agente ocupado.
   - Medir: `active_cpu_pct` do `perf.mjs` (`/mock-ui chat cancelar`) com 400 entradas. A linha de base de 7,65% está em `perf-sota.md`.
   - Para o editor com colagem grande: colar 100 KB antes do cenário.

## Notas

- Nada foi editado, e a árvore tem 233 caminhos sujos de trabalho alheio. `ui/editor.ts`, `ui-visual/motion/*` e `chat-margin` mudaram há poucas horas, então os números de linha podem deslocar.
- Não rodei teste nem `perf.mjs`. Todos os custos "por frame" são estimativas por leitura, exceto as quatro medições do início.
- Sobre a hipótese compact × chat-margin: não confirmei que `doc.children[2]` e o contêiner de `findChat` são o mesmo. Teste: no mock, duas tools seguidas e ver se sobra a linha em branco entre elas.
- Fora do escopo, só como lead: `pi.getCommands().some(...)` em `editor.ts` (hasCommand) roda por tecla de `/x` e por submit. Custo pequeno, não listei como achado.
- Não vi `setInterval` sem clear nas extensões revisadas. O relógio único em `motion.ts` e os `assinarQuadro` se desfazem sozinhos. Sem foco o relógio cai a 250 ms de acordar (contínuo), mas assinantes de transição seguem a 16 ms enquanto durarem (curtos).
- Não revisei `claude-compat/vim/*` nem `motion/nycode.ts` em profundidade, e `claude-hud-antigravity.mjs` ficou de fora.
