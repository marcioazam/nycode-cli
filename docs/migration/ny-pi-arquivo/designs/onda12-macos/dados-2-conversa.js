// Onda 12 · conversa: mensagens, linha de trabalho e chamadas de ferramenta.
window.ONDA12.push(
  {
    g: 'Conversa', id: 'usuario', t: 'Mensagem do usuário', onde: 'ui-visual/icons.ts:191 (marcaUsuario)',
    hoje: `
@u
@u  {a:❯} refatore o parser para aceitar comentários>>{d:14:32}
@u
`,
    v: [
      { n: 'Faixa fina', d: 'A mesma faixa de fundo, sem as linhas vazias em cima e embaixo.', l: `
@u  {a:❯} refatore o parser para aceitar comentários>>{d:14:32}
` },
      { n: 'Sem fundo, em negrito', d: 'A mensagem é o título do turno: negrito, sem fundo, com a hora apagada à direita.', muda: 'fundo azulado da mensagem do usuário (onda 7)', l: `

 {a:❯} {b:refatore o parser para aceitar comentários}>>{d:14:32}

` },
      { n: 'Barra lateral', d: 'Uma barra azul à esquerda marca o que é seu; o texto fica na cor normal.', muda: 'fundo azulado da mensagem do usuário (onda 7)', l: `
 {a:▎} refatore o parser para aceitar comentários>>{d:14:32}
` },
    ],
  },
  {
    g: 'Conversa', id: 'assistente', t: 'Resposta do assistente', onde: 'Markdown do pi; cores mdHeading, mdCode, mdLink',
    hoje: `
 {b:## Mudanças}

 {d:-} O parser aceita {p:# comentário} no fim da linha.
 {d:-} Veja {au:src/parser.ts}{d: e a issue }{au:#123}{d:.}

 Rodei os testes: {b:12 passaram}.
`,
    v: [
      { n: 'Título sem cerquilha', d: 'O título perde o "##" e o código em linha troca o roxo por uma cápsula neutra.', l: `
 {b:Mudanças}

 {d:•} O parser aceita {k: # comentário } no fim da linha.
 {d:•} Veja {au:src/parser.ts} e a issue {au:#123}.

 Rodei os testes: {b:12 passaram}.
` },
      { n: 'Recuo de leitura', d: 'O texto do assistente recua 2 colunas a mais que o seu: a margem diz quem fala, sem cor.', l: `
   {b:Mudanças}

   {d:–} O parser aceita {m:# comentário} no fim da linha.
   {d:–} Veja {a:src/parser.ts} e a issue {a:#123}.

   Rodei os testes: {b:12 passaram}.
` },
      { n: 'Títulos em caixa baixa apagada', d: 'Títulos de seção pequenos e apagados, como os cabeçalhos de grupo dos Ajustes do macOS.', l: `
 {d:Mudanças}
 O parser aceita {m:# comentário} no fim da linha.
 Veja {au:src/parser.ts} e a issue {au:#123}.

 Rodei os testes: {b:12 passaram}.
` },
    ],
  },
  {
    g: 'Conversa', id: 'raciocinio', t: 'Raciocínio', onde: 'ui-visual/working.ts:172; cores thinking*',
    hoje: `
 {a:◇} {d:raciocínio · clique abre}
 {d:(aberto)}
 {di:O parser quebra na linha 40 porque o token de comentário}
 {di:não entra na tabela. Vou conferir o lexer antes.}
`,
    v: [
      { n: 'Com duração', d: 'A linha fechada diz quanto durou; aberta, o texto vem sob uma barra fina.', l: `
 {d:◇ pensou por 8s · ctrl+t abre}
 {d:(aberto)}
 {r:│} {d:O parser quebra na linha 40 porque o token de comentário}
 {r:│} {d:não entra na tabela. Vou conferir o lexer antes.}
` },
      { n: 'Primeira frase', d: 'Fechado mostra a primeira frase apagada, como a prévia de uma mensagem no Mail.', l: `
 {d:Pensou 8s ·} {di:O parser quebra na linha 40 porque o token de…}
` },
      { n: 'Invisível', d: 'Nada na conversa: o raciocínio só existe na linha de trabalho e na transcrição (ctrl+o).', l: `
 {d:(nada desenhado; a linha de trabalho mostra "pensando · 8s")}
` },
    ],
  },
  {
    g: 'Conversa', id: 'trabalho', t: 'Linha de trabalho', onde: 'ui-visual/working.ts:125',
    hoje: `
 {a:⠹} {c:pensando · 4s · esc interrompe}
 {a:⠹} {c:bash · npm test · 14s · ↓ 1,2k · esc interrompe}
 {d:dica: ctrl+o abre a saída da tool}
 {w:⠹ sem resposta há 12s}{c: · 12s · ↓  130 · esc interrompe}
`,
    v: [
      { n: 'Verbo em destaque', d: 'Só o verbo leva cor; tempo, tokens e a tecla ficam apagados e à direita.', l: `
 {a:⠹} {a:pensando} {d:4s}>>{d:esc interrompe}
 {a:⠹} {a:bash} {d:npm test · 14s · ↓ 1,2k}>>{d:esc interrompe}
 {w:⠹} {w:sem resposta há 12s} {d:↓ 130}>>{d:esc interrompe}
` },
      { n: 'Indicador sem rótulo', d: 'Como o macOS: o indicador gira sozinho, com o tempo. O que roda já aparece na chamada da ferramenta.', muda: 'dica rotativa na espera (onda 10, P09)', l: `
 {d:⠹ 4s}
 {d:⠹ 14s · ↓ 1,2k}
 {w:⠹ 12s sem resposta} {d:· esc interrompe}
` },
      { n: 'Dentro do campo', d: 'A linha some: o estado aparece na borda de baixo do campo de entrada, onde o olho já está.', l: `
{r:─~}
 {a:❯} {d:Pergunte qualquer coisa}
{r:── }{a:⠹ bash}{d: · npm test · 14s }{r:─~}{d: esc interrompe }{r:──}
` },
    ],
  },
  {
    g: 'Conversa', id: 'tool-linha', t: 'Ferramenta de uma linha (read, grep, ls, write)', onde: 'ui-visual/tools.ts:100',
    hoje: `
@s   {m:▤} {b:read} {d:·} {o:concluído} {d:·} {m:src/a.ts} {d::10-60 · 51 linhas}>>{k: 14:32 }
@s   {m:⌕} {b:grep} {d:·} {o:concluído} {d:·} {m:foo} {d:em src · 12 resultados}>>{k: 14:32 }
@p   {m:▤} {b:read} {d:·} {c:executando} {d:·} {m:src/b.ts}
`,
    v: [
      { n: 'Sem "concluído"', d: 'Sucesso é o normal e não se anuncia; a palavra de estado só aparece em executando e erro.', muda: 'estado por nome em toda chamada (onda 9)', l: `
@s   {m:▤} {b:read} {m:src/a.ts} {d::10-60 · 51 linhas}>>{d:14:32}
@s   {m:⌕} {b:grep} {m:foo} {d:em src · 12 resultados}>>{d:14:32}
@p   {m:▤} {b:read} {m:src/b.ts} {d:·} {a:executando}
` },
      { n: 'Plano, em colunas', d: 'Sem fundo e sem ícone: nome numa coluna, alvo na outra, hora à direita. Parece uma lista do Finder.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {b:read}   src/a.ts {d::10-60 · 51 linhas}>>{d:14:32}
   {b:grep}   foo {d:em src · 12 resultados}>>{d:14:32}
   {b:read}   src/b.ts {a:executando}
` },
      { n: 'Agrupadas', d: 'Leituras e buscas seguidas viram uma linha de atividade que abre com ctrl+o, como no opencode 2.3.', muda: 'uma linha por chamada (onda 3)', l: `
   {d:leu 2 arquivos e buscou 1 vez · 0,4s}>>{d:ctrl+o abre · 14:32}
   {d:lendo} src/b.ts
` },
    ],
  },
  {
    g: 'Conversa', id: 'bash', t: 'bash com saída', onde: 'ui-visual/tools.ts:209',
    hoje: `
@s   {m:$} {b:bash} {d:·} {o:concluído} {d:· 400 linhas · 3.2s}>>{k: }{ka:ctrl+o}{kd: abre }  {k: 14:32 }
@s     {d:│} {m:$} npm test
@s     {d:│ ⋯ 395 linhas acima · log completo: /tmp/pi-bash-clamp/call_0.log}
@s     {d:│} {m:ℹ tests 78}
@s     {d:│} {m:ℹ pass 78}
`,
    v: [
      { n: 'Comando no título', d: 'O comando sobe para o título e a saída perde a barra; uma linha a menos por chamada.', l: `
@s   {m:$} {b:npm test} {d:· 400 linhas · 3.2s}>>{d:ctrl+o abre · 14:32}
@s     {d:⋯ 395 linhas acima}
@s     {m:ℹ tests 78}
@s     {m:ℹ pass 78}
` },
      { n: 'Bloco do Warp', d: 'Sem fundo: comando em negrito, saída recuada e apagada, um fio cinza separa da próxima.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {b:$ npm test}>>{d:3.2s · 14:32}
     {d:⋯ 395 linhas acima · ctrl+o abre}
     {m:ℹ tests 78}
     {m:ℹ pass 78}
 {r:─~}
` },
      { n: 'Só o resultado', d: 'Fechado mostra uma linha com a última linha da saída; erro abre sozinho.', l: `
   {b:$ npm test} {d:· ℹ pass 78 · 400 linhas · 3.2s}>>{d:ctrl+o abre · 14:32}
` },
    ],
  },
  {
    g: 'Conversa', id: 'edit', t: 'edit com diff', onde: 'ui-visual/tools.ts:195, diff.ts:199',
    hoje: `
@n   {m:✎} {b:a.ts}  {d:src/x/}  {d:·}  {ob:+2} {eb:−1}  {o:━━━}{e:━━}  {o:concluído} {d:· 3.2s}>>{k: }{ka:ctrl+o}{kd: fecha }  {k: 14:32 }
@n   {d:─~}
@e    {e:12 −}  const a = 1
@s    {o:12 +}  const a = 2
@s    {o:13 +}  const b = a
@n    {d:14}    return a
`,
    v: [
      { n: 'Título limpo', d: 'Sai a barra de proporção e a régua; +2 −1 já diz o tamanho da mudança.', l: `
@n   {m:✎} {b:a.ts} {d:src/x/ ·} {o:+2} {e:−1}>>{d:ctrl+o fecha · 14:32}
@e    {e:12 −}  const a = 1
@s    {o:12 +}  const a = 2
@s    {o:13 +}  const b = a
@n    {d:14}    return a
` },
      { n: 'Só a margem colorida', d: 'Como o Xcode: a linha mudada tem uma barra colorida na margem e o texto fica na cor normal, sem fundo.', muda: 'tinta de fundo nas linhas do diff (onda 9)', l: `
   {b:a.ts} {d:src/x/ ·} {o:+2} {e:−1}>>{d:14:32}
   {e:▎}{d:12}  {dx:const a = 1}
   {o:▎}{d:12}  const a = 2
   {o:▎}{d:13}  const b = a
    {d:14}  {d:return a}
` },
      { n: 'Resumo, diff sob demanda', d: 'Fechado por padrão: uma linha com o arquivo e a contagem. O diff abre com ctrl+o ou em /diff.', l: `
@n   {m:✎} {b:a.ts} {d:src/x/ ·} {o:+2} {e:−1}>>{d:ctrl+o abre · 14:32}
` },
    ],
  },
  {
    g: 'Conversa', id: 'task', t: 'Tarefa (todo)', onde: 'ui-visual/motion/chrome.ts:76',
    hoje: `
@s   {a:☰} {b:Task} {d:·} {c:iniciada} {a:#2}  Implementar o parser>>{o:██}{d:╌╌╌╌} {m:1/3} {d:33%}  {k: 14:32 }
@s   {a:☰} {b:Task} {d:·} {o:concluída} {a:#2}  Implementar o parser>>{o:████}{d:╌╌} {m:2/3} {d:66%}  {k: 14:40 }
`,
    v: [
      { n: 'Sem repetir o nome', d: 'O verbo vira o título; o número e a barra ficam, o percentual sai (2/3 já diz).', l: `
@s   {a:☰} {b:iniciada} {d:#2} Implementar o parser>>{o:██}{d:╌╌╌╌} {d:1/3 · 14:32}
@s   {a:☰} {b:concluída} {d:#2} Implementar o parser>>{o:████}{d:╌╌} {d:2/3 · 14:40}
` },
      { n: 'Caixa de seleção', d: 'Como um lembrete: círculo que enche. Sem fundo; a tarefa feita fica apagada.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {a:◐} Implementar o parser {d:· iniciada}>>{d:1 de 3 · 14:32}
   {o:●} {d:Implementar o parser · concluída}>>{d:2 de 3 · 14:40}
` },
      { n: 'Só na seção do plano', d: 'Nada na conversa: o progresso mora na seção do plano, que já fica acima do campo.', l: `
   {d:(nada desenhado na conversa)}
` },
    ],
  },
  {
    g: 'Conversa', id: 'subagente', t: 'Subagente', onde: 'ui-visual/tools.ts:115',
    hoje: `
@e   {m:◎} {b:subagente} {d:·} {m:paralelo · 2 agentes}>>{k: 14:41 }
@e     {d:│ 1 de 2 concluídos ·} {e:1 falhou} {d:· 6 turnos}
@e     {d:│} gate-runner  {e:falhou}     {d:structure: 2 violações}
@e     {d:│} test-author  {o:concluído}  {d:6 testes novos}
`,
    v: [
      { n: 'Tabela alinhada', d: 'Sai a linha de resumo; o título conta os agentes e cada linha é nome, estado e resultado em colunas.', l: `
@e   {m:◎} {b:2 agentes} {d:·} {e:1 falhou} {d:· 6 turnos}>>{d:ctrl+o abre · 14:41}
@e     gate-runner   {e:falhou}      {d:structure: 2 violações}
@e     test-author   {o:concluído}   {d:6 testes novos}
` },
      { n: 'Árvore', d: 'Sem fundo: os agentes pendem do título por um fio, como a barra lateral do Finder.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {b:2 agentes} {d:· 6 turnos}>>{d:14:41}
   {r:├} gate-runner  {e:falhou} {d:· structure: 2 violações}
   {r:└} {d:test-author  concluído · 6 testes novos}
` },
      { n: 'Só exceções', d: 'Uma linha quando tudo deu certo; só quem falhou ganha linha própria.', l: `
   {b:2 agentes} {d:· 1 concluído ·} {e:1 falhou}>>{d:ctrl+o abre · 14:41}
     gate-runner  {e:falhou} {d:· structure: 2 violações}
` },
    ],
  },
  {
    g: 'Conversa', id: 'run', t: 'Comando em segundo plano (run)', onde: 'ui-visual/tools.ts:42 (RUN_LINHA)',
    hoje: `
@p   {m:▶} {b:run} {d:·} {m:aguardou 30s gw-lean}
@p     {d:│} {c:ainda rodando} {d:· 00:40 · rhwep1 · sem saída · log ~/…/pi-runs/rhwep1.log}
`,
    v: [
      { n: 'Uma linha', d: 'Nome, estado e tempo no título. O caminho do log sai; ctrl+o mostra.', l: `
@p   {m:▶} {b:gw-lean} {d:·} {a:rodando} {d:· 40s · sem saída}>>{d:ctrl+o abre}
` },
      { n: 'Com a última linha', d: 'Sem fundo; a última linha da saída aparece apagada embaixo, para ver que anda.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {b:gw-lean} {a:rodando} {d:· 40s}>>{d:ctrl+o abre}
     {d:Compiling gateway v0.4.1 (12 de 87)}
` },
      { n: 'Só no painel', d: 'Nada na conversa enquanto roda; o painel de runs mostra. Só o fim (terminou, falhou) vira linha.', l: `
   {d:(rodando: nada na conversa)}
   {b:gw-lean} {o:terminou} {d:· 2m 10s}>>{d:14:44}
` },
    ],
  },
  {
    g: 'Conversa', id: 'pergunta-chat', t: 'Pergunta respondida, na conversa', onde: 'pi-code question.ts:282',
    hoje: `
@s   {m:?} {b:pergunta}  {o:Variante A}>>{k: }{ka:alt+o}{kd: abre }  {k: 14:50 }
@s     {d:│ Qual variante de exibição do limite devo aplicar?}
`,
    v: [
      { n: 'Pergunta e resposta', d: 'A pergunta apagada e a sua resposta em destaque, na mesma linha quando cabe.', l: `
@s   {m:?} {d:Qual variante de exibição do limite?}  {b:Variante A}>>{d:14:50}
` },
      { n: 'Como mensagem sua', d: 'A resposta é uma mensagem do usuário, com a pergunta como legenda.', l: `
   {d:Qual variante de exibição do limite devo aplicar?}
 {a:❯} {b:Variante A}>>{d:14:50}
` },
      { n: 'Só a resposta', d: 'Uma linha curta; a pergunta inteira abre com alt+o.', l: `
   {d:você escolheu} {b:Variante A}>>{d:alt+o abre · 14:50}
` },
    ],
  },
  {
    g: 'Conversa', id: 'codigo', t: 'Bloco de código', onde: 'code-blocks/index.ts',
    hoje: `
@n   {d:ts}>>{au:⧉ copiar}
@n   {t:const} {a:soma} = (a{m::} {c:number}) {m:=>} a + {p:1}
@n   {t:export} {m:default} {a:soma}
`,
    v: [
      { n: 'Com o arquivo', d: 'O cabeçalho ganha o caminho quando o modelo informa, e vira link para abrir no editor.', l: `
@n   {au:src/soma.ts} {d:· ts}>>{d:⧉ copiar}
@n   {t:const} {a:soma} = (a{m::} {c:number}) {m:=>} a + {p:1}
@n   {t:export} {m:default} {a:soma}
` },
      { n: 'Barra lateral', d: 'Sem fundo: um fio cinza à esquerda marca o bloco, e copiar aparece só no fim.', l: `
   {r:│} {t:const} {a:soma} = (a{m::} {c:number}) {m:=>} a + {p:1}
   {r:│} {t:export} {m:default} {a:soma}
   {r:│} {d:ts · ⧉ copiar}
` },
      { n: 'Duas cores', d: 'Sintaxe só com texto, cinza e um destaque: palavras-chave em negrito, comentários apagados.', muda: 'sintaxe do pi-noite em 4 cores (onda 9)', l: `
@n   {b:const} soma = (a{d::} {m:number}) {d:=>} a + 1>>{d:⧉ copiar}
@n   {b:export default} soma
` },
    ],
  },
)
