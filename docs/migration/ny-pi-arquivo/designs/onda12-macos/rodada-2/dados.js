window.ONDA12_CHAVE = 'onda12-rodada2-escolhas'
window.ONDA12_TITULO = 'Onda 12 · escolhas da segunda rodada'
window.ONDA12 = []

function item(g, id, t, onde, hoje, variantes, nota, hojeNota) {
  window.ONDA12.push({ g, id, t, onde, hoje, nota, hojeNota, v: variantes.map(([n, d, l]) => ({ n, d, l })) })
}

item('Ícones e estados', 'icones-sinais', 'Subagente, hook e gate', 'icons.ts · hook-msgs', `
  {a:◆} 2 agentes · 6 turnos
    ├ Doc · concluído
    └ Testes · {c:rodando}
  {w:◇} Hook de formato · ajustou 1 arquivo
  {w:▲} Gate do plano · revisão pendente`, [
  ['Robô, plugue e escudo', 'Codicons monocromáticos com reserva ◆, ◇ e ▲.', `
  {a:\ueb08} 2 agentes · 6 turnos
    ├ Doc · concluído
    └ Testes · {c:rodando}
  {w:\ueb2d} Hook de formato · ajustou 1 arquivo
  {w:\ueb53} Gate do plano · revisão pendente`],
  ['Grupo, evento e checklist', 'Codicons que descrevem o papel de cada sinal.', `
  {a:\uea7e} 2 agentes · 6 turnos
    ├ Doc · concluído
    └ Testes · {c:rodando}
  {w:\uea86} Hook de formato · ajustou 1 arquivo
  {w:\ueab3} Gate do plano · revisão pendente`],
  ['Geométricos, sem Nerd Font', 'Losango para agentes, raio para evento e triângulo para bloqueio.', `
  {a:◆} 2 agentes · 6 turnos
    ├ Doc · concluído
    └ Testes · {c:rodando}
  {w:ϟ} Hook de formato · ajustou 1 arquivo
  {w:▴} Gate do plano · revisão pendente`],
], 'Com a árvore já escolhida. Ícones de fonte especial usam reserva ASCII em terminais simples.')

item('Ícones e estados', 'modelos-travados', 'Modelos travados sem emoji', 'travar-modelos · rodapé', `
 {w:3 modelos travados}   {d:alt+e abre}`, [
  ['Cadeado linear', 'Codicon lock. Reserva Unicode ▣, ASCII #.', ' {w:\uea75 3 modelos travados}   {d:alt+e abre}'],
  ['Chave', 'Codicon key. Reserva Unicode ▣, ASCII #.', ' {w:\ueb11 3 modelos travados}   {d:alt+e abre}'],
  ['Quadrado contido', 'Unicode simples para não depender da Nerd Font.', ' {w:▣ 3 modelos travados}   {d:alt+e abre}'],
], null, 'Referência sem emoji e sem ícone.')

item('Ícones e estados', 'task-iniciada', 'Cor da Task iniciada', 'ui-visual · Task', `
 {o:▸ Iniciada} {d:#2}  Revisar testes
 {o:✓ Concluída} {d:#1}  Ler requisitos`, [
  ['Ciano', 'Mesma cor de executando. Verde fica reservado para conclusão.', ' {c:▸ Iniciada} {d:#2}  Revisar testes\n {o:✓ Concluída} {d:#1}  Ler requisitos'],
  ['Azul', 'Usa o acento da interface, sem caráter de aviso.', ' {a:▸ Iniciada} {d:#2}  Revisar testes\n {o:✓ Concluída} {d:#1}  Ler requisitos'],
  ['Neutra', 'A atividade se lê pelo verbo e pelo glifo, não pela cor.', ' {m:▸ Iniciada} {d:#2}  Revisar testes\n {o:✓ Concluída} {d:#1}  Ler requisitos'],
])

item('Conversa e painéis', 'pergunta-chat', 'Pergunta respondida sem barra lateral', 'pi-code · pergunta na conversa', `
@n   {a:?} {b:Qual tema você prefere?}
@n   {d:│} {o:✓} pi-noite`, [
  ['Resposta recuada', 'Mantém o fundo, alinha a resposta abaixo do texto da pergunta.', '@n   {a:?} {b:Qual tema você prefere?}\n@n     {o:✓} pi-noite'],
  ['Rótulo de resposta', 'Mantém o fundo e explica o que vem abaixo da pergunta.', '@n   {a:?} {b:Qual tema você prefere?}\n@n     {d:Resposta:} pi-noite'],
  ['Resumo em uma linha', 'Em perguntas longas, a resposta desce para a segunda linha, sem barra.', '@n   {a:?} {b:Qual tema você prefere?} {d:·} {o:✓} pi-noite'],
])

item('Conversa e painéis', 'paleta-comandos', 'Paleta de comandos com busca', 'comandos · seleção e grupos', `
  {r:── }{b:Comandos}{r: ─~}
  {d:Sessão}
@l  {a:❯} /resume  Retomar sessão>>{d:ctrl+r}
    /new     Nova sessão`, [
  ['Busca sobre grupos', 'A busca fica no topo. Resultados continuam agrupados, com teclas à direita.', `
  {r:── }{b:Comandos}{r: ─~}
@n   {a:⌕} re>>{d:2 encontrados}
  {d:Sessão}
@l  {a:❯} /{b:re}sume   Retomar sessão>>{k: ctrl+r }
  {d:Interface}
    /{b:re}load   Recarregar>>{k: ⏎ }
  {k: ↑↓ } {d:move}   {k: ⏎ } {d:executa}   {k: esc } {d:fecha}`],
  ['Spotlight com moldura', 'Controle arredondado com busca e grupos no mesmo cartão.', `
 {r:╭──────────────────────────────────────────────────────────────────────────────╮}
 {r:│} {a:⌕} re>>{d:2 encontrados} {r:│}
 {r:│} {d:Sessão}>>{r:│}
@l {r:│} {a:❯} /{b:re}sume  Retomar sessão>>{k: ctrl+r } {r:│}
 {r:│} {d:Interface}>>{r:│}
 {r:│}   /{b:re}load  Recarregar>>{k: ⏎ } {r:│}
 {r:╰──────────────────────────────────────────────────────────────────────────────╯}`],
  ['Grupos só sem filtro', 'Ao digitar, aparecem resultados em uma lista única com o grupo em cinza.', `
  {r:── }{b:Comandos}{r: ─~}
@n   {a:⌕} re>>{d:2 encontrados}
@l  {a:❯} /{b:re}sume   {d:Sessão}>>{k: ctrl+r }
    /{b:re}load   {d:Interface}>>{k: ⏎ }
  {k: ↑↓ } {d:move}   {k: ⏎ } {d:executa}   {k: esc } {d:fecha}`],
])

item('Conversa e painéis', 'painel-agentes', 'Estados no painel de agentes', 'pi-code · painel da frota', `
  {r:── }{b:Agentes}{r: ─~}
  Doc     {c:rodando}     {d:24s}
  Testes  {o:concluído}   {d:1 min}
  Mapa    {e:falhou}      {d:41s}`, [
  ['Fundos por estado', 'Faixa ciano, verde ou vermelha, além da palavra do estado.', `
  {r:── }{b:Agentes}{r: ─~}
@p   Doc     {c:rodando}     {d:24s}
@s   Testes  {o:concluído}   {d:1 min}
@e   Mapa    {e:falhou}      {d:41s}`],
  ['Ícones sem fundo', 'A linha fica plana. O ícone e o texto repetem o estado.', `
  {r:── }{b:Agentes}{r: ─~}
  {c:▸} Doc     {c:rodando}     {d:24s}
  {o:✓} Testes  {o:concluído}   {d:1 min}
  {e:✕} Mapa    {e:falhou}      {d:41s}`],
  ['Ícones e fundo só na falha', 'Execução e conclusão ficam planas; a falha ganha uma faixa.', `
  {r:── }{b:Agentes}{r: ─~}
  {c:▸} Doc     {c:rodando}     {d:24s}
  {o:✓} Testes  {o:concluído}   {d:1 min}
@e   {e:✕} Mapa    {e:falhou}      {d:41s}`],
], 'O texto dos estados fica em português em todas as variantes.')

item('Híbridos', 'hud-hibrido', 'HUD: manter o conteúdo de hoje e testar duas linhas', 'calm-statusline.mjs', `
  sonnet 5.5 · médio    {d:main}
  ctx {a:███╌╌╌} 30%  ·  5h {w:████╌╌} 68%
  semana {a:██╌╌╌╌} 22%  ·  {d:renova em 1h}`, [
  ['Duas linhas quando couber', 'Modelo na primeira; barras, percentuais e resets juntos na segunda. Em janela estreita, usa três linhas.', `
  sonnet 5.5 · médio    {d:main}
  ctx {a:███╌╌╌} 30%    5h {w:████╌╌} 68% {d:1h}    semana {a:██╌╌╌╌} 22% {d:4d}`],
], 'Amostra das duas densidades, sem trocar os indicadores.')

item('Híbridos', 'moldura-hibrida', 'Molduras: régua nas folhas, cartão nas confirmações', 'folha · confirmação', `
  {r:── }{b:Confirmar}{r: ─~}
  Excluir a sessão?`, [
  ['Moldura só na decisão', 'O botão seguro começa em foco. A ação é neutra, âmbar ou vermelha conforme a consequência.', `
  {r:── }{b:Histórico}{r: ─~}

  {r:╭──────────────────────────────────────────────────────────╮}
  {r:│} {b:Excluir a sessão?}                                        {r:│}
  {r:│} {m:Esta ação não pode ser desfeita.}                          {r:│}
  {r:│}                                  {v: Cancelar }   {e: Excluir } {r:│}
  {r:╰──────────────────────────────────────────────────────────╯}

  {v: Não permitir }   {w: Permitir }   {d:ação que pede cautela}
  {v: Cancelar }       {m: Abrir }      {d:ação comum}`],
])

item('Híbridos', 'avisos-hibrido', 'Avisos: manter as abas e mudar só Recentes', 'avisos/painel.ts', `
  {r:── }{b:Avisos}{r: ─~}
  [Recentes] Ajustes
  ✕  O provedor está fora do ar>>{d:12:18}`, [
  ['Recentes agrupados', 'Mantém as abas e os ajustes. A lista ganha grupos de tempo, estado por extenso e hora à direita.', `
  {r:── }{b:Avisos}{r: ─~}
  {k: Recentes } {d:Ajustes}
  {d:Agora há pouco}
  {e:erro}      O provedor está fora do ar>>{d:12:18}
  {d:Mais cedo}
  {o:terminou}  Testes da interface>>{d:11:42}`],
])

window.ONDA12.push({ g: 'Híbridos', id: 'codigo-exemplo', t: 'Bloco de código com cabeçalho', onde: 'code-blocks/blocks.ts', hojeNota: 'Este desenho já existe no renderizador. O botão usa /copy-code quando clicar não está disponível.', hoje: `
@n   {pb:TypeScript}>>{a:⧉ copiar}
@n
@p   {p:const} total = pedidos.length
@p   console.log(total)
@p`, v: [] })
