# SPEC: várias moedas no motor de preços

Hoje o motor assume uma moeda só. O alvo: toda quantia pertence a uma moeda; cada moeda arredonda do seu jeito;
moedas diferentes nunca são somadas sem conversão explícita com taxa datada. **O comportamento atual é o de
`USD` e continua igual** quando nenhuma moeda é informada: `tests/` passa sem alteração, e toda assinatura
antiga continua válida (os parâmetros novos têm padrão).

Códigos de moeda são `str` de três letras maiúsculas, comparados de forma exata (`"usd"` não vale).
Datas são `datetime.date`.

## Exceções (`pricing.errors`)

| Classe | Bases | Quando |
|---|---|---|
| `UnknownCurrencyError` | `PricingError` | código fora da tabela (R1) |
| `CurrencyMismatchError` | `PricingError` | moedas diferentes combinadas sem conversão |
| `InvalidRateError` | `PricingError`, `ValueError` | taxa inválida (R8) |
| `RateNotFoundError` | `PricingError` | sem taxa para o par na data (R9) |
| `MissingRuleError` | `PricingError` | moeda sem regra de frete (R19) |

As já existentes não mudam. O texto das mensagens é livre. Onde o SPEC não nomeia a exceção de um valor
malformado, vale a regra atual de `to_decimal` (`TypeError` para `float`/`bool`/tipo estranho,
`InvalidAmountError` para texto inválido ou não finito).

## Regras

### Moedas e arredondamento

**R1. Tabela de moedas.** O novo pacote `pricing.money` exporta `Currency`, `get_currency`, `Money`, `RateTable`
e `convert`. `get_currency(code)` devolve um `Currency` com `code`, `exponent` (casas), `rounding` e
`increment`; código que não é `str` ou não está na tabela levanta `UnknownCurrencyError`.

| Código | Casas | Modo | Incremento |
|---|---|---|---|
| `USD` | 2 | meio para cima (`ROUND_HALF_UP`) | |
| `BRL` | 2 | meio para cima | |
| `EUR` | 2 | meio para o par (`ROUND_HALF_EVEN`) | |
| `JPY` | 0 | para zero (`ROUND_DOWN`) | |
| `KWD` | 3 | meio para cima | |
| `CHF` | 2 | meio para cima | `0.05` |

`Currency.round(amount)` arredonda para o múltiplo do incremento mais próximo (no modo da moeda) e depois fixa
as casas; sem incremento, só fixa as casas. Exemplos: `EUR` 2.665 → `2.66`, 2.675 → `2.68`; `JPY` 1234.99 →
`1234`; `CHF` 10.02 → `10.00`, 10.025 → `10.05`, 10.07 → `10.05`.

**R2. `round_amount`.** `pricing.rounding.round_amount(amount, currency="USD")` arredonda pela moeda.
Moeda desconhecida levanta `UnknownCurrencyError`.

**R3. `check_precision`.** `check_precision(amount, currency="USD")` recusa com `InvalidAmountError` o valor
com mais casas decimais que o `exponent` da moeda (só as casas; o incremento não conta). `JPY` `100.5` é
recusado; `KWD` `1.234` passa; `USD` `1.001` é recusado.

### Money

**R4. `Money(amount, currency)`.** Objeto imutável (`frozen`). `amount` é lido por `to_decimal` (então `float`
e `bool` levantam `TypeError`) e **não é arredondado na construção**: `Money("1.005", "USD").amount` é
`Decimal("1.005")`. Moeda inválida levanta `UnknownCurrencyError`. `Money.zero(code)`; `m.rounded()` devolve um
`Money` arredondado pela moeda.

**R5. Aritmética.** `+`, `-` e negação unária devolvem `Money` sem arredondar. Somar ou subtrair moedas
diferentes levanta `CurrencyMismatchError`; operando que não é `Money` levanta `TypeError`. `sum([...])` de
`Money` funciona (o `0` inicial é aceito). `m * k` e `k * m` aceitam `int` e `Decimal`; `float`, `bool`, `Money`
e qualquer outro tipo levantam `TypeError`; sem arredondar.

**R6. Igualdade e ordem.** `==` compara moeda e valor (`Money("1.0","USD") == Money("1.00","USD")`); moedas
diferentes são **diferentes** (`False`, sem exceção); comparar com outro tipo dá `False`. Objetos iguais têm o
mesmo `hash`. `<`, `<=`, `>`, `>=` com moedas diferentes levantam `CurrencyMismatchError`, com outro tipo
`TypeError`.

### Taxas e conversão

**R7. `RateTable()`.** Tabela de taxas datadas, vazia no início.

**R8. `add_rate(base, quote, rate, on)`.** "1 `base` vale `rate` `quote` a partir de `on`". `rate` é lido por
`to_decimal`. Levanta `UnknownCurrencyError` (código desconhecido), `InvalidRateError` (`base == quote` ou
`rate <= 0`). Incluir de novo o mesmo par e a mesma data **substitui** a taxa.

**R9. `rate_for(base, quote, on)`.** Mesma moeda: `Decimal(1)`. Senão vale a taxa direta do par com a **maior
data não posterior a `on`**; só se o par direto não tiver nenhuma taxa até `on` usa-se a inversa
(`quote`→`base`, a mais recente até `on`), calculada como `Decimal(1) / taxa` com a precisão padrão do
`decimal`. A direta vence a inversa mesmo que a inversa seja mais recente. Não há triangulação por uma terceira
moeda. Sem taxa utilizável: `RateNotFoundError`. Moeda desconhecida: `UnknownCurrencyError`.

**R10. `convert(money, to, rates, on)`.** Moeda de destino desconhecida levanta `UnknownCurrencyError`. Se
`money.currency == to` devolve o próprio `money`, **sem arredondar**. Senão devolve
`Money(round(money.amount * rate), to)` com o arredondamento da moeda de destino (R1).

### Catálogo e carrinho

**R11. `Product`.** Ganha o campo `currency: str = "USD"` (por último), validado (R1). `unit_price` é checado
com `check_precision` da moeda do produto (`JPY` `"100.50"` levanta `InvalidAmountError`). Propriedade
`price` devolve `Money(unit_price, currency)`. As faixas de `PriceList` são expressas na moeda do produto.

**R12. `Cart`.** `Cart(pricelist=None, *, currency="USD", rates=None, on=None)`. A moeda tem de existir
(`UnknownCurrencyError`); `rates` e `on` só valem juntos, um sem o outro levanta `ValueError`. O carrinho expõe
`cart.currency`. `add` de produto cuja moeda difere da do carrinho: sem `rates`, levanta
`CurrencyMismatchError` e o carrinho não muda; com `rates`, o produto é aceito.

**R13. Preço da linha.** A faixa de quantidade é escolhida na moeda do produto, com a quantidade já somada
(mesclagem do mesmo SKU). Se a moeda difere, o **preço unitário** é convertido por `convert` na data `on` (e
fica arredondado na moeda do carrinho); só então multiplica-se pela quantidade e arredonda-se o total da linha.
Falta de taxa levanta `RateNotFoundError`.

**R14. `CartLine`.** Ganha `currency: str = "USD"` (último campo, com padrão); `total` arredonda na moeda da
linha. `Cart.subtotal()` soma os totais das linhas com início zero **na casa decimal da moeda do carrinho**
(carrinho vazio em `JPY`: `Decimal("0")`; em `EUR`: `Decimal("0.00")`).

### Descontos, imposto, frete

**R15. Descontos.** `Discount.amount(subtotal, currency="USD")` e
`total_discount(subtotal, discounts, currency="USD")` recebem a moeda. `FixedOff(value, currency="USD")` e
`SpendThreshold(min_subtotal, value, currency="USD")` pertencem a uma moeda: os valores são checados por
`check_precision` dela, e aplicá-los a uma quantia de outra moeda levanta `CurrencyMismatchError` (no momento do
cálculo). `PercentOff(percent)` vale em qualquer moeda e arredonda o corte pela moeda. `SpendThreshold` sem
desconto devolve zero na casa da moeda.

**R16. Imposto.** `compute_tax(taxable, region, customer_type=None, currency="USD")` arredonda pela moeda; para
cliente isento devolve zero na casa da moeda, depois de validar a região (como hoje).

**R17. Frete.** `shipping_cost(amount, currency="USD")`. Cada moeda tem a sua regra em
`config.SHIPPING_RULES` (`código → (tarifa, gratuito a partir de)`): `USD` 7.50/100.00, `EUR` 6.90/90.00,
`BRL` 25.00/300.00, `JPY` 800/12000. Valor zero ou na faixa gratuita (inclusive o limite) custa zero na casa da
moeda. Moeda desconhecida: `UnknownCurrencyError`; moeda conhecida sem regra (`KWD`, `CHF`):
`MissingRuleError`.

**R18. `Totals`.** Ganha `currency: str = "USD"` (último campo) e a propriedade `grand_total_money`
(`Money(grand_total, currency)`).

**R19. `compute_totals`.** Usa `cart.currency` em tudo. A ordem das verificações é: descontos, depois imposto
(região), depois frete. Logo, em carrinho `KWD` com região inexistente o erro é `UnknownRegionError`, e um
desconto em outra moeda vence qualquer erro de região ou de frete.

### Pedidos e relatórios

**R20. Pedido e cotação.** `Order.currency` é a moeda dos seus totais. `CheckoutService.quote(items, region,
discounts=(), customer_type=None, *, currency="USD", rates=None, on=None)` monta o carrinho com esses
parâmetros (R12). `checkout(cart, ...)` usa a moeda do carrinho.

**R21. `Ledger`.** `totals_by_currency()` devolve `dict` moeda → soma dos totais gerais, chaves em ordem
crescente de código, cada soma partindo de zero na casa da moeda. `total(currency=None)`: com moeda, a soma dela
(zero na casa da moeda se não há pedidos); sem moeda, só vale se o livro tem **no máximo uma** moeda
(zero `Decimal("0.00")` se vazio), senão `CurrencyMismatchError`. `total_in(currency, rates, on)` converte a
soma **de cada moeda uma única vez** (não pedido a pedido) e soma os resultados convertidos, que já vêm
arredondados na moeda de destino.

**R22. Fatura.** `format_amount(amount, currency=None)`: sem moeda, como hoje (`1,234.50`); com moeda,
`1,234.50 EUR` e, para `JPY`, `1,235 JPY` (casas e arredondamento da moeda). `render_invoice` de pedido `USD`
fica idêntico ao de hoje; de outra moeda, todos os valores levam o código.

**R23. Resumo.** `summarize(orders)` com moedas misturadas levanta `CurrencyMismatchError`; sem pedidos devolve
os zeros em `USD` como hoje. `summarize_by_currency(orders)` (novo, exportado por `pricing.reports`) devolve
moeda → o mesmo dicionário de `summarize`, chaves em ordem crescente.
