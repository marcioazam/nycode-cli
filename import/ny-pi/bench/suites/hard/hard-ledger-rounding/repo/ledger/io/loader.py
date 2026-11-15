"""Carrega lançamentos de registros (dicts)."""

from decimal import Decimal

from ledger.model.entry import Entry
from ledger.model.journal import Journal
from ledger.util.dates import parse_date


def _dec(value) -> Decimal:
    if isinstance(value, float):
        raise TypeError("float não é aceito; use str ou Decimal")
    return Decimal(str(value))


def load_records(records: list[dict]) -> Journal:
    journal = Journal()
    for r in records:
        parse_date(r["date"])
        journal.add(
            Entry(
                id=r["id"],
                account=r.get("account", "main"),
                kind=r["kind"],
                amount=_dec(r["amount"]),
                currency=r["currency"],
                date=r["date"],
                tax_rate=_dec(r.get("tax_rate", "0")),
                memo=r.get("memo", ""),
            )
        )
    return journal
