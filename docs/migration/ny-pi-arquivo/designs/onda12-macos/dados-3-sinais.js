// Onda 12 · sinais do sistema: erros, limites, hooks, divisores e notificações.
window.ONDA12.push(
  {
    g: 'Sinais', id: 'erro', t: 'Erro do provedor e nova tentativa', onde: 'patches/pi-core/avisos/runtime.mjs:56-74',
    hoje: `
 {w:⠹ limite de uso do provedor · nova tentativa em 30s · 2 de 10 · esc cancela}

@e   {eb:O provedor está fora do ar}{d: · 529 overloaded_error}
@e     Overloaded
@e     {d:↑ traz o pedido de volta · /model troca de modelo}
`,
    v: [
      { n: 'Mesma estrutura dos avisos', d: 'O erro ganha a hora e a barra dos outros avisos; a mensagem do provedor fica apagada.', l: `
 {w:⠹ provedor fora do ar · nova tentativa em 30s · 2 de 10}>>{d:esc cancela}

@e   {eb:O provedor está fora do ar}>>{d:14:52}
@e   {d:│ tentei 10 vezes em 95s e parei · 529 overloaded_error}
@e   {d:│} ↑ {d:traz o pedido de volta ·} /model {d:troca de modelo}
` },
      { n: 'Alerta do macOS', d: 'Sem fundo: título em negrito, uma frase que diz o que fazer, e as ações como teclas.', muda: 'fundo de erro no bloco (onda 6)', l: `
   {e:●} {b:O provedor está fora do ar}>>{d:14:52}
     {m:Tentei 10 vezes em 95s. O pedido não foi perdido.}
     {k: ↑ } {d:tentar de novo}   {k: /model } {d:trocar de modelo}   {d:529 overloaded_error}
` },
      { n: 'Uma linha', d: 'Uma linha vermelha curta; código e mensagem do provedor abrem com ctrl+o.', l: `
   {e:provedor fora do ar} {d:· parei depois de 10 tentativas · ↑ tenta de novo}>>{d:14:52}
` },
    ],
  },
  {
    g: 'Sinais', id: 'limite', t: 'Limite de uso da conta', onde: 'auto-resume/index.ts:248; proposta em docs/designs/onda11-limite',
    nota: 'São as variantes da onda 11, que você achou ótimas mas ainda não escolheu.',
    hoje: `
@e   {eb:O provedor está limitando o uso}{d: · rate_limit_error}
@e     This request would exceed your account's rate limit. Please try again later.
@e     {d:↑ traz o pedido de volta · /model troca de modelo}

@w   {wb:Limite de uso da conta atingido}>>{d:12:26}
@w   {d:│} {m:a conversa retoma sozinha às 01:01 PM · esc cancela}
`,
    v: [
      { n: 'Uma caixa que muda de estado', d: 'Variante A da onda 11: âmbar na espera, verde ao retomar, cinza se você cancelar.', l: `
@w   {wb:Limite de uso da conta · retoma às 13:01}>>{d:12:26}
@w   {d:│} {m:a conversa continua sozinha em 35 min · esc cancela · /model troca de modelo}
@w   {d:│ provedor: "would exceed your account's rate limit"}
` },
      { n: 'Cartão com contagem', d: 'Variante D da onda 11: a mesma caixa com barra e minutos restantes, atualizada por minuto.', l: `
@w   {wb:Limite de uso da conta}>>{d:12:26}
@w   {d:│} {w:██████▌}{r:╌╌╌╌╌╌} {m:retoma às 13:01 · faltam 17 min}
@w   {d:│ esc cancela · /model troca de modelo}
` },
      { n: 'Linha e contagem viva', d: 'Variante C da onda 11: uma linha no histórico e a contagem na linha de trabalho.', l: `
   {w:limite de uso da conta}{d: · retoma às 13:01 · /model troca de modelo}

 {w:⏸} {m:esperando o limite · 34:12}>>{d:esc cancela}
` },
    ],
  },
  {
    g: 'Sinais', id: 'interrompido', t: 'Interrompido e tentativas canceladas', onde: 'runtime.mjs:71-74',
    hoje: `
@e   {e:interrompido por você}{d: · o que já foi escrito ficou}

 {w:limite de uso do provedor · 429}
 {d:novas tentativas canceladas por você · 3 de 10}
`,
    v: [
      { n: 'Neutro', d: 'Parar é escolha sua, não erro: linha cinza, sem vermelho e sem fundo.', muda: 'interrupção em vermelho com fundo de erro (onda 6)', l: `
   {d:interrompido por você · o que já foi escrito ficou}>>{d:14:53}
` },
      { n: 'Com o próximo passo', d: 'Neutro e com as duas saídas mais comuns como teclas.', muda: 'interrupção em vermelho com fundo de erro (onda 6)', l: `
   {m:Interrompido por você}>>{d:14:53}
     {k: ↑ } {d:traz o pedido de volta}   {k: ⏎ } {d:continua daqui}
` },
      { n: 'Fio', d: 'Um fio com a palavra no meio, como o divisor de sessão retomada.', muda: 'interrupção em vermelho com fundo de erro (onda 6)', l: `
 {r:──── }{d:interrompido por você · 14:53}{r: ─~}
` },
    ],
  },
  {
    g: 'Sinais', id: 'aviso-caixa', t: 'Caixas de aviso', onde: 'runtime.mjs:270 (caixaNeutra), travar-modelos/trava.ts:77',
    hoje: `
@w   {wb:Modelos travados nesta sessão}>>{d:09:12}
@w   {d:│} {m:anthropic/claude-sonnet-5-5 · low, medium}

 {wb:compactada 3 vezes}
 {d:│} {m:cada compactação perde detalhe do contexto · /new recomeça limpo}
`,
    v: [
      { n: 'Um formato só', d: 'Todo aviso usa a mesma caixa: título, hora, corpo sob a barra e a ação no fim.', l: `
@w   {wb:Modelos travados nesta sessão}>>{d:09:12}
@w   {d:│} {m:anthropic/claude-sonnet-5-5 · low, medium}

@w   {wb:Contexto compactado 3 vezes}>>{d:14:10}
@w   {d:│} {m:cada compactação perde detalhe ·} /new {m:recomeça limpo}
` },
      { n: 'Faixa de aviso', d: 'Sem fundo: um triângulo âmbar, título em negrito e o corpo apagado na mesma linha.', muda: 'fundo âmbar do aviso (onda 9)', l: `
   {w:▲} {b:Modelos travados} {d:· anthropic/claude-sonnet-5-5 · low, medium}>>{d:09:12}
   {w:▲} {b:Contexto compactado 3 vezes} {d:· /new recomeça limpo}>>{d:14:10}
` },
      { n: 'Some sozinho', d: 'O aviso aparece 8 s acima do campo e depois fica só em /avisos. A conversa não guarda.', l: `
   {d:(conversa sem a caixa)}
 {w:▲ modelos travados nesta sessão}{d: · /avisos mostra de novo}
{r:─~}
 {a:❯}
` },
    ],
  },
  {
    g: 'Sinais', id: 'hook', t: 'Hooks, gates e avisos de subagente', onde: 'hook-msgs/index.ts',
    hoje: `
@w   {m:⚑} {b:hook} {d:·} {w:atenção} {d:· impeccable · 4 achados · ao parar}>>{k: }{ka:ctrl+o}{kd: abre }  {k: 14:02 }
@w   {m:⚑} {b:gate} {d:·} {w:atenção} {d:· conclusão · 2 arquivos, nenhum check depois}>>{k: 14:03 }
@s   {m:⇄} {b:subagente} {d:·} {o:concluído} {d:· swarm-worker · 10 turnos}>>{k: }{ka:ctrl+o}{kd: abre }  {k: 14:05 }
`,
    v: [
      { n: 'Quem fala primeiro', d: 'O nome de quem avisou vira o título; "hook" e "gate" saem, o estado só aparece se não for sucesso.', l: `
@w   {m:⚑} {b:impeccable} {d:·} {w:4 achados} {d:· ao parar}>>{d:ctrl+o abre · 14:02}
@w   {m:⚑} {b:conclusão} {d:·} {w:2 arquivos editados sem check depois}>>{d:14:03}
@s   {m:⇄} {b:swarm-worker} {d:· 10 turnos}>>{d:ctrl+o abre · 14:05}
` },
      { n: 'Linhas apagadas', d: 'Sem fundo e sem ícone: são recados do sistema, ficam em cinza. Só o que pede ação tem cor.', muda: 'caixa com fundo por estado (onda 7)', l: `
   {d:impeccable ·} {w:4 achados} {d:· ao parar}>>{d:ctrl+o abre · 14:02}
   {d:conclusão ·} {w:2 arquivos editados sem check depois}>>{d:14:03}
   {d:swarm-worker terminou · 10 turnos}>>{d:14:05}
` },
      { n: 'Agrupados', d: 'Recados seguidos viram uma linha com contagem, que abre com ctrl+o.', l: `
   {d:3 recados do sistema ·} {w:2 pedem atenção}>>{d:ctrl+o abre · 14:05}
` },
    ],
  },
  {
    g: 'Sinais', id: 'divisores', t: 'Compactado, recarregado e sessão retomada', onde: 'runtime.mjs:84-183, retomada/runtime.mjs:15',
    hoje: `
   {a:⟲} {b:compactado}  {m:252 mil → ~18 mil tokens} {d:· 3 lidos · ctrl+o abre}>>{d:12:07}
   {a:⟳} {b:recarregado}  {m:atalhos, extensões, skills, prompts, temas e contexto}>>{d:12:09}
 {a:──── ↻ sessão retomada}{m: · refactor-parser · última atividade há 2h }{a:─~}
`,
    v: [
      { n: 'Tudo como fio', d: 'Os três viram o mesmo divisor cinza de largura inteira: marcam um corte na conversa.', l: `
 {r:──── }{d:compactado · 252 mil → 18 mil tokens · 12:07}{r: ─~}
 {r:──── }{d:recarregado · 12:09}{r: ─~}
 {r:──── }{d:sessão retomada · refactor-parser · parada há 2h}{r: ─~}
` },
      { n: 'Data centralizada', d: 'Como o separador de data do Mensagens: texto pequeno, apagado e centralizado, sem linha.', l: `
~ {d:compactado · 252 mil → 18 mil tokens · 12:07}
~ {d:recarregado · 12:09}
~ {d:sessão retomada · parada há 2h}
` },
      { n: 'Linha apagada à esquerda', d: 'Uma linha cinza alinhada com o resto, sem ícone; o detalhe abre com ctrl+o.', l: `
   {d:compactado · 252 mil → 18 mil tokens}>>{d:ctrl+o abre · 12:07}
   {d:recarregado}>>{d:12:09}
   {d:sessão retomada · parada há 2h}>>{d:12:10}
` },
    ],
  },
  {
    g: 'Sinais', id: 'notificacao', t: 'Notificação do sistema', onde: 'avisos/notificar.ts:27',
    nota: 'O desenho é do sistema operacional; o pi escolhe só título e texto.',
    hoje: `
@n   {b:refactor-parser · pi-harness}
@n   {m:Terminou · 2m 10s}

@n   {b:refactor-parser · pi-harness}
@n   {m:Precisa de você · pergunta aberta}
`,
    v: [
      { n: 'Com o resultado', d: 'O texto diz o que aconteceu, não só que acabou: a primeira linha da resposta ou a pergunta.', l: `
@n   {b:pi · refactor-parser}
@n   {m:Terminou em 2m 10s: "O parser aceita comentários; 12 testes…"}

@n   {b:pi · refactor-parser}
@n   {m:Pergunta: qual variante de exibição do limite devo aplicar?}
` },
      { n: 'Verbo no título', d: 'O título é o fato, como nas notificações da Apple; a sessão vai no texto.', l: `
@n   {b:Terminou}
@n   {m:refactor-parser · pi-harness · 2m 10s}

@n   {b:Precisa de você}
@n   {m:refactor-parser · uma pergunta espera resposta}
` },
    ],
  },
)
