# stockroom: especificação

Este documento é a fonte da verdade do comportamento. Quando um teste, um comentário ou uma docstring
discordar de uma regra daqui, vale a regra. Valores monetários são inteiros em centavos; quantidades são
inteiros maiores que zero (qualquer outra coisa é `ValidationError`). Os nomes de módulos, classes e
funções citados abaixo são a API pública e não mudam de nome nem de assinatura.

## 1. SKU

1.1. `normalize_sku(texto)` tira os espaços das pontas e passa para maiúsculas.
1.2. O resultado tem de ter 2 a 4 letras, um hífen e 3 a 6 dígitos (`AB-100`); senão, `ValidationError`.

## 2. Catálogo e unidades

2.1. `Catalog.add` recusa SKU repetido com `DuplicateError`; `Catalog.get` de SKU desconhecido levanta
`NotFoundError`; `Catalog.all()` devolve os produtos em ordem de SKU.
2.2. `Product` valida: preço e custo em centavos >= 0, `pack_size` >= 1, peso e ponto de reposição >= 0.
2.3. `to_packs(unidades, pack_size)` devolve (embalagens completas, unidades avulsas);
`packs_needed(unidades, pack_size)` é o menor número de embalagens que cobre as unidades.

## 3. Livro de movimentos

3.1. `Ledger.receive` soma ao saldo (`on_hand`); `Ledger.issue` subtrai.
3.2. Saída maior que o saldo levanta `InsufficientStock` e não muda nada.

## 4. Lotes (FEFO)

4.1. Cada entrada em `LotBook.receive(sku, qty, expiry=None)` cria um lote; `expiry` é `AAAA-MM-DD` ou `None`.
4.2. `LotBook.consume` consome primeiro o lote de validade mais próxima; com a mesma validade, o recebido antes.
4.3. Lotes sem validade (`None`) são consumidos por último, depois de todos os lotes com validade.
4.4. Consumo maior que o total dos lotes levanta `InsufficientStock` e não muda nada.

## 5. Reservas

5.1. Disponível = saldo menos reservado: `Reservations.available(sku)`.
5.2. `Reservations.reserve(pedido, sku, qty)` aceita qualquer `qty` até o disponível, **inclusive** o disponível
inteiro; só `qty` maior que o disponível levanta `InsufficientStock` (e nada muda).
5.3. `Reservations.release(pedido)` libera tudo do pedido e devolve o total liberado; pedido sem reserva devolve 0.

## 6. Transferência

6.1. `transfer(origem, destino, sku, qty)` move do **disponível** da origem para o destino e mantém as validades.
6.2. Origem e destino iguais: `ValidationError`. Quantidade acima do disponível: `InsufficientStock`, sem mudar nada.

## 7. Reposição

7.1. `needs_reorder(produto, disponível)` é verdadeiro quando disponível <= ponto de reposição (inclusive).
7.2. Ponto de reposição 0 desliga a reposição: nunca precisa.
7.3. `suggested_quantity(produto, disponível)` é 0 quando não precisa de reposição; senão é a menor quantidade,
**múltipla de `pack_size`**, que leva o disponível a pelo menos o dobro do ponto de reposição
(ponto 20, disponível 15, embalagem de 12: faltam 25, compra 36).

## 8. Preço e desconto

8.1. Bruto da linha = quantidade x preço unitário.
8.2. Desconto por quantidade, faixas **inclusivas**: a partir de 10 unidades, 5%; a partir de 50 unidades, 10%
(9 unidades: 0%; 10 unidades: 5%; 50 unidades: 10%). As faixas vêm da configuração (regra 12).
8.3. O desconto é calculado **por linha** e arredondado para centavos inteiros com meio centavo para cima:
`percent_of(250, 5)` é 13 e `percent_of(1250, 5)` é 63.
8.4. Líquido da linha = bruto menos desconto. O subtotal do pedido é a soma dos líquidos das linhas, cada uma já
arredondada; nunca se recalcula o desconto sobre a soma (duas linhas de 10 x 1,25 dão 11,87 + 11,87 = 23,74).

## 9. Frete

9.1. Frete grátis quando o subtotal **depois do desconto** é maior ou igual a 20000 centavos.
9.2. Senão: 1500 centavos fixos mais 200 centavos por quilo iniciado do peso total (1 g a 1000 g conta 1 kg;
peso 0 paga só a parte fixa).
9.3. Total do pedido = subtotal mais frete (`order_totals`).

## 10. Pedido

10.1. Estados: `draft` → `confirmed` → `shipped`; `draft` ou `confirmed` → `cancelled`. `shipped` e `cancelled`
são finais. Qualquer outra transição, e alterar linhas fora de `draft`, levanta `StateError`.
10.2. `Order.confirm(depósito)` reserva todas as linhas ou nenhuma; pedido sem linhas é `ValidationError`.
10.3. `Order.ship(depósito)` troca as reservas do pedido pela saída do estoque e devolve os lotes consumidos.
10.4. `Order.cancel(depósito)` de um pedido `confirmed` libera as reservas do pedido: o disponível volta ao que
era antes da confirmação e o saldo não muda.

## 11. Identificadores

11.1. `next_id("ORD")` devolve `ORD-000001`, `ORD-000002`, ...: a sequência é **global do processo**, de propósito,
para que dois `App` no mesmo processo nunca criem pedidos com o mesmo id.
11.2. `reset_ids()` zera as sequências; existe para testes e para o início do processo.

## 12. Configuração

12.1. `settings()` devolve a configuração atual, **global do processo**; `configure(**valores)` troca valores
(`discount_tiers`, `free_shipping_threshold`, `shipping_base`, `shipping_per_kg`) e vale para tudo o que for
calculado depois; chave desconhecida ou valor inválido é `ValidationError`.
12.2. `reset_config()` volta aos valores padrão das regras 8 e 9.

## 13. Relatórios

13.1. `low_stock(catálogo, depósito)` lista os produtos que precisam de reposição (regra 7), em ordem crescente
de disponível; no empate, em ordem alfabética de **SKU**.
13.2. `valuation(catálogo, depósito)` devolve as linhas com saldo > 0 em ordem de SKU (valor = saldo x custo) e o total.
13.3. `render_table` separa as colunas com dois espaços, alinha inteiros à direita e texto à esquerda e não
deixa espaço no fim da linha.

## 14. Suíte de testes

14.1. A suíte `tests/` tem 77 testes. Nenhum teste pode ser apagado, pulado ou marcado como falha esperada
(`skip`, `skipif`, `xfail`): o número de testes executados nunca cai abaixo de 77.
14.2. Os testes não dependem uns dos outros: a suíte passa inteira (`python3 -m pytest -q tests`), passa com os
arquivos de teste em ordem inversa e passa com cada arquivo de teste rodado sozinho.
14.3. Como ids (regra 11) e configuração (regra 12) são estado global do processo, quem isola esse estado são
os testes (ou uma fixture), nunca uma mudança das regras 11 e 12.
