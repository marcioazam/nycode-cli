from payments import pay_a, pay_b


def pay(amount_cents, card, provider="a"):
    mod = pay_a if provider == "a" else pay_b
    return mod.charge(amount_cents, card)
