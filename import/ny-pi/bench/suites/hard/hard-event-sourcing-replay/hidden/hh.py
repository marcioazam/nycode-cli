"""Apoio dos testes ocultos."""

import random

from stockflow.events.model import Event
from stockflow.projections import default_projections
from stockflow.store import InMemoryEventStore


def ev(event_id, aggregate_id, sequence, type, payload=None, timestamp=None):
    return Event(
        event_id,
        aggregate_id,
        sequence,
        sequence if timestamp is None else timestamp,
        type,
        {} if payload is None else payload,
    )


def recv(i, agg, seq, qty=5):
    return ev(i, agg, seq, "stock_received", {"qty": qty})


def build(events):
    store = InMemoryEventStore()
    store.extend(events)
    return store


class CountingStore(InMemoryEventStore):
    def __init__(self):
        super().__init__()
        self.aggregate_reads = []

    def for_aggregate(self, aggregate_id):
        self.aggregate_reads.append(aggregate_id)
        return super().for_aggregate(aggregate_id)


def counting_projections():
    """Projeções padrão cujo apply registra (nome, evento)."""
    calls = []
    projections = default_projections()
    for projection in projections:

        def wrap(p=projection, orig=projection.apply):
            def apply(state, event):
                calls.append((p.name, event.event_id))
                return orig(state, event)

            p.apply = apply

        wrap()
    return projections, calls


def random_events(seed, count=60):
    rng = random.Random(seed)
    seqs = {}
    out = []
    aggregates = ["sku:A", "sku:B", "sku:C", "order:1", "order:2"]
    for n in range(count):
        agg = rng.choice(aggregates)
        seqs[agg] = seqs.get(agg, 0) + 1
        seq = seqs[agg]
        if agg.startswith("sku:"):
            kind = rng.choice(
                [
                    "stock_received",
                    "stock_counted",
                    "stock_adjusted",
                    "stock_reserved",
                    "stock_released",
                    "stock_shipped",
                    "mystery",
                ]
            )
            qty = rng.randint(1, 9)
            rid = "r%d" % rng.randint(1, 3)  # noqa: UP031
            payload = {"stock_adjusted": {"delta": rng.randint(-9, 9)}}.get(
                kind, {"qty": qty, "reservation_id": rid}
            )
        else:
            kind = rng.choice(
                [
                    "order_placed",
                    "order_line_added",
                    "order_line_removed",
                    "order_paid",
                    "order_shipped",
                    "order_cancelled",
                    "mystery",
                ]
            )
            sku = rng.choice("XYZ")
            payload = {
                "lines": [{"sku": sku, "qty": 2, "unit_cents": 100}],
                "sku": sku,
                "qty": rng.randint(1, 4),
                "unit_cents": rng.randint(50, 400),
            }
        out.append(ev("e%d" % n, agg, seq, kind, payload, timestamp=rng.randint(0, 99)))  # noqa: UP031
    return out
