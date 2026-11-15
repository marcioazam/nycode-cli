import copy

import pytest
from hh import CountingStore, build, counting_projections, ev, recv
from stockflow.errors import SnapshotMismatchError
from stockflow.projections import default_projections
from stockflow.replay import replay_all
from stockflow.snapshots import (
    AggregateSnapshot,
    Snapshot,
    replay_from,
    snapshot_state,
    take_snapshot,
    update_snapshot,
)


def sample_events():
    return [
        recv("a1", "sku:A", 1, 10),
        ev("a2", "sku:A", 2, "stock_reserved", {"qty": 4, "reservation_id": "r1"}),
        ev(
            "o1",
            "order:1",
            1,
            "order_placed",
            {"lines": [{"sku": "A", "qty": 2, "unit_cents": 150}]},
        ),
        recv("b1", "sku:B", 1, 7),
    ]


def test_r5_r6_snapshot_shape_and_empty():
    empty = take_snapshot(build([]))
    assert (empty.position, empty.head_event_id, empty.aggregates) == (0, None, {})
    snap = take_snapshot(build(sample_events()))
    assert (
        isinstance(snap, Snapshot) and snap.position == 4 and snap.head_event_id == "b1"
    )
    assert snap.projections == tuple(p.name for p in default_projections())
    agg = snap.aggregates["sku:A"]
    assert isinstance(agg, AggregateSnapshot) and agg.last_sequence == 2
    assert set(agg.state) == {
        "levels",
        "reservations",
        "movements",
        "counters",
        "last_seen",
    }
    assert set(snap.aggregates["order:1"].state) == {
        "status",
        "totals",
        "counters",
        "last_seen",
    }
    with pytest.raises(Exception):  # noqa: B017
        snap.position = 9
    assert snapshot_state(snap) == replay_all(build(sample_events()))


def test_r7_invariant_for_every_prefix():
    events = sample_events()
    full = replay_all(build(events))
    for cut in range(len(events) + 1):
        store = build(events[:cut])
        snap = take_snapshot(store)
        store.extend(events[cut:])
        assert snapshot_state(update_snapshot(store, snap)) == full
        assert update_snapshot(store, snap) == take_snapshot(store)
        assert replay_from(store, snap) == full


def test_r8_snapshot_state_is_a_deep_copy():
    snap = take_snapshot(build(sample_events()))
    state = snapshot_state(snap)
    state["sku:A"]["levels"]["on_hand"] = 999
    state["sku:A"]["reservations"]["open"].add("zzz")
    assert snapshot_state(snap)["sku:A"]["levels"]["on_hand"] == 10
    assert snap.aggregates["sku:A"].state["reservations"]["open"] == {"r1"}


def test_r10_late_event_refolds_only_that_aggregate():
    store = CountingStore()
    store.extend(
        [
            recv("a1", "sku:A", 1, 10),
            recv("a3", "sku:A", 3, 1),
            recv("b1", "sku:B", 1, 2),
            ev("c1", "sku:C", 1, "stock_received", {"qty": 1}),
        ]
    )
    snap = take_snapshot(store)
    store.extend(
        [ev("a2", "sku:A", 2, "stock_counted", {"qty": 100}), recv("b2", "sku:B", 2, 5)]
    )
    store.aggregate_reads.clear()
    state = replay_from(store, snap)
    assert set(store.aggregate_reads) == {"sku:A"}
    assert state["sku:A"]["levels"]["on_hand"] == 101
    assert state == replay_all(store)


def test_r11_in_order_applies_only_new_events():
    projections, calls = counting_projections()
    store = CountingStore()
    store.extend(
        [recv("a1", "sku:A", 1), recv("a2", "sku:A", 2), recv("b1", "sku:B", 1)]
    )
    snap = take_snapshot(store, projections)
    calls.clear()
    store.extend(
        [recv("a4", "sku:A", 4, 2), recv("a3", "sku:A", 3, 1)]
    )  # chegada invertida
    store.aggregate_reads.clear()
    state = replay_from(store, snap, projections)
    assert store.aggregate_reads == []
    assert {c[1] for c in calls} == {"a3", "a4"} and len(calls) == 2 * 5
    assert [c[1] for c in calls if c[0] == "levels"] == ["a3", "a4"]
    assert state["sku:A"]["levels"]["on_hand"] == 5 + 5 + 1 + 2
    assert state["sku:A"]["last_seen"]["sequence"] == 4
    projections2, _ = counting_projections()
    assert state == replay_all(store, projections2)


def test_r11_new_aggregate_and_untouched_aggregate():
    projections, calls = counting_projections()
    store = build([recv("a1", "sku:A", 1)])
    snap = take_snapshot(store, projections)
    store.append(recv("n1", "sku:N", 1))
    calls.clear()
    state = replay_from(store, snap, projections)
    assert {c[1] for c in calls} == {"n1"} and state["sku:N"]["levels"]["on_hand"] == 5
    again = update_snapshot(
        store, update_snapshot(store, snap, projections), projections
    )
    assert again == take_snapshot(store, projections)


def test_r12_unknown_types():
    store = build([ev("x1", "sku:Z", 1, "mystery"), recv("a1", "sku:A", 1)])
    snap = take_snapshot(store)
    assert snap.aggregates["sku:Z"].last_sequence == 1
    assert snap.aggregates["sku:Z"].state["levels"] == {"on_hand": 0, "reserved": 0}
    store.extend([ev("x2", "sku:Z", 2, "other"), ev("y1", "order:9", 1, "weird")])
    state = replay_from(store, snap)
    assert state == replay_all(store)
    assert state["order:9"]["status"] == {"status": "new", "flags": set()}
    assert state["sku:Z"]["counters"] == {"events": 0, "by_type": {}}
    store.append(recv("z3", "sku:Z", 3, 4))
    assert replay_from(store, snap)["sku:Z"]["levels"]["on_hand"] == 4


def test_r13_snapshot_is_never_mutated():
    store = build(sample_events())
    snap = take_snapshot(store)
    frozen = copy.deepcopy(snap)
    store.extend(
        [
            recv("a3", "sku:A", 3, 1),
            ev("o2", "order:1", 2, "order_paid"),
            recv("c1", "sku:C", 1),
        ]
    )
    first = update_snapshot(store, snap)
    assert snap == frozen
    second = update_snapshot(store, snap)
    assert first == second
    first.aggregates["sku:A"].state["levels"]["on_hand"] = -1
    first.aggregates["order:1"].state["status"]["flags"].add("x")
    assert snap == frozen and second == take_snapshot(store)
    untouched = update_snapshot(store, snap).aggregates["sku:B"].state
    assert untouched is not snap.aggregates["sku:B"].state
    assert (
        untouched["movements"]["history"]
        is not snap.aggregates["sku:B"].state["movements"]["history"]
    )


def test_r14_mismatch():
    store = build(sample_events())
    snap = take_snapshot(store)
    with pytest.raises(SnapshotMismatchError):
        update_snapshot(store, snap, list(reversed(default_projections())))
    with pytest.raises(SnapshotMismatchError):
        update_snapshot(store, snap, default_projections()[:3])
    with pytest.raises(SnapshotMismatchError):
        update_snapshot(build(sample_events()[:2]), snap)
    other = build(
        [
            recv("q1", "sku:A", 1),
            recv("q2", "sku:A", 2),
            recv("q3", "sku:B", 1),
            recv("q4", "sku:B", 2),
        ]
    )
    with pytest.raises(SnapshotMismatchError):
        replay_from(other, snap)  # mesmo tamanho, outro log
    prefix_of_other = take_snapshot(build(sample_events()[:3]))
    with pytest.raises(SnapshotMismatchError):
        replay_from(other, prefix_of_other)


def test_r15_chaining_and_noop():
    projections, calls = counting_projections()
    events = sample_events() + [
        recv("b2", "sku:B", 2),
        ev("o2", "order:1", 2, "order_paid"),
    ]
    store = build(events[:2])
    s1 = update_snapshot(store, None, projections)
    store.extend(events[2:4])
    s2 = update_snapshot(store, s1, projections)
    store.extend(events[4:])
    s3 = update_snapshot(store, s2, projections)
    assert s3 == take_snapshot(store, projections)
    calls.clear()
    assert update_snapshot(store, s3, projections) == s3 and calls == []


def test_duplicates_after_snapshot_do_not_change_state():
    store = build(sample_events())
    snap = take_snapshot(store)
    store.extend(sample_events())
    assert replay_from(store, snap) == replay_all(build(sample_events()))
    assert take_snapshot(store).position == 4
