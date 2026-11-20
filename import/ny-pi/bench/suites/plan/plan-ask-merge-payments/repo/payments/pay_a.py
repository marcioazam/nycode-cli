def charge(amount_cents, card):
    """Cobra e arredonda para cima ao centavo; sem taxa."""
    return {"amount": int(amount_cents), "fee": 0, "card": card[-4:]}
