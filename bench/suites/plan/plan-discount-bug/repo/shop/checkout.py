from shop import coupons, pricing


def total_cents(cart):
    sub = cart.subtotal_cents()
    if cart.coupon:
        sub = coupons.apply(sub, cart.coupon)
    return sub + pricing.tax_cents(sub)
