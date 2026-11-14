from ingest.errors import ValidationError


def check(rec):
    if not rec["name"]:
        raise ValidationError("name is empty")
    if rec["qty"] <= 0:
        raise ValidationError("qty must be positive")
    if rec["price"] < 0:
        raise ValidationError("price must be non-negative")
    return rec
