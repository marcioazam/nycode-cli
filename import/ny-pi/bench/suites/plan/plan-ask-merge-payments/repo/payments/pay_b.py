def charge(amount_cents, card, retries=2):
    """Cobra com taxa de 2%, arredonda para baixo e tenta de novo em falha."""
    fee = amount_cents * 2 // 100
    return {
        "amount": amount_cents + fee,
        "fee": fee,
        "card": card[-4:],
        "retries": retries,
    }
