# ADR-0020: O despacho de ferramentas é sequencial, divergindo da referência

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-3, NFR-6, NFR-7

## Contexto

Um modelo emite várias chamadas de ferramenta num turno só, e o harness decide
se as executa em sequência ou junto. O NyCode CLI executa em sequência, na ordem
em que o modelo pediu, desde o primeiro commit — e isso nunca foi registrado.

A referência (`pi`) executa **em paralelo por padrão**, com duas propriedades
que valem citar: um único tool marcado como sequencial rebaixa o lote inteiro; e
os eventos de interface saem em ordem de conclusão enquanto as mensagens de
resultado saem em ordem de origem, o que preserva o determinismo do histórico
sem sacrificar a responsividade da tela.

Ela também resolve, e melhor do que uma marcação por ferramenta resolveria, o
problema que o paralelismo cria em cima de arquivo: a exclusão mútua é por
**caminho canônico** (`file-mutation-queue.ts`), não por tipo de ferramenta.
Três edições em três arquivos rodam juntas; duas no mesmo arquivo serializam.

O NFR-6 exige que qualquer divergência observável da referência seja decisão
registrada e não acidente. Esta é uma divergência observável — o mesmo prompt
contra o mesmo gateway produz a mesma sequência de chamadas nos dois, mas com
tempo de parede diferente — e estava sem registro.

## Decisão

**O despacho é sequencial, na ordem em que o modelo pediu.** Não porque o
paralelismo seja indesejável, mas porque três coisas precisariam existir antes
dele e nenhuma existe:

- **Exclusão mútua por caminho canônico.** Sem ela, duas edições concorrentes no
  mesmo arquivo se perdem, e a contenção por descritor do
  [ADR-0018](0018-a-contencao-de-caminho-e-imposta-na-abertura.md) não protege
  disso — ela garante que o arquivo aberto é o validado, não que duas escritas
  não se sobreponham.

- **Separação entre ordem de execução e ordem de gravação.** O histórico
  precisa sair na ordem que o modelo pediu, sempre. Um histórico cuja ordem
  depende de qual ferramenta terminou primeiro é um prefixo que muda entre
  execuções idênticas, e um prefixo que muda é um cache que erra (NFR-7).

- **Um aprovador que aguenta perguntas concorrentes.** O gate `Ask` pergunta ao
  usuário no meio do turno, por um canal de capacidade um. Duas ferramentas
  pedindo aprovação ao mesmo tempo é uma pergunta que fica esperando enquanto a
  outra ocupa a tela.

O cancelamento também é mais simples aqui: o laço checa o sinal entre chamadas e
marca as restantes como canceladas, o que o ADR-0015 descreve. Em paralelo, cada
chamada em voo precisaria do próprio caminho de cancelamento.

## Consequências

Positivas. A ordem de execução é a ordem do modelo, sempre, sem mecanismo
adicional. O histórico é determinístico por construção, e não por reordenação
depois. O aprovador tem uma pergunta por vez. E não há corrida em cima de
arquivo para proteger, porque não há concorrência.

Negativas, e o número não foi medido. Um turno que lê cinco arquivos paga cinco
latências de I/O em série onde uma execução paralela pagaria uma. Para leitura
local a diferença é pequena; para ferramenta de servidor MCP, que atravessa
processo e às vezes rede, ela é a soma dos tempos de resposta. Um turno que
consulta três servidores é três vezes mais lento do que precisaria ser, e esse é
o caso que mais provavelmente vai motivar a revisão.

Descartadas:

- **Paralelismo com as ferramentas de mutação marcadas como sequenciais.** É o
  desenho mais óbvio e é pior que o do `pi`: rebaixa o lote inteiro sempre que
  houver um `edit`, que é o caso comum num agente de codificação, e ainda assim
  não protege duas edições no mesmo arquivo se alguém remover a marcação.

- **Paralelismo só para as ferramentas somente-leitura.** Cobre o caso do MCP e
  o das leituras múltiplas sem exigir exclusão mútua. Foi descartada por ordem
  de trabalho e não por mérito: sem a separação entre ordem de execução e ordem
  de gravação, ela já quebraria o determinismo do histórico.

## Revisão

Reabre quando o tempo de turno com servidores MCP virar reclamação medida. A
ação padrão nesse caso é a alternativa descartada acima, na ordem: primeiro a
separação entre ordem de execução e ordem de gravação, depois a fila de mutação
por caminho canônico, e só então o paralelismo — nunca o paralelismo primeiro.
