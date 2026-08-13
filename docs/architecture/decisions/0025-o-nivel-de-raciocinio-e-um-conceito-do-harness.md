# ADR-0025: O nível de raciocínio é um conceito do harness, e o dialeto traduz

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-4;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) FR-1, FR-2

## Contexto

O tipo `Sampling` existe desde o começo com `thinking_budget`, `temperature`,
`top_p` e `stop_sequences`, e `Client::with_sampling` existe para configurá-lo.
Nenhum dos dois tem um único chamador fora de teste. Os dois dialetos OpenAI
mencionam `sampling` apenas dentro de helpers `#[cfg(test)]`; a função que monta
o corpo do pedido nunca o consulta. Na prática, controle de raciocínio,
temperatura e sequência de parada são código inalcançável.

Isso não é só uma feature faltando. O NFR-4 proíbe degradar em silêncio, e um
parâmetro que o usuário configura e que o cliente descarta sem dizer nada é
exatamente a degradação silenciosa que o requisito descreve — apenas na direção
da ida, e não na da volta.

Consertar exige decidir uma coisa que não é óbvia: cada provider expressa
raciocínio de um jeito diferente. O formato Anthropic pede um orçamento em
tokens. O formato OpenAI Responses pede um esforço nomeado. Os endpoints
compatíveis com OpenAI que servem outros modelos usam pelo menos onze convenções
distintas, e a referência tem um campo de formato com onze valores para dar
conta disso. Um orçamento em tokens não converte em esforço nomeado sem perda, e
o inverso também não.

A referência resolve com um nível nomeado de sete valores no harness, um mapa
por modelo que traduz para o valor do provider, e `null` marcando "este modelo
não suporta este nível". Um rebaixamento leva o pedido ao nível suportado mais
próximo em vez de falhar.

## Decisão

O nível de raciocínio é um conceito do harness, nomeado e finito, e cada dialeto
é responsável por traduzi-lo para o que o seu provider entende.

Restrições que são a decisão tanto quanto a escolha principal:

- **Um nível pedido e não suportado é rebaixado ao suportado mais próximo, e o
  rebaixamento é dito ao usuário.** Silenciar é o defeito que motivou o ADR;
  falhar seria trocar um defeito por outro, porque o usuário que pede o nível
  máximo quer o máximo que existir, não um erro.
- **Um dialeto que não aceita um parâmetro de amostragem recusa a configuração em
  voz alta em vez de descartá-la.** Vale para temperatura, top_p e sequência de
  parada tanto quanto para raciocínio.
- **Nenhum símbolo desta área fica sem chamador de produção.** É o defeito
  original, e a verificação está no NFR-2 local da spec 002.

## Consequências

Positivas: o NFR-4 passa a valer na ida do pedido, e não só na volta da resposta.
O usuário ganha controle de custo e de latência que o binário já tinha modelado e
não expunha. A tradução por dialeto isola a fragmentação dos providers num lugar
só, em vez de vazá-la para o CLI.

Negativas: o mapa por modelo é metadado que alguém precisa manter, e ele erra
quando um modelo novo aparece antes de o mapa saber dele. O comportamento padrão
nesse caso é tratar o modelo desconhecido como suportando apenas o nível
implícito do provider, o que é conservador e às vezes errado para menos. E o
rebaixamento acrescenta uma mensagem que o usuário não pediu — ruído aceito
porque a alternativa é a mentira.

Descartadas: **expor o orçamento em tokens diretamente**, rejeitado porque só o
formato Anthropic o aceita e o usuário teria de saber qual dialeto está usando
para saber o que a flag significa. **Repassar o valor cru do usuário ao
provider**, rejeitado porque transfere a fragmentação de onze convenções para
quem digita a linha de comando. **Falhar quando o nível não é suportado**,
rejeitado acima.

## Revisão

Reabrir se os providers convergirem numa convenção única de raciocínio, momento
em que o mapa por modelo vira custo sem contrapartida e a tradução por dialeto
pode desaparecer. Reabrir também se o número de níveis nomeados provar-se
insuficiente para um provider relevante — a ação padrão então é acrescentar
nível ao vocabulário do harness, nunca vazar o valor cru do provider para cima.
