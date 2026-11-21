// Onda 12 · diálogos, folhas e painéis.
window.ONDA12.push(
  {
    g: 'Diálogos', id: 'pergunta', t: 'Pergunta ao usuário', onde: 'pi-code question.ts:182-248',
    hoje: `
{a:─~}
 {m:?} {b:pergunta · Variante}>>{d:1/3 · escolha uma}
 Qual variante de exibição do limite devo aplicar?
@p  {ab:❯ 1}  Uma caixa só>>{c:★ recomendada}
    {d:2}  Erro com espera dentro
    {d:3}  Linha compacta
 {r:─── }{d:Uma caixa só}{r: ─~}
 {m:Âmbar na espera, verde ao retomar, cinza se cancelar.}
 {d:1-3 escolhe · ↑↓ move · s pula · r recomendada · ? ajuda · esc sai}
{a:─~}
`,
    v: [
      { n: 'Descrição junto da opção', d: 'A descrição da opção em foco aparece embaixo dela; some o painel de detalhe e sobram 3 teclas.', l: `
{r:── }{b:Variante}{r: ─~}{d: 1 de 3 }{r:──}
 Qual variante de exibição do limite devo aplicar?

@l  {a:❯} {b:1  Uma caixa só}>>{a:recomendada}
@l       {m:Âmbar na espera, verde ao retomar, cinza se cancelar.}
    {d:2}  Erro com espera dentro
    {d:3}  Linha compacta

 ⏎ {d:escolhe}    s {d:pula}    esc {d:sai}>>? {d:mais teclas}
{r:─~}
` },
      { n: 'Folha de alerta', d: 'Cartão arredondado com a pergunta em negrito no topo e a opção padrão marcada como botão.', l: `
{r:╭─~}{r:╮}
{r:│} {b:Qual variante de exibição do limite devo aplicar?}>>{d:1 de 3} {r:│}
{r:│}>>{r:│}
{r:│}  {v: 1  Uma caixa só } {d:recomendada · âmbar, verde, cinza}>>{r:│}
{r:│}  {d: 2}  Erro com espera dentro>>{r:│}
{r:│}  {d: 3}  Linha compacta>>{r:│}
{r:│}>>{r:│}
{r:╰─ }{d:⏎ escolhe · s pula · esc sai}{r: ─~}{r:╯}
` },
      { n: 'Em linha', d: 'Sem folha: a pergunta entra na conversa e as opções viram teclas numeradas acima do campo.', l: `
   {b:Qual variante de exibição do limite devo aplicar?}>>{d:1 de 3}
   {k: 1 } Uma caixa só {a:recomendada}   {k: 2 } Erro com espera   {k: 3 } Linha compacta
{r:─~}
 {a:❯} {d:ou escreva a sua resposta}
{r:─~}
` },
    ],
  },
  {
    g: 'Diálogos', id: 'confirmar', t: 'Confirmação e permissão', onde: 'folha/confirm.ts',
    hoje: `
 {b:Permitir este comando?}
 {m:rm -r build/}
@l  {a:❯} Não permitir
    Permitir
`,
    v: [
      { n: 'Com consequência', d: 'O título diz o que vai acontecer e a opção perigosa repete o verbo, como pede a Apple.', l: `
{r:── }{b:Apagar a pasta build/?}{r: ─~}
 {m:rm -r build/ · 214 arquivos, 38 MB · não dá para desfazer}

@l  {a:❯} {b:Manter a pasta}
    Apagar a pasta

 ⏎ {d:confirma}    esc {d:mantém}
{r:─~}
` },
      { n: 'Botões lado a lado', d: 'Duas ações na mesma linha, a segura em destaque; ←→ troca, como num alerta do macOS.', l: `
{r:╭─~}{r:╮}
{r:│} {b:Apagar a pasta build/?}>>{r:│}
{r:│} {m:rm -r build/ · não dá para desfazer}>>{r:│}
{r:│}>>{r:│}
{r:│}>>{k: Apagar }   {v: Manter } {r:│}
{r:╰─~}{r:╯}
` },
      { n: 'Uma linha', d: 'Sem folha: a pergunta ocupa a linha acima do campo, com duas teclas.', l: `
   {w:▲} {b:Apagar a pasta build/?} {d:rm -r build/}>>{k: esc } {d:mantém}   {k: a } {d:apaga}
` },
    ],
  },
  {
    g: 'Diálogos', id: 'comandos', t: 'Paleta de comandos e menu do @', onde: 'comandos/paleta.ts:44; menu nativo do pi',
    hoje: `
 {a:→} {ab:/new}      {d:Recente · Começa uma sessão nova, sem turno do modelo}
   /model    {d:Recente · Troca o modelo desta sessão}
   {d:Conversa}
   /compact  {d:Conversa · Resume a conversa para liberar contexto}
   /resume   {d:Sessão · Abre uma sessão anterior}
`,
    hojeNota: 'O menu é do core; hoje só mudamos os textos. Mock aproximado.',
    v: [
      { n: 'Grupos e teclas', d: 'Títulos de grupo apagados, descrição curta e a tecla do comando alinhada à direita.', l: `
   {d:Recentes}
@l  {a:❯} {b:/new}       {m:Sessão nova}>>{d:ctrl+n}
     /model     {d:Trocar de modelo}>>{d:alt+p}
   {d:Conversa}
     /compact   {d:Resumir para liberar contexto}
     /resume    {d:Abrir uma sessão anterior}
` },
      { n: 'Estilo Spotlight', d: 'Cartão arredondado com campo de busca no topo e resultado em destaque invertido.', l: `
{r:╭─~}{r:╮}
{r:│} {d:⌕} /mo{d:▏}>>{d:2 de 41} {r:│}
{r:├─~}{r:┤}
{r:│} {v: /model     Trocar de modelo }>>{d:alt+p} {r:│}
{r:│}  /movimento  {d:Animações: normal, reduzido, desligado}>>{r:│}
{r:╰─~}{r:╯}
` },
      { n: 'Só nomes', d: 'Uma coluna de nomes; a descrição aparece só para o item em foco, numa linha embaixo.', l: `
@l  {a:❯} {b:/model}
     /movimento
     /memory
   {d:Trocar de modelo · alt+p}
` },
    ],
  },
  {
    g: 'Diálogos', id: 'historico', t: 'Histórico de prompts (ctrl+r)', onde: 'ui/history.ts:226',
    hoje: `
{r:── }{b:Histórico}{r: ─~}{ab: ● sessão}   {d:projeto   todas }{r:──}
 {v: }{d:Buscar nos prompts}>>{d:1 de 8}
@l  {a:❯} refatore o {ab:parser} para aceitar comentários
    rode os testes do {ab:parser} ⏎ e atualize o README
 {d:↑↓ escolher · ⏎ usar · tab escopo · esc fechar}
{r:─~}
`,
    v: [
      { n: 'Com data', d: 'Cada prompt ganha a idade à direita e o escopo vira um controle segmentado.', l: `
{r:── }{b:Histórico}{r: ─~} {k: sessão } {d:projeto   todas }{r:──}
 {d:⌕ Buscar nos prompts}>>{d:8}
@l  {a:❯} refatore o {b:parser} para aceitar comentários>>{d:há 5 min}
    rode os testes do {b:parser} e atualize o README>>{d:ontem}
 ⏎ {d:usar}    tab {d:escopo}    esc {d:fechar}
{r:─~}
` },
      { n: 'Busca em linha', d: 'Como o ctrl+r do shell: sem folha, o campo vira busca e mostra um resultado por vez.', l: `
{r:─~}
 {d:⌕ parser ·} refatore o {b:parser} para aceitar comentários
{r:── }{d:1 de 8 · ctrl+r próximo · ⏎ usa · esc sai }{r:─~}
` },
      { n: 'Lista pura', d: 'Sem abas de escopo: busca tudo, os desta sessão primeiro. Uma decisão a menos.', l: `
{r:── }{b:Histórico}{r: ─~}
 {d:⌕ Buscar}
@l  {a:❯} refatore o {b:parser} para aceitar comentários
    rode os testes do {b:parser} e atualize o README>>{d:outra sessão}
{r:─~}
` },
    ],
  },
  {
    g: 'Diálogos', id: 'atalhos', t: 'Painel de atalhos (?)', onde: 'comandos/painel.ts:44',
    hoje: `
{r:── }{b:Atalhos}{r: ─~}{d: qualquer tecla fecha }{r:──}
 {d:Essenciais}              {d:Ver}                      {d:Sessão}
 Enviar         {b:enter}    Expandir tools  {b:ctrl+o}   Copiar      {b:ctrl+y}
 Nova linha     {b:\\+enter}  Raciocínio      {b:ctrl+t}   Rascunho    {b:ctrl+s}
 Interromper    {b:esc}      Trocar modelo   {b:alt+p}    Sair        {b:ctrl+d}
 {d:Todos os atalhos e como mudar: /atalhos}
{r:─~}
`,
    v: [
      { n: 'Tecla primeiro', d: 'A tecla vem antes da ação e em cápsula: o olho procura a tecla, não o nome.', l: `
{r:── }{b:Atalhos}{r: ─~}
 {d:Essenciais}              {d:Ver}                      {d:Sessão}
 {k: ⏎ }   {m:Enviar}          {k: ⌃O }  {m:Abrir saída}       {k: ⌃Y }  {m:Copiar}
 {k: esc } {m:Interromper}     {k: ⌃T }  {m:Raciocínio}        {k: ⌃S }  {m:Rascunho}
 {k: ⌃R }  {m:Histórico}       {k: ⌥P }  {m:Trocar modelo}     {k: ⌃D }  {m:Sair}
 {d:/atalhos mostra todos e deixa mudar}
{r:─~}
` },
      { n: 'Símbolos do Mac', d: 'Teclas com os símbolos do macOS (⌃ ⌥ ⇧ ⏎), alinhadas à direita como num menu.', l: `
{r:╭─ }{b:Atalhos}{r: ─~}{r:╮}
{r:│} Enviar>>⏎ {r:│}
{r:│} Interromper>>esc {r:│}
{r:│} Abrir saída da ferramenta>>⌃O {r:│}
{r:│} Trocar modelo>>⌥P {r:│}
{r:╰─ }{d:/atalhos mostra todos}{r: ─~}{r:╯}
` },
      { n: 'Seis teclas', d: 'Só as seis que mais se usam, numa linha; o resto fica em /atalhos.', l: `
 ⏎ {d:envia}   esc {d:interrompe}   ⌃O {d:abre saída}  ⌃R {d:histórico}  ⌃S {d:rascunho}  / {d:comandos}
` },
    ],
  },
  {
    g: 'Painéis', id: 'painel', t: 'Visão geral (/painel)', onde: 'folha/sheet.ts:118, painel.ts:62',
    hoje: `
{r:── }{b:Visão geral}{r: ─~}{d: pi-harness }{r:──}
 {d:Modelo}       Fable 5.2 · raciocínio medium>>{d:/model}
 {d:Contexto}     {a:━━}{r:──────────────────}  90k de 1M · 9%>>{d:/context}
 {d:Permissões}   pergunta antes de agir>>{d:/bypass}
 {d:Confiança}    {o:✓} projeto confiável>>{d:/trust}
 {d:Gerenciar}
@l  {a:❯} Memória>>{d:/memory}
    MCP>>{d:/mcp}
 {d:↑↓ escolher · ⏎ levar ao campo · esc fechar}
{r:─~}
`,
    v: [
      { n: 'Tudo navegável', d: 'Todas as linhas são selecionáveis e a seta › mostra que abrem outra folha.', l: `
{r:── }{b:Visão geral}{r: ─~}{d: pi-harness }{r:──}
@l  {a:❯} {d:Modelo}       {b:Fable 5.2 · medium}>>{d:›}
    {d:Contexto}     9% {d:· 90k de 1M}>>{d:›}
    {d:Permissões}   pergunta antes de agir>>{d:›}
    {d:Memória}      automática ligada>>{d:›}
    {d:MCP}          4 servidores>>{d:›}
 ⏎ {d:abre}    esc {d:fecha}
{r:─~}
` },
      { n: 'Ajustes do macOS', d: 'Grupos em cartões arredondados, valor à direita, como os Ajustes do Sistema.', l: `
 {b:pi-harness}
{r:╭─~}{r:╮}
{r:│} Modelo>>{d:Fable 5.2 · medium ›} {r:│}
{r:│} Contexto>>{d:9% ›} {r:│}
{r:│} Permissões>>{d:pergunta antes de agir ›} {r:│}
{r:╰─~}{r:╯}
{r:╭─~}{r:╮}
{r:│} Memória>>{d:ligada ›} {r:│}
{r:│} MCP>>{d:4 servidores ›} {r:│}
{r:╰─~}{r:╯}
` },
      { n: 'Só exceções', d: 'Mostra só o que foge do normal; o resto são os comandos de sempre.', l: `
{r:── }{b:Visão geral}{r: ─~}
 {w:▲} {b:Bypass ligado} {d:· o pi age sem perguntar}>>{d:/bypass}
 {d:Tudo o mais no padrão · Fable 5.2 medium · contexto 9%}
{r:─~}
` },
    ],
  },
  {
    g: 'Painéis', id: 'avisos', t: 'Painel de avisos (/avisos)', onde: 'avisos/painel.ts:60-100',
    hoje: `
{r:── }{b:Avisos}{r: ─~}{ab: ● recentes}   {d:ajustes }{r:──}
 {d:14:02}  {e:✕}  O provedor está fora do ar
 {d:13:40}  {w:▲}  Contexto compactado sozinho
 {d:13:12}  {o:✓}  Terminou · 2m 10s
 {d:tab ajustes · esc fechar}
{r:─~}
`,
    v: [
      { n: 'Agrupado por hora', d: 'Grupos "agora há pouco" e "mais cedo"; o estado vira palavra colorida em vez de glifo.', l: `
{r:── }{b:Avisos}{r: ─~} {k: recentes } {d:ajustes }{r:──}
 {d:Agora há pouco}
   {e:erro}      O provedor está fora do ar>>{d:14:02}
 {d:Mais cedo}
   {w:atenção}   Contexto compactado sozinho>>{d:13:40}
   {d:terminou   2m 10s}>>{d:13:12}
{r:─~}
` },
      { n: 'Central de notificações', d: 'Cada aviso é um cartão curto de duas linhas, como na Central de Notificações.', l: `
@n   {b:O provedor está fora do ar}>>{d:14:02}
@n   {m:Parei depois de 10 tentativas · ↑ tenta de novo}

@n   {b:Contexto compactado sozinho}>>{d:13:40}
@n   {m:252 mil → 18 mil tokens}
` },
      { n: 'Só o que pede ação', d: 'Erros e avisos; os "terminou" não entram na lista.', l: `
{r:── }{b:Avisos}{r: ─~}{d: 2 pedem atenção }{r:──}
   {e:✕} O provedor está fora do ar>>{d:14:02}
   {w:▲} Contexto compactado sozinho>>{d:13:40}
{r:─~}
` },
    ],
  },
  {
    g: 'Painéis', id: 'diagnostico', t: 'Diagnóstico (/diagnostico)', onde: 'diagnostico/painel.ts:407-465',
    hoje: `
{a:╭─ }{ab:Diagnóstico}{a: ─~}{e: ✕ 2 erros}{d: · }{w:▲ 1 aviso }{a:─╮}
{a:│} {e:✕ 2 erros}{d: · }{w:▲ 1 aviso}{d: · }{o:✓ 1 ok}>>{a:│}
{a:│} {e:✕} pi-doctor: 2 patches não revertem na árvore>>{a:│}
{a:│} {d:↑↓ item · enter json bruto · c copiar · e evento · t info · s silenciar}>>{a:│}
{a:╰─ }{d:tab visão · esc fechar}{a: ─~}{a:╯}
`,
    v: [
      { n: 'Folha padrão', d: 'Passa a usar a mesma régua das outras folhas; a contagem aparece uma vez só.', l: `
{r:── }{b:Diagnóstico}{r: ─~} {k: problemas } {d:eventos   saúde }{r:──}
@l  {a:❯} {e:erro}     pi-doctor: 2 patches não revertem na árvore>>{d:14:02}
    {e:erro}     MCP exa: 402 sem créditos>>{d:13:55}
    {w:atenção}  3 componentes desatualizados>>{d:09:10}
 ⏎ {d:detalhe}    c {d:copia}    tab {d:visão}    esc {d:fecha}>>? {d:mais}
{r:─~}
` },
      { n: 'Lista e detalhe', d: 'Duas colunas como o Console do macOS: problemas à esquerda, detalhe do escolhido à direita.', l: `
{r:╭─ }{b:Diagnóstico}{r: ─~}{d: 2 erros · 1 aviso }{r:─╮}
{r:│}{v: erro   pi-doctor      }{r:│} {b:2 patches não revertem}>>{r:│}
{r:│} erro   MCP exa        {r:│} {m:subagent-panel, plan-section}>>{r:│}
{r:│} {d:aviso  componentes}    {r:│} {d:/doctor verifica de novo}>>{r:│}
{r:╰─ }{d:⏎ json · c copia · esc fecha}{r: ─~}{r:╯}
` },
      { n: 'Resumo em texto', d: 'Uma frase por problema e o comando que resolve; sem abas.', l: `
{r:── }{b:Diagnóstico}{r: ─~}
 {e:●} 2 patches do pi-doctor não revertem. {d:/doctor verifica de novo}
 {e:●} O MCP exa está sem créditos. {d:outros provedores assumem}
 {w:●} 3 componentes desatualizados. {d:/upgrade atualiza}
{r:─~}
` },
    ],
  },
  {
    g: 'Painéis', id: 'diff', t: 'Revisão de mudanças (/diff)', onde: 'ui/diff.ts:129',
    hoje: `
 {ab:Mudanças: 3 arquivos}
 {b:› src/a.ts}  {o:+12} {e:−3}
   src/novo.ts {d:(novo)}  {o:+40} {e:−0}
   {d:img.png  binário}
 {d:↑↓ navegar · Enter abrir · Esc fechar}
`,
    v: [
      { n: 'Folha padrão', d: 'Mesma régua, mesma seta e mesmo fundo de seleção das outras folhas; contagem alinhada.', l: `
{r:── }{b:Mudanças}{r: ─~}{d: 3 arquivos · }{o:+52}{d: }{e:−3 }{r:──}
@l  {a:❯} src/a.ts>>{o:+12} {e: −3}
    src/novo.ts {d:novo}>>{o:+40} {e: −0}
    {d:img.png · binário}
 ⏎ {d:abre}    c {d:comenta}    esc {d:fecha}
{r:─~}
` },
      { n: 'Lista e diff', d: 'Duas colunas como o Xcode: arquivos à esquerda, diff do escolhido à direita.', l: `
{r:╭─ }{b:Mudanças}{r: ─~}{d: 3 arquivos }{r:─╮}
{r:│}{v: M src/a.ts    +12 −3 }{r:│} {d:12} {e:−}  {dx:const a = 1}>>{r:│}
{r:│} A src/novo.ts +40    {r:│} {d:12} {o:+}  const a = 2>>{r:│}
{r:│} {d:  img.png}            {r:│} {d:13} {o:+}  const b = a>>{r:│}
{r:╰─ }{d:⏎ abre · c comenta · esc fecha}{r: ─~}{r:╯}
` },
      { n: 'Árvore por pasta', d: 'Arquivos agrupados por pasta, com a soma por grupo.', l: `
{r:── }{b:Mudanças}{r: ─~}
   {d:src/}>>{o:+52} {e:−3}
@l  {a:❯}   a.ts>>{o:+12} {e:−3}
        novo.ts {d:novo}>>{o:+40}
   {d:img.png · binário}
{r:─~}
` },
    ],
  },
  {
    g: 'Painéis', id: 'btw', t: 'Pergunta paralela (/btw)', onde: 'ui/btw.ts:163',
    hoje: `
{a:━~}
 {ab:/btw o que é OSC 8?}

 É a sequência de escape que cria links clicáveis no terminal.

 {d:Enter ou Esc para fechar}
{a:━~}
`,
    v: [
      { n: 'Folha padrão', d: 'Régua cinza e título como as outras folhas; a pergunta fica apagada, a resposta em destaque.', l: `
{r:── }{b:Pergunta rápida}{r: ─~}{d: fora da conversa }{r:──}
 {d:o que é OSC 8?}

 É a sequência de escape que cria links clicáveis no terminal.

 esc {d:fecha}    c {d:copia}    ⏎ {d:leva para a conversa}
{r:─~}
` },
      { n: 'Balão', d: 'Um cartão arredondado pequeno ancorado acima do campo, como um popover.', l: `
{r:╭─ }{d:o que é OSC 8?}{r: ─~}{r:╮}
{r:│} É a sequência de escape que cria links clicáveis no terminal.>>{r:│}
{r:╰─ }{d:esc fecha}{r: ─~}{r:╯}
` },
    ],
  },
  {
    g: 'Painéis', id: 'agentes', t: 'Painel de agentes', onde: 'pi-code subagent/fleet-ui; patches subagent-panel',
    hojeNota: 'Textos em inglês e separador "|", diferentes do resto. Mock aproximado a partir dos testes.',
    hoje: `
 {c:●} {b:main}  {d:thinking… · 2 running · ↓ to manage}>>{d:1m 42s | 163.0k tok |  $8.79}
 {d:├─} {c:○} gate-runner{d:  running the gate}>>{d:  40s |  12.0k tok |  $0.21}
 {d:└─} {c:○} test-author{d:  writing tests}>>{d:1m 02s |  30.1k tok |  $0.44}
`,
    v: [
      { n: 'Em português', d: 'Mesma árvore, traduzida, com ponto no lugar da barra e colunas alinhadas.', l: `
 {a:●} {b:principal}  {d:pensando · 2 agentes rodando}>>{d:1m 42s   163k   $8.79}
 {r:├─} gate-runner  {d:rodando o gate}>>{d:   40s    12k   $0.21}
 {r:└─} test-author  {d:escrevendo testes}>>{d:1m 02s    30k   $0.44}
 {d:↓ gerencia os agentes}
` },
      { n: 'Barra lateral', d: 'Lista simples como uma barra lateral: nome e atividade; tempo e custo só no escolhido.', l: `
 {d:Agentes}
@l  {a:❯} {b:gate-runner}  {m:rodando o gate}>>{d:40s · 12k · $0.21}
    test-author  {d:escrevendo testes}
 ⏎ {d:abre}    x {d:para}    esc {d:volta}
` },
      { n: 'Um contador', d: 'Uma linha: quantos rodam e quanto custou. A árvore abre com a seta para baixo.', l: `
 {a:●} {d:2 agentes rodando · 1m 42s · $0.65}>>{d:↓ abre}
` },
    ],
  },
  {
    g: 'Painéis', id: 'runs', t: 'Painel de runs', onde: 'pi-code run/view.ts:80-141',
    hoje: `
 {c:⠹} {v:gw-lean} {d:00:40}
   {d:│ Compiling gateway v0.4.1}
 {o:✓} testes {d:02:10}
 {d:↑↓ mover · ⏎ tail · f seguir · k parar · r repetir · w agente espera ·}
 {d:x limpar concluídos · / filtro · esc voltar}
`,
    v: [
      { n: 'Folha padrão', d: 'Seleção com seta e fundo, estado por palavra, quatro teclas e o resto atrás de "?".', l: `
{r:── }{b:Em segundo plano}{r: ─~}{d: 1 rodando · 1 terminou }{r:──}
@l  {a:❯} {b:gw-lean}  {a:rodando}  {d:Compiling gateway v0.4.1}>>{d:40s}
    testes   {d:terminou}>>{d:2m 10s}
 ⏎ {d:saída}    k {d:para}    r {d:repete}    esc {d:volta}>>? {d:mais}
{r:─~}
` },
      { n: 'Monitor de Atividade', d: 'Tabela com cabeçalho apagado: nome, estado, tempo, última linha.', l: `
 {d:Nome       Estado     Tempo    Última linha}
@l  {b:gw-lean}    {a:rodando}    40s      {m:Compiling gateway v0.4.1}
  testes     {d:terminou   2m 10s   ℹ pass 78}
 ⏎ {d:saída}    k {d:para}    esc {d:volta}
` },
    ],
  },
  {
    g: 'Painéis', id: 'seletores', t: 'Seletores de modelo e de sessão', onde: 'nativos do pi (/model, /resume)',
    hojeNota: 'São do core e não foram redesenhados (onda 4). Mock aproximado; mudar exige patch.',
    hoje: `
 {a:→} {ab:claude-fable-5-2}  {d:anthropic}  {o:✓}
   claude-sonnet-5-5  {d:anthropic}
   gpt-6.2            {d:openai}
 {d:Type to filter · Enter to select · Esc to cancel}
`,
    v: [
      { n: 'Folha padrão', d: 'Vira uma folha como as outras: em português, com recentes no topo e "em uso" por palavra.', l: `
{r:── }{b:Modelo}{r: ─~}{d: 3 de 41 }{r:──}
 {d:Recentes}
@l  {a:❯} {b:Fable 5.2}    {d:anthropic}>>{o:em uso}
    Sonnet 5.5   {d:anthropic}
 {d:Todos}
    GPT 6.2      {d:openai}
 ⏎ {d:usa}    tab {d:esforço}    esc {d:fecha}
{r:─~}
` },
      { n: 'Menu suspenso', d: 'Um menu pequeno perto do campo, com a marca ✓ à esquerda como nos menus do macOS.', l: `
{r:╭─~}{r:╮}
{r:│} {a:✓} {b:Fable 5.2}>>{d:medium} {r:│}
{r:│}   Sonnet 5.5>>{d:⌥1} {r:│}
{r:│}   GPT 6.2>>{d:⌥2} {r:│}
{r:├─~}{r:┤}
{r:│}   {d:Mais modelos…}>>{r:│}
{r:╰─~}{r:╯}
` },
      { n: 'Busca direta', d: 'Sem lista: digite parte do nome e o melhor resultado aparece no próprio campo.', l: `
{r:─~}
 {d:modelo ⌕} son{d:▏net 5.5 · anthropic}
{r:── }{d:⏎ usa · tab próximo · esc sai }{r:─~}
` },
    ],
  },
  {
    g: 'Painéis', id: 'todos', t: 'Lista de tarefas (/todos)', onde: 'pi-code todo.ts:290',
    hojeNota: 'Mistura inglês ("completed", "Press Escape to close") com os estados em português.',
    hoje: `
{r:─── }{b:Todos}{r: ─~}
   {m:1/3 completed}
   {o:concluída}    {a:#1} Escrever o teste
   {c:em andamento} {a:#2} Implementar o parser
   {d:pendente}     {a:#3} Atualizar os docs
   {d:Press Escape to close}
`,
    v: [
      { n: 'Traduzida e alinhada', d: 'Tudo em português, com a barra de progresso no título e o estado numa coluna.', l: `
{r:── }{b:Tarefas}{r: ─~} {o:██}{r:╌╌╌╌}{d: 1 de 3 }{r:──}
   {d:feita        Escrever o teste}
   {a:fazendo}      {b:Implementar o parser}
   {d:a fazer}      Atualizar os docs
 esc {d:fecha}
{r:─~}
` },
      { n: 'Lembretes', d: 'Círculos que enchem; o feito fica apagado e riscado.', muda: 'estado com glifo e palavra (onda 4)', l: `
 {b:Tarefas} {d:1 de 3}
 {o:●} {dx:Escrever o teste}
 {a:◐} {b:Implementar o parser}
 {r:○} Atualizar os docs
` },
      { n: 'Igual à seção do plano', d: 'A folha deixa de existir: /todos só leva o foco para a seção do plano.', l: `
 {d:(sem folha própria; usa o desenho escolhido em "Seção do plano e das tarefas")}
` },
    ],
  },
)
