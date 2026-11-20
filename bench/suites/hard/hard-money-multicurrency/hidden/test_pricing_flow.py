from datetime import date
from decimal import Decimal as D

import pytest
from pricing import config
from pricing.cart import Cart, CartLine, Totals, compute_totals
from pricing.catalog import Catalog, PriceList, Product
from pricing.discounts import FixedOff, PercentOff, SpendThreshold, total_discount
from pricing.errors import (
    CurrencyMismatchError,
    InvalidAmountError,
    MissingRuleError,
    RateNotFoundError,
    UnknownCurrencyError,
    UnknownRegionError,
)
from pricing.money import Money, RateTable
from pricing.orders import CheckoutService
from pricing.reports import (
    format_amount,
    render_invoice,
    summarize,
    summarize_by_currency,
)
from pricing.shipping import shipping_cost
from pricing.tax import compute_tax

D1 = date(2024, 1, 1)
D2 = date(2024, 6, 1)


def rates():
    t = RateTable()
    t.add_rate("USD", "EUR", "0.9", D1)
    t.add_rate("USD", "EUR", "0.95", D2)
    t.add_rate("USD", "JPY", "150", D1)
    t.add_rate("EUR", "BRL", "5.5", D1)
    return t


def test_r11_product_currency():
    p = Product("A", "Alpha", "10.50", currency="EUR")
    assert p.currency == "EUR" and p.price == Money("10.50", "EUR")
    assert Product("B", "Beta", "1").currency == "USD"
    with pytest.raises(InvalidAmountError):
        Product("J", "Jen", "100.50", currency="JPY")
    assert Product("J", "Jen", "100", currency="JPY").unit_price == D(100)
    with pytest.raises(UnknownCurrencyError):
        Product("X", "Ex", "1", currency="XXX")


def test_r12_cart_construction():
    assert Cart().currency == "USD" and Cart(currency="EUR").currency == "EUR"
    with pytest.raises(UnknownCurrencyError):
        Cart(currency="eur")
    with pytest.raises(ValueError):
        Cart(currency="EUR", rates=rates())
    with pytest.raises(ValueError):
        Cart(currency="EUR", on=D1)
    cart = Cart(currency="EUR")
    cart.add(Product("A", "Alpha", "2.00", currency="EUR"))
    with pytest.raises(CurrencyMismatchError):
        cart.add(Product("B", "Beta", "1.00"))
    assert [ln.product.sku for ln in cart.lines] == ["A"]


def test_r13_conversion_per_unit_then_quantity():
    cart = Cart(currency="EUR", rates=rates(), on=D1)
    line = cart.add(Product("W", "Widget", "0.55"), 3)
    assert line.unit_price == D("0.50")  # 0.495 meio-par -> 0.50 (par)
    assert line.total == D("1.50") and line.currency == "EUR"
    cart.add(Product("E", "Euro", "1.10", currency="EUR"), 1)
    assert cart.subtotal() == D("2.60")
    c2 = Cart(currency="EUR", rates=rates(), on=D2)
    assert c2.add(Product("W", "Widget", "0.55"), 3).unit_price == D("0.52")  # 0.5225
    c3 = Cart(currency="JPY", rates=rates(), on=D1)
    ln = c3.add(Product("W", "Widget", "0.99"), 7)
    assert ln.unit_price == D(148) and ln.total == D(1036)  # 148.5 para zero
    with pytest.raises(RateNotFoundError):
        Cart(currency="BRL", rates=rates(), on=D1).add(Product("W", "Widget", "1"))
    with pytest.raises(RateNotFoundError):
        Cart(currency="EUR", rates=rates(), on=date(2023, 1, 1)).add(
            Product("W", "Widget", "1")
        )


def test_r13_tiers_in_product_currency_and_merge():
    pl = PriceList()
    pl.set_tiers("W", [(1, "10.00"), (5, "8.00")])
    cart = Cart(pl, currency="EUR", rates=rates(), on=D1)
    w = Product("W", "Widget", "10.00")
    assert cart.add(w, 3).unit_price == D("9.00")
    line = cart.add(w, 2)  # 5 unidades: faixa de 8.00 USD -> 7.20 EUR
    assert (
        line.quantity == 5 and line.unit_price == D("7.20") and line.total == D("36.00")
    )


def test_r14_line_and_subtotal_scale():
    assert CartLine(
        Product("J", "J", "1", currency="JPY"), 3, D("10.7"), "JPY"
    ).total == D(32)
    assert CartLine(Product("A", "A", "1"), 2, D("1.005")).currency == "USD"
    assert str(Cart(currency="JPY").subtotal()) == "0"
    assert str(Cart(currency="EUR").subtotal()) == "0.00"
    assert str(Cart(currency="KWD").subtotal()) == "0.000"
    assert str(Cart().subtotal()) == "0.00"


def test_r15_discounts_by_currency():
    with pytest.raises(InvalidAmountError):
        FixedOff("10.5", "JPY")
    with pytest.raises(InvalidAmountError):
        SpendThreshold("100.123", "5", "EUR")
    assert FixedOff("5", "EUR").amount(D("20.00"), "EUR") == D(5)
    with pytest.raises(CurrencyMismatchError):
        FixedOff("5").amount(D("20.00"), "EUR")
    with pytest.raises(CurrencyMismatchError):
        total_discount(D("20.00"), [FixedOff("5", "EUR")])
    assert PercentOff(10).amount(D(1055), "JPY") == D(105)
    assert PercentOff("12.5").amount(D("0.10"), "EUR") == D("0.01")  # 0.0125 -> 0.01
    th = SpendThreshold("100", "10", "JPY")
    assert str(th.amount(D(99), "JPY")) == "0"
    assert th.amount(D(100), "JPY") == D(10)
    with pytest.raises(CurrencyMismatchError):
        th.amount(D(100), "USD")
    assert total_discount(
        D("30.00"), [FixedOff("25", "EUR"), PercentOff(50)], "EUR"
    ) == D("27.50")
    assert total_discount(D("10.00"), [FixedOff("25", "EUR")], "EUR") == D("10.00")


def test_r16_tax_per_currency():
    assert compute_tax(D(100), "DE", None, "JPY") == D(19)
    assert compute_tax(D("10.05"), "US-NY", currency="EUR") == D("0.89")  # 0.8919
    assert compute_tax(D("0.25"), "JP", None, "EUR") == D("0.02")  # 0.025 meio-par
    assert compute_tax(D("0.25"), "JP") == D("0.03")
    assert str(compute_tax(D(100), "DE", "nonprofit", "JPY")) == "0"
    assert str(compute_tax(D(100), "DE", "reseller")) == "0.00"
    with pytest.raises(UnknownRegionError):
        compute_tax(D(100), "MARS", "nonprofit", "EUR")
    assert compute_tax(D("10.00"), "TAX-FREE") == D("0.00")


def test_r17_shipping_rules():
    assert "EUR" in config.SHIPPING_RULES
    assert shipping_cost(D("50.00"), "EUR") == D("6.90")
    assert shipping_cost(D("90.00"), "EUR") == D("0.00")
    assert shipping_cost(D("299.99"), "BRL") == D("25.00")
    assert shipping_cost(D("300.00"), "BRL") == D("0.00")
    assert shipping_cost(D(11999), "JPY") == D(800)
    assert str(shipping_cost(D(12000), "JPY")) == "0"
    assert str(shipping_cost(D(0), "JPY")) == "0"
    assert shipping_cost(D("99.99")) == D("7.50")
    for code in ("KWD", "CHF"):
        with pytest.raises(MissingRuleError):
            shipping_cost(D(1), code)
    with pytest.raises(UnknownCurrencyError):
        shipping_cost(D(1), "XXX")


def test_r18_r19_totals():
    cart = Cart(currency="EUR")
    cart.add(Product("A", "Alpha", "30.05", currency="EUR"), 2)
    t = compute_totals(cart, "DE", [PercentOff(10)], None)
    assert (t.subtotal, t.discount, t.tax, t.shipping) == (
        D("60.10"),
        D("6.01"),
        D("10.28"),
        D("6.90"),
    )
    assert t.currency == "EUR" and t.grand_total == D("71.27")
    assert t.grand_total_money == Money("71.27", "EUR")
    assert Totals(D(1), D(0), D(0), D(0)).currency == "USD"


def test_r19_error_order():
    kwd = Cart(currency="KWD")
    kwd.add(Product("K", "Kay", "1.500", currency="KWD"))
    with pytest.raises(UnknownRegionError):
        compute_totals(kwd, "MARS")
    with pytest.raises(MissingRuleError):
        compute_totals(kwd, "DE")
    eur = Cart(currency="EUR")
    eur.add(Product("A", "Alpha", "5.00", currency="EUR"))
    with pytest.raises(CurrencyMismatchError):
        compute_totals(eur, "MARS", [FixedOff("1")])
    jpy = Cart(currency="JPY")
    jpy.add(Product("J", "Jen", "1000", currency="JPY"))
    t = compute_totals(jpy, "JP")
    assert (t.tax, t.shipping, t.grand_total) == (D(100), D(800), D(1900))


def make_service():
    cat = Catalog()
    cat.add(Product("W", "Widget", "10.00"))
    cat.add(Product("G", "Gadget", "7.25", currency="EUR"))
    return CheckoutService(cat)


def test_r20_quote_and_checkout():
    svc = make_service()
    q = svc.quote({"W": 3}, "DE", currency="EUR", rates=rates(), on=D1)
    assert (
        q.currency == "EUR"
        and q.subtotal == D("27.00")
        and q.tax == D("5.13")
        and q.shipping == D("6.90")
    )
    with pytest.raises(CurrencyMismatchError):
        svc.quote({"G": 1}, "DE")
    with pytest.raises(ValueError):
        svc.quote({"W": 1}, "DE", currency="EUR", rates=rates())
    cart = Cart(currency="EUR")
    cart.add(svc.catalog.get("G"), 2)
    order = svc.checkout(cart, "DE")
    assert order.currency == "EUR" and order.totals.subtotal == D("14.50")
    assert svc.ledger.total("EUR") == order.totals.grand_total


def eur_order(svc, amount):
    cart = Cart(currency="EUR")
    cart.add(Product("X", "X", amount, currency="EUR"))
    return svc.checkout(cart, "TAX-FREE")


def test_r21_ledger():
    svc = make_service()
    led = svc.ledger
    assert led.total() == D("0.00") and led.totals_by_currency() == {}
    assert str(led.total("JPY")) == "0"
    cart = Cart(currency="JPY")
    cart.add(Product("J", "J", "1000", currency="JPY"))
    svc.checkout(cart, "JP")
    assert led.total() == D(1900)
    eur_order(svc, "100.00")
    cart = Cart()
    cart.add(Product("U", "U", "50.00"))
    svc.checkout(cart, "TAX-FREE")
    by = led.totals_by_currency()
    assert (
        list(by) == ["EUR", "JPY", "USD"]
        and by["EUR"] == D("100.00")
        and by["USD"] == D("57.50")
    )
    with pytest.raises(CurrencyMismatchError):
        led.total()
    assert led.total("USD") == by["USD"] and led.total("EUR") == D("100.00")


def _valor(x):
    return getattr(x, "amount", x)


def test_r21_total_in_converts_each_currency_once():
    svc = make_service()
    for _ in range(3):
        eur_order(svc, "0.10")  # 3 x (0.10 + 6.90 frete)
    t = RateTable()
    t.add_rate("EUR", "USD", "1.005", D1)
    sums = svc.ledger.totals_by_currency()
    assert sums == {"EUR": D("21.00")}
    assert _valor(svc.ledger.total_in("USD", t, D1)) == D(
        "21.11"
    )  # 21.105 meio para cima; por pedido seria 21.12
    cart = Cart()
    cart.add(Product("U", "U", "1.00"))
    svc.checkout(cart, "TAX-FREE")
    assert _valor(svc.ledger.total_in("USD", t, D1)) == D("21.11") + D("8.50")
    assert _valor(svc.ledger.total_in("EUR", t, D1)) == D("21.00") + D(
        "8.46"
    )  # 8.50 / 1.005 = 8.457
    with pytest.raises(RateNotFoundError):
        svc.ledger.total_in("JPY", t, D1)


def test_r22_invoice_and_format():
    assert format_amount(D("1234.5")) == "1,234.50"
    assert format_amount(D("1234.5"), "EUR") == "1,234.50 EUR"
    assert format_amount(D("1235.9"), "JPY") == "1,235 JPY"
    assert format_amount(D("1234.5"), "USD") == "1,234.50 USD"
    assert format_amount(D("2.665"), "EUR") == "2.66 EUR"
    with pytest.raises(UnknownCurrencyError):
        format_amount(D(1), "XXX")
    svc = make_service()
    cart = Cart()
    cart.add(Product("U", "Uno", "20.00"), 2)
    usd = render_invoice(svc.checkout(cart, "US-CA", [PercentOff(10)]))
    assert usd == [
        "Invoice ORD-0001",
        "2 x Uno @ 20.00 = 40.00",
        "Subtotal: 40.00",
        "Discount: -4.00",
        "Tax: 2.61",
        "Shipping: 7.50",
        "Total: 46.11",
    ]
    cart = Cart(currency="JPY")
    cart.add(Product("J", "Jen", "1500", currency="JPY"), 2)
    jpy = render_invoice(svc.checkout(cart, "JP"))
    assert jpy == [
        "Invoice ORD-0002",
        "2 x Jen @ 1,500 JPY = 3,000 JPY",
        "Subtotal: 3,000 JPY",
        "Tax: 300 JPY",
        "Shipping: 800 JPY",
        "Total: 4,100 JPY",
    ]


def test_r23_summaries():
    assert summarize([]) == {"count": 0, "revenue": D("0.00"), "tax": D("0.00")}
    svc = make_service()
    o1 = eur_order(svc, "100.00")
    o2 = eur_order(svc, "10.00")
    assert summarize([o1, o2]) == {"count": 2, "revenue": D("116.90"), "tax": D("0.00")}
    cart = Cart(currency="JPY")
    cart.add(Product("J", "J", "1000", currency="JPY"))
    o3 = svc.checkout(cart, "JP")
    with pytest.raises(CurrencyMismatchError):
        summarize([o1, o3])
    by = summarize_by_currency([o3, o1, o2])
    assert list(by) == ["EUR", "JPY"]
    assert by["JPY"] == {"count": 1, "revenue": D(1900), "tax": D(100)}
    assert by["EUR"]["count"] == 2 and summarize_by_currency([]) == {}


def test_legacy_usd_behavior_unchanged():
    cart = Cart()
    cart.add(Product("W", "Widget", "10.00"), 2)
    totals = compute_totals(cart, "US-CA", [PercentOff(10)])
    assert (totals.discount, totals.tax, totals.shipping, totals.grand_total) == (
        D("2.00"),
        D("1.31"),
        D("7.50"),
        D("26.81"),
    )
    assert totals.currency == "USD" and cart.currency == "USD"
    assert FixedOff("5").amount(D("20.00")) == D("5.00")
    assert shipping_cost(D("100.00")) == D("0.00")
    with pytest.raises(TypeError):
        Product("F", "F", 1.5)
