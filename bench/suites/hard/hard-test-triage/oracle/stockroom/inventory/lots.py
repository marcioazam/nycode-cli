"""Lotes com validade e consumo FEFO (SPEC 4)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from stockroom.errors import InsufficientStock, ValidationError
from stockroom.inventory.ledger import check_qty


@dataclass
class Lot:
    lot_id: str
    sku: str
    qty: int
    expiry: str | None  # AAAA-MM-DD ou None (sem validade)
    seq: int


@dataclass(frozen=True)
class Pick:
    lot_id: str
    qty: int
    expiry: str | None


def check_expiry(expiry: str | None) -> str | None:
    if expiry is None:
        return None
    try:
        return date.fromisoformat(expiry).isoformat()
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"validade inválida: {expiry!r}") from exc


class LotBook:
    def __init__(self) -> None:
        self._lots: list[Lot] = []
        self._seq = 0

    def receive(self, sku: str, qty: int, expiry: str | None = None) -> Lot:
        check_qty(qty)
        expiry = check_expiry(expiry)
        self._seq += 1
        lot = Lot(f"L{self._seq:04d}", sku, qty, expiry, self._seq)
        self._lots.append(lot)
        return lot

    def total(self, sku: str) -> int:
        return sum(lot.qty for lot in self._lots if lot.sku == sku)

    def open_lots(self, sku: str) -> list[Lot]:
        """Lotes com saldo, na ordem em que serão consumidos."""
        lots = [lot for lot in self._lots if lot.sku == sku and lot.qty > 0]
        return sorted(
            lots, key=lambda lot: (lot.expiry is None, lot.expiry or "", lot.seq)
        )

    def consume(self, sku: str, qty: int) -> list[Pick]:
        check_qty(qty)
        if qty > self.total(sku):
            raise InsufficientStock(f"{sku}: lotes insuficientes para {qty}")
        picks: list[Pick] = []
        for lot in self.open_lots(sku):
            if qty == 0:
                break
            take = min(lot.qty, qty)
            lot.qty -= take
            qty -= take
            picks.append(Pick(lot.lot_id, take, lot.expiry))
        return picks
