// Onda 12 · fundação e cromo. Letras: A refina o que existe, B é a linha macOS (plano, cinzas, um acento), C é a mais silenciosa.
const AMOSTRA = `
 {b:pi} {d:1.5.2}
@u  {a:❯} refatore o parser>>{d:14:32}
@p   {m:$} {b:bash} {d:·} {c:executando} {d:· 14s · npm test}
@s   {m:▤} {b:read} {d:·} {o:concluído} {d:· src/a.ts · 51 linhas}>>{d:14:32}
@e   {m:$} {b:bash} {d:·} {e:código 1} {d:· 3 linhas}>>{d:14:33}
 {d:ctx} {o:━}{r:━━━━━━━} {d:9%}   {d:5h} {a:━}{r:━━━━━━━} {d:8%}   {d:semana} {p:━━━━━━}{r:━━} {d:78%}
`

window.ONDA12.push(
  {
    g: 'Fundação', id: 'paleta', t: 'Paleta e superfícies', onde: '~/.pi/agent/themes/pi-noite.json, pi-escuro.json',
    nota: 'Cada mock abaixo usa a própria paleta. O seletor "Tema dos mocks" no topo troca todos os outros.',
    hoje: AMOSTRA, hojeTema: 'noite', hojeNota: 'pi-noite: base Tokyo Night, azul, ciano e roxo em uso ao mesmo tempo.',
    v: [
      { n: 'Noite afinada', d: 'Mantém o pi-noite e tira o ciano de "executando" e da régua: azul é o único acento.', tema: 'noite', muda: 'ciano como cor de executando (onda 9)', l: `
 {b:pi} {d:1.5.2}
@u  {a:❯} refatore o parser>>{d:14:32}
@p   {m:$} {b:bash} {d:·} {a:executando} {d:· 14s · npm test}
@s   {m:▤} {b:read} {d:·} {o:concluído} {d:· src/a.ts · 51 linhas}>>{d:14:32}
@e   {m:$} {b:bash} {d:·} {e:código 1} {d:· 3 linhas}>>{d:14:33}
 {d:ctx} {o:━}{r:━━━━━━━} {d:9%}   {d:5h} {a:━}{r:━━━━━━━} {d:8%}   {d:semana} {w:━━━━━━}{r:━━} {d:78%}
` },
      { n: 'macOS escuro', d: 'Ativa o pi-escuro que já existe: cinzas e cores de sistema da Apple, fundo #1c1c1e.', tema: 'escuro', muda: 'pi-noite ativo (onda 9, D1)', l: AMOSTRA },
      { n: 'Grafite', d: 'Cinzas de sistema, um só acento azul e superfícies neutras: estado vem da palavra, não do fundo.', tema: 'grafite', muda: 'fundo da caixa por estado (onda 7)', l: `
 {b:pi} {d:1.5.2}
@u  {a:❯} refatore o parser>>{d:14:32}
@p   {m:$} {b:bash} {d:·} {a:executando} {d:· 14s · npm test}
@p   {m:▤} {b:read} {d:· concluído · src/a.ts · 51 linhas}>>{d:14:32}
@p   {m:$} {b:bash} {d:·} {e:código 1} {d:· 3 linhas}>>{d:14:33}
 {d:ctx} {m:━}{r:━━━━━━━} {d:9%}   {d:5h} {m:━}{r:━━━━━━━} {d:8%}   {d:semana} {w:━━━━━━}{r:━━} {d:78%}
` },
    ],
  },
  {
    g: 'Fundação', id: 'icones', t: 'Ícones das ferramentas', onde: 'ui-visual/icons.ts:7-89',
    nota: 'No kitty os ícones de hoje são Codicons da Nerd Font; aqui aparecem os equivalentes Unicode.',
    hoje: `
   {m:▤} {b:read}   {m:$} {b:bash}   {m:✎} {b:edit}   {m:+} {b:write}   {m:⌕} {b:grep}   {m:≡} {b:ls}
   {a:☰} {b:Task}   {m:◎} {b:subagente}   {m:?} {b:pergunta}   {m:⊕} {b:web}   {m:◆} {b:memory}   {m:▶} {b:run}
`,
    v: [
      { n: 'Menos ícones', d: 'Ícone só onde ajuda a achar: agente, pergunta e Task. O resto fica com o nome.', l: `
   {b:read}   {b:bash}   {b:edit}   {b:write}   {b:grep}   {b:ls}
   {a:☰} {b:Task}   {m:◎} {b:subagente}   {m:?} {b:pergunta}   {b:web}   {b:memory}   {b:run}
` },
      { n: 'Um glifo por família', d: 'Como os SF Symbols: forma igual para a mesma família (ler, escrever, executar, delegar).', l: `
   {m:○} {b:read}   {m:○} {b:grep}   {m:○} {b:ls}   {m:○} {b:web}        {d:ler}
   {m:●} {b:edit}   {m:●} {b:write}  {m:●} {b:memory}              {d:escrever}
   {m:▸} {b:bash}   {m:▸} {b:run}    {m:◆} {b:subagente}   {m:?} {b:pergunta}
` },
      { n: 'Sem ícones', d: 'Só tipografia: nome em negrito, alinhado numa coluna. Nenhuma fonte especial é necessária.', l: `
   {b:read}     {d:src/a.ts · 51 linhas}
   {b:bash}     {d:npm test · 7 linhas · 3.2s}
   {b:edit}     {d:src/a.ts · +2 −1}
` },
    ],
  },
  {
    g: 'Fundação', id: 'moldura', t: 'Molduras e separadores', onde: 'folha/sheet.ts (rule), diagnostico/painel.ts, ui/btw.ts',
    nota: 'Hoje há três estilos: réguas ── nas folhas, caixa arredondada azul no diagnóstico e borda ━ no /btw.',
    hoje: `
{r:── }{b:Histórico}{r: ─~}{r: ──}
 {d:conteúdo da folha}
{r:─~}
{a:╭─ }{ab:Diagnóstico}{a: ─~}{a:╮}
{a:│} {d:conteúdo do painel}>>{a:│}
{a:╰─~}{a:╯}
{a:━~}
 {ab:/btw pergunta}
{a:━~}
`,
    v: [
      { n: 'Réguas em tudo', d: 'A régua fina cinza vira o único estilo: diagnóstico e /btw passam a usá-la.', l: `
{r:── }{b:Histórico}{r: ─~}
 {d:conteúdo da folha}
{r:─~}
{r:── }{b:Diagnóstico}{r: ─~}
 {d:conteúdo do painel}
{r:─~}
` },
      { n: 'Cartão arredondado', d: 'Só controles (campo e folhas) ganham moldura de cantos redondos em cinza. A conversa fica plana.', l: `
{r:╭─ }{b:Histórico}{r: ─~}{r:╮}
{r:│} {d:conteúdo da folha}>>{r:│}
{r:╰─~}{r:╯}
{r:╭─ }{b:Diagnóstico}{r: ─~}{r:╮}
{r:│} {d:conteúdo do painel}>>{r:│}
{r:╰─~}{r:╯}
` },
      { n: 'Superfície sem linha', d: 'Nenhuma linha desenhada: a folha é um bloco de fundo mais claro, como um material do macOS.', l: `
@n
@n  {b:Histórico}
@n  {d:conteúdo da folha}
@n

@n  {b:Diagnóstico}
@n  {d:conteúdo do painel}
@n
` },
    ],
  },
  {
    g: 'Fundação', id: 'teclas', t: 'Dicas de tecla no rodapé', onde: 'folhas, painéis e diálogos',
    nota: 'A regra de no máximo 4 teclas (onda 4) não é seguida no diagnóstico (10 itens) nem nos runs (9 itens).',
    hoje: `
 {d:↑↓ item · enter json bruto · c copiar · e evento · l … · t info · s silenciar ·}
 {d:tab visão · esc fechar}
`,
    v: [
      { n: 'Tecla em destaque', d: 'Tecla na cor do texto, verbo apagado, espaço em vez de ponto. Quatro no máximo, o resto atrás de "?".', l: `
 ↑↓ {d:item}    ⏎ {d:abrir}    tab {d:visão}    esc {d:fechar}>>? {d:mais teclas}
` },
      { n: 'Teclas em cápsula', d: 'Cada tecla numa cápsula, como os atalhos dos menus do macOS.', l: `
 {k: ↑↓ } {d:item}   {k: ⏎ } {d:abrir}   {k: tab } {d:visão}   {k: esc } {d:fechar}>>{k: ? } {d:mais}
` },
      { n: 'Só o essencial', d: 'Duas teclas e o "?". Quem já sabe não lê; quem não sabe abre a ajuda.', l: `
 {d:⏎ abrir · esc fechar · ? todas as teclas}
` },
    ],
  },
  {
    g: 'Cromo', id: 'cabecalho', t: 'Cabeçalho', onde: 'ui-visual/header.ts:244',
    hoje: `
 {e:▀▀}{a:█}   {b:pi} {d:1.5.2}
 {a:█}{w:▀} {a:█}  {b:?}  {d:atalhos}    {b:/}  {d:comandos}    {b:!}  {d:shell}
`,
    v: [
      { n: 'Uma linha', d: 'Marca, versão e contexto da sessão numa linha; as dicas vão para a direita.', l: `
 {b:pi} {d:1.5.2 · pi-harness · main}>>{d:? atalhos · / comandos · ! shell}
` },
      { n: 'Título de janela', d: 'Centralizado como a barra de título do macOS: documento em negrito, detalhe apagado.', l: `
~ {b:pi-harness} {d:— main}
~ {d:pi 1.5.2 · ? atalhos}
` },
      { n: 'Quase nada', d: 'Uma linha apagada que some depois da primeira mensagem. O logo colorido sai.', l: `
 {d:pi 1.5.2 · ? atalhos}
` },
    ],
  },
  {
    g: 'Cromo', id: 'editor', t: 'Campo de entrada', onde: 'ui/editor.ts:404',
    hoje: `
{c:─────────────── refactor-parser ─~}
 {a:❯} {d:Pergunte, ou / comandos · @ arquivos · ! shell}
{c:─~}
`,
    v: [
      { n: 'Réguas discretas', d: 'Réguas cinza em vez de ciano; o nome da sessão vai para a direita e as dicas para baixo.', muda: 'régua ciano com foco', l: `
{r:─~}{d: refactor-parser }{r:──}
 {a:❯} {d:Pergunte qualquer coisa}
{r:─~}
 {d:/ comandos · @ arquivos · ! shell}>>{d:⏎ envia}
` },
      { n: 'Campo arredondado', d: 'Um campo de texto do macOS: cantos redondos, borda cinza que fica azul com foco.', muda: 'réguas finas como gramática única (onda 2)', l: `
{a:╭─~}{a:╮}
{a:│} {d:Pergunte qualquer coisa}>>{a:│}
{a:╰─ }{d:refactor-parser}{a: ─~}{d: ⏎ envia · ? atalhos }{a:─╯}
` },
      { n: 'Faixa de fundo', d: 'Sem linha: o campo é uma faixa de fundo mais claro, como o do Codex. O foco aparece no cursor.', muda: 'réguas finas como gramática única (onda 2)', l: `
@n
@n  {a:❯} {d:Pergunte qualquer coisa}
@n
 {d:refactor-parser}>>{d:? atalhos}
` },
    ],
  },
  {
    g: 'Cromo', id: 'editor-estados', t: 'Estados do campo: shell, vim, rascunho, fila', onde: 'ui/editor.ts:168-268',
    hoje: `
{p:─── refactor-parser ─── }{d:rascunho guardado · }ctrl+s{d: devolve}{p: ─~}
 {p:!} npm test
{p:─~}{p: shell}{d: · }{p:NORMAL }{p:───}
`,
    v: [
      { n: 'Rótulos em cápsula', d: 'Modo e rascunho viram cápsulas na régua de baixo; a régua não muda de cor.', l: `
{r:─~}{d: refactor-parser }{r:──}
 {p:!} npm test
{r:── }{k: shell } {k: normal }{r: ─~}{d: 1 rascunho · ctrl+s devolve }{r:──}
` },
      { n: 'Glifo do prompt muda', d: 'O prompt diz o modo: ❯ conversa, ! shell, : vim normal. O resto vai numa linha apagada abaixo.', l: `
{r:╭─~}{r:╮}
{r:│} {pb:!} npm test>>{r:│}
{r:╰─~}{r:╯}
 {p:shell} {d:· vim normal · 1 rascunho guardado}>>{d:ctrl+s devolve}
` },
      { n: 'Uma palavra', d: 'Só o modo ativo, numa palavra à direita. Rascunho e fila aparecem quando existem, um por vez.', l: `
@n
@n  {p:!} npm test>>{p:shell}
@n
 {d:1 rascunho · ctrl+s devolve}
` },
    ],
  },
  {
    g: 'Cromo', id: 'fila', t: 'Fila de mensagens', onde: 'up-dequeue/index.ts:46-77',
    hoje: `
   {a:▎} {b:Na fila} {d:· 2}>>{a:shift+←} {d:editar ·} {e:shift+⌫} {d:× excluir ·} {a:ctrl+⏎} {d:enviar agora}
   {a:▎} {d:1}  rode os testes de novo>>{d:ao terminar}
   {a:▎} {d:2}  {m:e atualize o README}>>{c:no próximo passo}
`,
    v: [
      { n: 'Dicas enxutas', d: 'A mesma lista, com uma só linha de teclas e sem vermelho no excluir.', l: `
   {a:▎} {b:Na fila} {d:· 2}>>{d:shift+← edita · ctrl+⏎ envia agora}
   {a:▎} {d:1}  rode os testes de novo>>{d:ao terminar}
   {a:▎} {d:2}  {m:e atualize o README}>>{d:no próximo passo}
` },
      { n: 'Lista simples', d: 'Itens como linhas apagadas acima do campo, sem barra nem título. A ordem é o número.', l: `
   {d:1}  {m:rode os testes de novo}>>{d:ao terminar}
   {d:2}  {m:e atualize o README}>>{d:no próximo passo}
   {d:2 na fila · shift+← edita}
` },
      { n: 'Contador', d: 'Só um contador junto do campo; a lista abre com shift+←.', l: `
   {d:2 na fila · próxima: "rode os testes de novo" · shift+← abre}
` },
    ],
  },
  {
    g: 'Cromo', id: 'hud', t: 'Linha de status (HUD)', onde: 'claude-home/bin/hud/calm-statusline.mjs:189',
    nota: 'A onda 1 pediu para não mexer nas barras sem decisão explícita; esta é a pergunta.',
    hoje: `
 {b:Fable 5.2} {d:· medium · pi-harness ⎇ main*} {r:│} {d:12m · $1.08}
 {d:ctx} {o:━}{r:━━━━━━━} {d:9%}
 {d:5h} {a:━}{r:━━━━━━━} {d:8% renova em 4h · semana} {a:━━}{r:━━━━━━} {d:22% renova em 4d}
`,
    v: [
      { n: 'Duas linhas em colunas', d: 'Os três medidores numa linha só, com rótulos por extenso e colunas alinhadas.', l: `
 {b:Fable 5.2} {d:medium · pi-harness ⎇ main*}>>{d:12m · $1.08}
 {d:contexto} {o:━}{r:━━━━━━━} {d:9%}    {d:5h} {a:━}{r:━━━━━━━} {d:8% · 4h}    {d:semana} {a:━━}{r:━━━━━━} {d:22% · 4d}
` },
      { n: 'Uma linha, sem barras', d: 'Só números, como a barra de status do Xcode. A cor aparece quando passa do limite.', muda: 'barras de ctx, 5h e semana mantidas (onda 1)', l: `
 {b:Fable 5.2} {d:medium · pi-harness ⎇ main*}>>{d:contexto} 9% {d:· 5h} 8% {d:· semana} 22% {d:· $1.08}
` },
      { n: 'Só o que importa agora', d: 'Modelo e pasta. Os medidores só aparecem acima de 70%, já com o aviso.', muda: 'barras de ctx, 5h e semana mantidas (onda 1)', l: `
 {d:Fable 5.2 · medium · pi-harness ⎇ main*}
 {d:(acima de 70%)}  {d:Fable 5.2 · medium · main*}>>{w:▲ semana 78% · renova em 4d}
` },
    ],
  },
  {
    g: 'Cromo', id: 'hud-detalhe', t: 'Painel de detalhe do HUD', onde: 'calm-statusline.mjs (level detalhe)',
    hoje: `
 {b:Fable 5.2} {d:· medium · pi-harness ⎇ main*} {r:│} {d:2h · $6.00}
 {d:Contexto}    {o:━}{r:━━━━━━━━━━━}   {d:9% 90k de 1.0M · compacta em 984k}
 {d:Sessão 5h}   {a:━}{r:━━━━━━━━━━━}   {d:8% renova em 4h}
 {d:Semana}      {a:━━━}{r:━━━━━━━━━}  {d:22% renova em 4d}
 {d:Cache}       {a:━━━━━━━━━━}{r:━━}  {d:84% lido do cache no último turno}
 {d:Tokens}      {d:entrada 12k · saída 3k no último turno}
 {d:Alterações}  {o:+142} {e:−38} {d:linhas}
`,
    v: [
      { n: 'Número primeiro', d: 'O número em destaque na frente da barra, alinhado à direita, como uma tabela do Monitor de Atividade.', l: `
 {d:Contexto}     9% {o:━}{r:━━━━━━━━━━━}  {d:90k de 1.0M · compacta em 984k}
 {d:Sessão 5h}    8% {a:━}{r:━━━━━━━━━━━}  {d:renova em 4h}
 {d:Semana}      22% {a:━━━}{r:━━━━━━━━━}  {d:renova em 4d}
 {d:Cache}       84% {a:━━━━━━━━━━}{r:━━}  {d:lido do cache}
 {d:Alterações}  {o:+142} {e:−38}
` },
      { n: 'Grupos com título', d: 'Dois grupos com título apagado (Limites, Sessão), sem barras nos itens que não são limite.', l: `
 {d:Limites}
   Contexto    {o:━}{r:━━━━━━━}   9%  {d:90k de 1.0M}
   Sessão 5h   {a:━}{r:━━━━━━━}   8%  {d:renova em 4h}
   Semana      {a:━━}{r:━━━━━━}  22%  {d:renova em 4d}
 {d:Sessão}
   2h · $6.00 · cache 84% · {o:+142} {e:−38} {d:linhas}
` },
    ],
  },
  {
    g: 'Cromo', id: 'rodape', t: 'Avisos fixos no rodapé', onde: 'footer-no-stats.ts:20, bypass-permissions, travar-modelos, diagnostico',
    nota: 'Hoje misturam emoji (🔒, ⚠) com glifos de uma cor.',
    hoje: `
 {e:⚠ bypass ligado}{d: · }{w:🔒 modelos travados: 2}{d: · }{e:✕} 2 {d:·} {w:▲} 1 {d:· pi-doctor: 2 pat… · alt+e}
`,
    v: [
      { n: 'Sem emoji', d: 'Os mesmos avisos com glifos do vocabulário do pi e texto mais curto.', l: `
 {e:▲ bypass ligado}{d: · }{w:▲ 2 modelos travados}{d: · }{e:✕ 2 erros}{d: · }{w:▲ 1 aviso}>>{d:alt+e abre}
` },
      { n: 'Cápsulas', d: 'Cada aviso numa cápsula neutra; só o texto leva cor.', l: `
 {k: }{ke:bypass ligado}{k: }  {k: }{kw:2 modelos travados}{k: }  {k: }{ke:2 erros}{k: · }{kw:1 aviso}{k: }>>{d:alt+e abre}
` },
      { n: 'Um contador', d: 'Uma linha só: o aviso mais grave e quantos outros existem.', l: `
 {e:▲ bypass ligado}{d: · mais 3 avisos · alt+e abre}
` },
    ],
  },
  {
    g: 'Cromo', id: 'plano', t: 'Seção do plano e das tarefas', onde: 'pi-code plan-mode/section.ts:322, table.ts:120',
    hoje: `
 {k: PLAN } {d:3/8 · 12m · $0.42 · 3/6 na tela ·} {w:1 bloqueado} {d:·} {e:1 falhou}
 {d:─~}
 {d:# estado      tarefa}>>{d:fim}
 {d:1} {o:✓ feito}     Escrever o teste>>{d:14:02 · 3m}
 {d:2} {cb:▸ fazendo}   {b:Implementar o parser}>>{d:…}
 {d:3} {w:‖ bloqueado} Atualizar os docs>>{d:—}
 {d:4} {d:○ a fazer}   Rodar o gate>>{d:—}
`,
    v: [
      { n: 'Tabela sem cabeçalho', d: 'Sai a linha de títulos e a régua; o resumo ganha uma barra de progresso.', l: `
 {b:Plano} {o:███}{r:╌╌╌╌╌} {d:3 de 8 · 12m · $0.42 ·} {w:1 bloqueado} {d:·} {e:1 falhou}
 {d:1} {o:✓ feito}     {d:Escrever o teste}>>{d:14:02 · 3m}
 {d:2} {a:▸ fazendo}   {b:Implementar o parser}>>{d:há 2m}
 {d:3} {w:‖ bloqueado} Atualizar os docs
 {d:4} {d:○ a fazer}   Rodar o gate
` },
      { n: 'Lista de lembretes', d: 'Como o app Lembretes: círculo vazio, meio e cheio. O feito fica apagado, o atual em negrito.', muda: 'estado com glifo e palavra (onda 4)', l: `
 {b:Plano} {d:3 de 8}>>{d:12m · $0.42}
 {o:●} {d:Escrever o teste}>>{d:14:02 · 3m}
 {a:◐} {b:Implementar o parser}>>{d:há 2m}
 {w:◌} Atualizar os docs {w:· bloqueado}
 {r:○} Rodar o gate
` },
      { n: 'Só a tarefa atual', d: 'Uma linha: progresso e o que está sendo feito. A lista inteira abre com "o".', l: `
 {b:Plano} {o:███}{r:╌╌╌╌╌} {d:3 de 8 ·} {a:▸} Implementar o parser {d:· há 2m}>>{d:o abre}
` },
    ],
  },
  {
    g: 'Cromo', id: 'titulo', t: 'Título da aba do terminal', onde: 'ui/terminal.ts:30',
    hoje: `
 {d:parado}       refactor-parser · pi-harness
 {d:trabalhando}  ● refactor-parser · pi-harness
 {d:terminou}     ✓ refactor-parser · pi-harness
`,
    v: [
      { n: 'Ordem do macOS', d: 'Documento, travessão, app: a pasta primeiro, a sessão depois, como as janelas do Finder e do Xcode.', l: `
 {d:parado}       pi-harness — refactor-parser
 {d:trabalhando}  ● pi-harness — refactor-parser
 {d:terminou}     ✓ pi-harness — refactor-parser
` },
      { n: 'Só o nome', d: 'O título nunca muda; o estado vai só pelo progresso da aba (OSC 9;4), onde o terminal suporta.', l: `
 {d:sempre}       refactor-parser
 {d:terminais sem OSC 9;4 (kitty abaixo de 0.47) ficam sem sinal na aba}
` },
    ],
  },
)
