# ADR-0026: O preço vem do catálogo descoberto, e o custo é calculado no cliente

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-6, FR-19;
  [spec 002](../../specs/002-paridade-e-sota-2026/spec.md) FR-4

## Contexto

O FR-19 promete que "o custo acumulado da sessão é visível a qualquer momento", e
está marcado entregue. O que existe é contagem de tokens: entrada, saída, leitura
e escrita de cache. Não há preço em lugar nenhum do repositório, e portanto não
há custo — há volume.

A distinção importa porque as duas grandezas divergem por mais de uma ordem de
magnitude entre modelos, e porque a decisão que o número deveria informar — vale
a pena trocar de modelo agora — depende do preço e não do volume. Um rodapé que
mostra volume e chama de custo dá ao usuário a sensação de estar informado sem
informá-lo.

O FR-6 fecha a rota mais fácil: "o catálogo de modelos disponíveis é descoberto,
não hardcoded". Uma tabela de preços compilada no binário resolveria o problema e
violaria o requisito — e envelheceria, que é o motivo pelo qual o FR-6 existe.

A referência calcula custo a cada atualização de usage, com duas sutilezas que
erram o número quando ignoradas. As tarifas vêm em valor por milhão de tokens e
podem ter **faixas por tamanho de contexto**, em que a faixa escolhida vale para
o pedido inteiro e não só para o excedente. E a **escrita de cache de retenção
longa é cobrada ao dobro da tarifa de entrada**, não à tarifa de escrita de
cache — uma regra do provider que não se deduz da estrutura de preços.

## Decisão

O preço é metadado do catálogo descoberto, e o custo é calculado no cliente a
cada atualização de usage.

Restrições:

- **Nenhuma tarifa é compilada no binário.** Um modelo cujo catálogo não declara
  preço mostra volume e diz que não sabe o custo, em vez de estimar.
- **A faixa de preço por tamanho de contexto vale para o pedido inteiro**, e é
  escolhida pela maior faixa que o pedido excede.
- **Escrita de cache de retenção longa é cobrada ao dobro da tarifa de entrada.**
- **O custo é derivado, nunca persistido como verdade.** O que a sessão grava é o
  usage; o preço pode mudar, e um custo gravado com a tarifa velha viraria um
  número errado que ninguém consegue recomputar.

## Consequências

Positivas: o FR-19 passa a dizer o que promete. A troca de modelo no meio da
sessão ganha o número que a torna uma decisão em vez de um palpite. E o cálculo
ficar no cliente mantém o gateway livre de precificar.

Negativas: o número depende da qualidade do catálogo, e um catálogo que declara
preço errado produz custo errado com a mesma confiança de um certo. O usuário não
tem como distinguir. Mitigação parcial: um modelo sem preço declarado diz que não
sabe, então a falha por ausência é visível — só a falha por valor errado não é.

Descartadas: **tabela de preços versionada no repositório**, rejeitada pelo FR-6 e
porque exigiria uma release para acompanhar mudança de tarifa. **Pedir o custo ao
gateway**, rejeitada porque acopla o cliente a um endpoint que o contrato do
gateway não documenta, e porque o FR-9 permite apontar para outro provider que
não o teria. **Estimar preço por família de modelo quando o catálogo cala**,
rejeitada porque um número inventado é pior que a ausência dele — a ausência o
usuário percebe.

## Revisão

Reabrir se o gateway passar a expor custo por resposta de forma documentada,
momento em que calcular no cliente vira duplicação e a fonte autoritativa passa a
ser o servidor. Reabrir também se a estrutura de preços dos providers ganhar uma
dimensão que faixas por tamanho de contexto não expressem — a ação padrão é
estender o metadado do catálogo, não voltar a compilar tarifa no binário.
