def line_total(qty, price_cents):
    total = qty * price_cents
    if qty >= 10:
        total = total * 9 // 10
    return total


def tax_cents(amount):
    return (amount * 10 + 50) // 100
