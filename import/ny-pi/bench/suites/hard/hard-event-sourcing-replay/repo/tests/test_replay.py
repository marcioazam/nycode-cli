from helpers import ev
from stockflow.replay import replay_aggregate, replay_all
from stockflow.store import InMemoryEventStore


def make_store():
    store = InMemoryEventStore()
    store.extend(
        [
            ev("e1", "sku:A", 1, "stock_received", {"qty": 10}),
            ev("e2", "sku:A", 2, "stock_reserved", {"qty": 4, "reservation_id": "r1"}),
            ev("e3", "sku:A", 3, "stock_shipped", {"qty": 4, "reservation_id": "r1"}),
            ev(
                "o1",
                "order:1",
                1,
                "order_placed",
                {"lines": [{"sku": "A", "qty": 2, "unit_cents": 150}]},
            ),
            ev("o2", "order:1", 2, "order_paid"),
        ]
    )
    return store


def test_replay_all_state():
    state = replay_all(make_store())
    assert state["sku:A"]["levels"] == {"on_hand": 6, "reserved": 0}
    assert state["sku:A"]["reservations"] == {"open": set(), "closed": {"r1"}}
    assert state["sku:A"]["movements"]["count"] == 2
    assert state["order:1"]["status"]["status"] == "paid"
    assert state["order:1"]["totals"] == {"lines": {"A": (2, 150)}, "total_cents": 300}
    assert state["order:1"]["counters"]["events"] == 2


def test_out_of_order_arrival_is_sorted_by_sequence():
    store = InMemoryEventStore()
    store.append(ev("e2", "sku:A", 2, "stock_counted", {"qty": 3}))
    store.append(ev("e1", "sku:A", 1, "stock_received", {"qty": 10}))
    assert replay_aggregate(store, "sku:A")["levels"]["on_hand"] == 3


def test_unknown_types_are_skipped_but_aggregate_exists():
    store = InMemoryEventStore()
    store.append(ev("x1", "sku:Z", 1, "mystery"))
    state = replay_all(store)
    assert state["sku:Z"]["levels"] == {"on_hand": 0, "reserved": 0}
    assert state["sku:Z"]["counters"]["events"] == 0
    assert replay_aggregate(store, "sku:none") == {}


def test_replay_does_not_share_state_between_calls():
    store = make_store()
    first = replay_all(store)
    first["sku:A"]["levels"]["on_hand"] = 999
    assert replay_all(store)["sku:A"]["levels"]["on_hand"] == 6
