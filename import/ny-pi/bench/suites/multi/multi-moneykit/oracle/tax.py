def tax_cents(amount_cents: int, rate_bps: int) -> int:
    if amount_cents < 0 or rate_bps < 0:
        raise ValueError("negative")
    return (amount_cents * rate_bps + 5000) // 10000


def total_cents(amount_cents: int, rate_bps: int) -> int:
    return amount_cents + tax_cents(amount_cents, rate_bps)
