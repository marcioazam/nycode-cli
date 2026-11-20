import pytest
from hh import build, ev, recv
from stockflow.errors import ConflictingEventError, InvalidEventError, StockflowError
from stockflow.store import InMemoryEventStore


def test_error_classes():
    assert issubclass(ConflictingEventError, StockflowError)
    from stockflow.errors import InvalidSnapshotError, SnapshotMismatchError

    assert issubclass(SnapshotMismatchError, StockflowError)
    assert issubclass(InvalidSnapshotError, (StockflowError, ValueError))


def test_r1_exact_duplicate_ignored():
    store = build([recv("e1", "sku:A", 1), recv("e2", "sku:A", 2)])
    store.append(recv("e1", "sku:A", 1))
    assert len(store) == 2 and [e.event_id for e in store.all()] == ["e1", "e2"]
    assert len(store.for_aggregate("sku:A")) == 2


def test_r2_conflicts_and_validation_first():
    store = build([recv("e1", "sku:A", 1, qty=5)])
    with pytest.raises(ConflictingEventError):
        store.append(recv("e1", "sku:A", 1, qty=6))  # mesmo id, payload diferente
    with pytest.raises(ConflictingEventError):
        store.append(recv("e1", "sku:B", 1))  # mesmo id, outro agregado
    with pytest.raises(ConflictingEventError):
        store.append(recv("e9", "sku:A", 1))  # mesma sequência, outro id
    with pytest.raises(InvalidEventError):
        store.append(
            ev("e1", "nokind", 1, "stock_received")
        )  # inválido vence o conflito
    store.append(recv("e9", "sku:B", 1))  # mesma sequência em outro agregado é válida
    assert len(store) == 2 and store.aggregate_ids() == ["sku:A", "sku:B"]


def test_r3_extend_keeps_events_before_the_error():
    store = InMemoryEventStore()
    batch = [
        recv("e1", "sku:A", 1),
        recv("e1", "sku:A", 1),
        recv("e2", "sku:A", 2),
        recv("e3", "sku:A", 2),
        recv("e4", "sku:A", 4),
    ]
    with pytest.raises(ConflictingEventError):
        store.extend(batch)
    assert [e.event_id for e in store.all()] == ["e1", "e2"]


def test_r4_events_from():
    store = build(
        [recv("e1", "sku:A", 1), recv("e2", "sku:A", 2), recv("e3", "sku:B", 1)]
    )
    store.append(recv("e2", "sku:A", 2))  # repetida não ocupa posição
    assert [e.event_id for e in store.events_from(1)] == ["e2", "e3"]
    assert store.events_from(3) == [] and store.events_from(0) == store.all()
    out = store.events_from(0)
    out.clear()
    assert len(store.events_from(0)) == 3
    for bad in (-1, 4, "1", 1.0, None):
        with pytest.raises(ValueError):
            store.events_from(bad)
