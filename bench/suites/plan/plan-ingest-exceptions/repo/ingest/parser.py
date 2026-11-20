def parse_line(s):
    parts = s.strip().split(":")
    if len(parts) != 3:
        return None
    name, qty, price = parts
    try:
        return {"name": name.strip(), "qty": int(qty), "price": int(price)}
    except ValueError:
        return None
