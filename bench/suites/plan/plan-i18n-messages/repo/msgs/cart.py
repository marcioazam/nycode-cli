def checkout(items):
    if not items:
        raise ValueError("Cart is empty")
    return sum(items)
