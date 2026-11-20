from shop import checkout


def receipt(cart):
    sub = cart.subtotal_cents()
    total = checkout.total_cents(cart)
    return [f"Subtotal: {sub / 100:.2f}", f"Total: {total / 100:.2f}"]
