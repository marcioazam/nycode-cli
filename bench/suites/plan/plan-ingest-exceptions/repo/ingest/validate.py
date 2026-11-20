def check(rec):
    if not rec["name"]:
        return "name is empty"
    if rec["qty"] <= 0:
        return "qty must be positive"
    if rec["price"] < 0:
        return "price must be non-negative"
    return None
