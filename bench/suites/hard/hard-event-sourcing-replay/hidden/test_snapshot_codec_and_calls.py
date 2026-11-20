import io
import json

import pytest
from hh import build, ev, random_events, recv
from stockflow.cli.main import main
from stockflow.errors import InvalidSnapshotError
from stockflow.replay import replay_all
from stockflow.services import InventoryService
from stockflow.services.reports import low_stock, order_summary
from stockflow.snapshots import (
    replay_from,
    snapshot_from_dict,
    snapshot_state,
    snapshot_to_dict,
    take_snapshot,
    update_snapshot,
)
from stockflow.store import InMemoryEventStore


def rich_store():
    return build(
        [
            recv("a1", "sku:A", 1, 10),
            ev("a2", "sku:A", 2, "stock_reserved", {"qty": 3, "reservation_id": "r1"}),
            ev("a3", "sku:A", 3, "stock_released", {"qty": 3, "reservation_id": "r1"}),
            ev(
                "o1",
                "order:1",
                1,
                "order_placed",
                {"lines": [{"sku": "A", "qty": 2, "unit_cents": 150}]},
            ),
            ev("o2", "order:1", 2, "order_shipped"),
            ev("x1", "sku:Z", 1, "mystery"),
        ]
    )


def test_r16_json_round_trip_restores_types():
    snap = take_snapshot(rich_store())
    data = snapshot_to_dict(snap)
    text = json.dumps(data)
    back = snapshot_from_dict(json.loads(text))
    assert back == snap
    assert isinstance(back.aggregates["sku:A"].state["movements"]["history"][0], tuple)
    assert isinstance(back.aggregates["order:1"].state["totals"]["lines"]["A"], tuple)
    assert back.aggregates["order:1"].state["status"]["flags"] == {
        "ignored:order_shipped"
    }
    assert isinstance(back.aggregates["sku:A"].state["reservations"]["closed"], set)
    store = rich_store()
    store.append(ev("a4", "sku:A", 4, "stock_received", {"qty": 1}))
    assert replay_from(store, back) == replay_all(store)
    assert snapshot_from_dict(
        snapshot_to_dict(take_snapshot(build([])))
    ) == take_snapshot(build([]))


def test_r17_rejections():
    good = snapshot_to_dict(take_snapshot(rich_store()))

    def bad(**changes):
        data = json.loads(json.dumps(good))
        for key, value in changes.items():
            if value is KeyError:
                del data[key]
            else:
                data[key] = value
        with pytest.raises(InvalidSnapshotError):
            snapshot_from_dict(data)

    for value in (None, [], "x", 3):
        with pytest.raises(InvalidSnapshotError):
            snapshot_from_dict(value)
    for key in ("version", "position", "head_event_id", "projections", "aggregates"):
        bad(**{key: KeyError})
    bad(version=2)
    bad(position="6")
    bad(position=-1)
    bad(head_event_id=7)
    bad(projections="levels")
    bad(projections=["levels", 3])
    bad(aggregates=[])
    for field, value in (
        ("last_sequence", 0),
        ("last_sequence", "1"),
        ("state", []),
    ):
        data = json.loads(json.dumps(good))
        data["aggregates"]["sku:A"][field] = value
        with pytest.raises(InvalidSnapshotError):
            snapshot_from_dict(data)
    data = json.loads(json.dumps(good))
    del data["aggregates"]["sku:A"]["state"]
    with pytest.raises(InvalidSnapshotError):
        snapshot_from_dict(data)


def test_r18_service():
    svc = InventoryService()
    svc.record_many(rich_store().all())
    snap = svc.snapshot()
    svc.record(
        ev("a4", "sku:A", 4, "stock_shipped", {"qty": 2, "reservation_id": "r2"})
    )
    svc.record(
        ev("a4", "sku:A", 4, "stock_shipped", {"qty": 2, "reservation_id": "r2"})
    )
    assert svc.state(snap) == svc.state() == replay_all(svc.store)
    assert (
        svc.snapshot(snap) == take_snapshot(svc.store)
        and svc.snapshot(snap).position == 7
    )
    assert svc.stock_level("A")["on_hand"] == 8


def test_r19_reports_with_snapshot():
    store = rich_store()
    snap = take_snapshot(store)
    store.extend(
        [
            recv("b1", "sku:B", 1, 1),
            ev("o3", "order:2", 1, "order_placed", {"lines": []}),
        ]
    )
    assert low_stock(store, 5, snapshot=snap) == low_stock(store, 5) == ["B", "Z"]
    assert order_summary(store, snapshot=snap) == order_summary(store) == {"placed": 2}


def run(argv):
    out = io.StringIO()
    return main(argv, out), out.getvalue()


def write_lines(path, events):
    from stockflow.events.codec import event_to_dict

    path.write_text(
        "".join(json.dumps(event_to_dict(e)) + "\n" for e in events), encoding="utf-8"
    )


def test_r20_cli_snapshot_and_resume(tmp_path):
    events = rich_store().all()
    first, second = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
    write_lines(first, events[:4])
    more = [recv("a4", "sku:A", 4, 2), events[1], ev("o3", "order:1", 3, "order_paid")]
    write_lines(second, events[:4] + more)
    out = tmp_path / "snap.json"
    code, text = run(["snapshot", str(first), str(out)])
    assert (code, text) == (0, "position=4\n")
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved["position"] == 4 and out.read_text(encoding="utf-8") == json.dumps(
        saved, sort_keys=True
    )
    code, resumed = run(["resume", str(second), str(out)])
    assert code == 0
    assert (code, resumed) == run(["replay", str(second)])


def test_r21_cli_errors(tmp_path):
    events = rich_store().all()
    good, snap = tmp_path / "e.jsonl", tmp_path / "s.json"
    write_lines(good, events)
    assert run(["snapshot", str(good), str(snap)])[0] == 0
    short = tmp_path / "short.jsonl"
    write_lines(short, events[:2])
    for argv in (["resume", str(short), str(snap)],):
        code, text = run(argv)
        assert code == 2 and text.startswith("error: ")
    snap.write_text("{not json", encoding="utf-8")
    assert run(["resume", str(good), str(snap)])[0] == 2
    snap.write_text(json.dumps({"version": 1}), encoding="utf-8")
    assert run(["resume", str(good), str(snap)])[0] == 2
    assert run(["resume", str(good), str(tmp_path / "none.json")])[0] == 2
    clash = tmp_path / "clash.jsonl"
    write_lines(clash, [recv("e1", "sku:A", 1), recv("e2", "sku:A", 1)])
    code, text = run(["replay", str(clash)])
    assert code == 2 and text.startswith("error: ")
    assert run(["resume", str(good)])[0] == 1 and run(["snapshot", str(good)])[0] == 1
    assert run(["replay", str(good)])[0] == 0


@pytest.mark.parametrize("seed", range(6))
def test_equivalence_with_shuffled_duplicated_events(seed):
    import random

    rng = random.Random(seed)
    events = random_events(seed)
    arrival = events[:]
    rng.shuffle(arrival)
    arrival += rng.sample(events, 15)  # repetições exatas
    expected = replay_all(build(events))
    store = InMemoryEventStore()
    snap = None
    cuts = sorted(rng.sample(range(1, len(arrival)), 4)) + [len(arrival)]
    start = 0
    for cut in cuts:
        store.extend(arrival[start:cut])
        start = cut
        snap = update_snapshot(store, snap)
        round_trip = snapshot_from_dict(json.loads(json.dumps(snapshot_to_dict(snap))))
        assert round_trip == snap
        assert snapshot_state(snap) == replay_all(store)
        snap = round_trip
    assert snapshot_state(snap) == expected
    assert snap == take_snapshot(store)
