"""Conjunto padrão de projeções e seleção por agregado."""

from ..events.model import aggregate_kind
from .audit.counters import EventCounters
from .audit.last_seen import LastSeen
from .orders.status import OrderStatus
from .orders.totals import OrderTotals
from .stock.levels import StockLevels
from .stock.movements import StockMovements
from .stock.reservations import Reservations


def default_projections():
    """Instâncias novas de todas as projeções embutidas."""
    return [
        StockLevels(),
        Reservations(),
        StockMovements(),
        OrderStatus(),
        OrderTotals(),
        EventCounters(),
        LastSeen(),
    ]


def applicable_projections(projections, aggregate_id):
    """Projeções que atendem o agregado, na ordem da lista recebida."""
    kind = aggregate_kind(aggregate_id)
    return [p for p in projections if p.kind in ("*", kind)]
