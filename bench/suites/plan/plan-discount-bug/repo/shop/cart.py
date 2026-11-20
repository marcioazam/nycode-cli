from shop import coupons, pricing


class Cart:
    def __init__(self):
        self.items = []
        self.coupon = None

    def add(self, sku, qty, price_cents):
        self.items.append((sku, qty, price_cents))

    def subtotal_cents(self):
        s = sum(pricing.line_total(q, p) for _, q, p in self.items)
        if self.coupon:
            s = coupons.apply(s, self.coupon)
        return s
