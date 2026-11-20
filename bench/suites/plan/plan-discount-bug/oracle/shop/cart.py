from shop import pricing


class Cart:
    def __init__(self):
        self.items = []
        self.coupon = None

    def add(self, sku, qty, price_cents):
        self.items.append((sku, qty, price_cents))

    def subtotal_cents(self):
        return sum(pricing.line_total(q, p) for _, q, p in self.items)
