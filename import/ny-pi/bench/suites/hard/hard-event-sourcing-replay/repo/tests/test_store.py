import pytest
from helpers import ev
from stockflow.errors import InvalidEventError
from stockflow.store import InMemoryEventStore


def test_append_keeps_arrival_order_and_indexes():
    store = InMemoryEventStore()
    store.append(ev("e2", "sku:A", 2, "stock_received", {"qty": 1}))
    store.append(ev("e1", "sku:A", 1, "stock_received", {"qty": 1}))
    store.append(ev("e3", "sku:B", 1, "stock_received", {"qty": 1}))
    assert [e.event_id for e in store.all()] == ["e2", "e1", "e3"]
    assert [e.event_id for e in store.for_aggregate("sku:A")] == ["e2", "e1"]
    assert store.aggregate_ids() == ["sku:A", "sku:B"]
    assert len(store) == 3


def test_invalid_event_is_rejected():
    store = InMemoryEventStore()
    with pytest.raises(InvalidEventError):
        store.append(ev("", "sku:A", 1, "stock_received"))
    with pytest.raises(InvalidEventError):
        store.append(ev("e1", "nokind", 1, "stock_received"))
    with pytest.raises(InvalidEventError):
        store.append(ev("e1", "sku:A", 0, "stock_received"))
    assert len(store) == 0


def test_unknown_aggregate_has_no_events():
    assert InMemoryEventStore().for_aggregate("sku:X") == []
