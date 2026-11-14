from ingest.errors import ParseError


def parse_line(s):
    parts = s.strip().split(":")
    if len(parts) != 3:
        raise ParseError("malformed")
    name, qty, price = parts
    try:
        return {"name": name.strip(), "qty": int(qty), "price": int(price)}
    except ValueError:
        raise ParseError("malformed") from None
