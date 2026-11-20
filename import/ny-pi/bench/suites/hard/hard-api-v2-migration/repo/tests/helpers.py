"""Dados de teste."""

from datetime import date

TODAY = date(2024, 3, 10)


def raw(id="T-1", **changes):
    data = {
        "id": id,
        "customer": {"name": "Ana Souza", "email": "ana@example.com"},
        "subject": "Printer on fire",
        "created": "2024-03-09",
    }
    data.update(changes)
    return data
