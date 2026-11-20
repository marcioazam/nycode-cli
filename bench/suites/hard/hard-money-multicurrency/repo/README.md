# pricing

Motor de preços em Python (só biblioteca padrão): catálogo, carrinho, descontos, impostos, frete, pedidos e
relatórios. Hoje todo valor é um `Decimal` em uma única moeda implícita (dólar, duas casas, arredondamento
meio-para-cima). A mudança planejada para várias moedas está em `docs/SPEC.md`.

## Mapa

| Caminho | Papel |
|---|---|
| `pricing/errors.py` | hierarquia de exceções (`PricingError` e filhas) |
| `pricing/rounding.py` | `to_decimal`, `round_amount`, `check_precision` |
| `pricing/config.py` | alíquotas por região, isenções, regra de frete |
| `pricing/catalog/` | `Product`, `Catalog`, `PriceList` (faixas por quantidade) |
| `pricing/cart/` | `Cart`, `CartLine`, `Totals`, `compute_totals` |
| `pricing/discounts/` | `FixedOff`, `PercentOff`, `SpendThreshold`, `total_discount` |
| `pricing/tax/` | `compute_tax`, `rate_for_region`, `is_exempt` |
| `pricing/shipping/` | `shipping_cost` |
| `pricing/orders/` | `Order`, `Ledger`, `CheckoutService` |
| `pricing/reports/` | `render_invoice`, `format_amount`, `summarize` |

## Fluxo

`compute_totals(cart, region, discounts, customer_type)`: o subtotal é a soma dos totais das linhas; os descontos
são aplicados em ordem, cada um sobre o que ainda resta; imposto e frete incidem sobre o valor já descontado.
`Totals.grand_total = subtotal - discount + tax + shipping`.

Entradas monetárias aceitam `Decimal`, `int` e `str`; `float` e `bool` são recusados com `TypeError`.

## Testes

```bash
python3 -m pytest -q -p no:cacheprovider tests
```
