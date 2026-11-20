"""Dinheiro em unidades mínimas, com aritmética inteira exata."""

import re
from fractions import Fraction

from relkit.errors import ParseError
from relkit.types import CURRENCIES, Money
from relkit.util.numbers import div_round_half_even, div_round_half_up

_AMOUNT = re.compile(r"(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\Z")
_RATE = re.compile(r"(\d+)(?:\.(\d+))?%\Z")
_FX = re.compile(r"(\d+)(?:\.(\d{1,6}))?\Z")


def _fail(kind, text, reason):
    raise ParseError(kind, text, reason)


def parse_money(text: str) -> Money:
    parts = text.split()
    if len(parts) != 2:
        _fail("money", text, "expected 'CODE amount' or 'amount CODE'")
    first, second = parts
    code, amount = (first, second) if first[:1].isalpha() else (second, first)
    if code not in CURRENCIES:
        _fail("money", text, "unknown currency")
    match = _AMOUNT.match(amount)
    if not match:
        _fail("money", text, "bad amount")
    sign, whole, frac = match.groups()
    frac = frac or ""
    decimals = CURRENCIES[code]
    if len(frac) > decimals:
        _fail("money", text, "too many decimals")
    units = int(whole.replace(",", "")) * 10**decimals
    if decimals:
        units += int(frac.ljust(decimals, "0"))
    return Money(-units if sign else units, code)


def format_money(money: Money) -> str:
    decimals = money.decimals
    major, minor = divmod(abs(money.units), 10**decimals)
    body = f"{major:,}" + (f".{minor:0{decimals}d}" if decimals else "")
    return f"{money.currency} {'-' if money.units < 0 else ''}{body}"


def split_money(money: Money, weights) -> list:
    weights = list(weights)
    if not weights or any(
        isinstance(w, bool) or not isinstance(w, int) or w < 0 for w in weights
    ):
        raise ValueError("weights must be non-negative ints")
    total_weight = sum(weights)
    if total_weight == 0:
        raise ValueError("weights must not all be zero")
    amount = abs(money.units)
    shares = [amount * w // total_weight for w in weights]
    remainders = [amount * w % total_weight for w in weights]
    order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
    for i in order[: amount - sum(shares)]:
        shares[i] += 1
    sign = -1 if money.units < 0 else 1
    return [Money(s * sign, money.currency) for s in shares]


def _round(num: int, den: int, rounding: str) -> int:
    if rounding not in ("half_even", "half_up"):
        raise ValueError(f"unknown rounding {rounding!r}")
    if rounding == "half_up":
        return div_round_half_up(num, den)
    magnitude = div_round_half_even(abs(num), den)
    return -magnitude if num < 0 else magnitude


def apply_rate(money: Money, rate: str, rounding: str = "half_even") -> Money:
    match = _RATE.match(rate)
    if not match:
        _fail("rate", rate, "bad rate")
    whole, frac = match.groups()
    frac = frac or ""
    return Money(
        _round(money.units * int(whole + frac), 10 ** len(frac) * 100, rounding),
        money.currency,
    )


def convert(money: Money, to: str, rate: str, rounding: str = "half_even") -> Money:
    if to not in CURRENCIES:
        raise ValueError(f"unknown currency {to!r}")
    if to == money.currency:
        raise ValueError("same currency")
    match = _FX.match(rate)
    if not match:
        _fail("rate", rate, "bad rate")
    whole, frac = match.groups()
    frac = frac or ""
    number = int(whole + frac)
    if number == 0:
        _fail("rate", rate, "rate must be positive")
    value = Fraction(
        money.units * number * 10 ** CURRENCIES[to],
        10 ** len(frac) * 10**money.decimals,
    )
    return Money(_round(value.numerator, value.denominator, rounding), to)


def add(a: Money, b: Money) -> Money:
    if a.currency != b.currency:
        raise ValueError(f"currency mismatch: {a.currency} vs {b.currency}")
    return Money(a.units + b.units, a.currency)


def sum_money(items, currency: str) -> Money:
    total = Money(0, currency)
    for item in items:
        total = add(total, item)
    return total
