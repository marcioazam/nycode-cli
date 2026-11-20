import io
import json

from stockflow.cli.main import main


def write_events(tmp_path):
    lines = [
        {
            "event_id": "e1",
            "aggregate_id": "sku:A",
            "sequence": 1,
            "timestamp": 1,
            "type": "stock_received",
            "payload": {"qty": 5},
        },
        {
            "event_id": "e2",
            "aggregate_id": "sku:A",
            "sequence": 2,
            "timestamp": 2,
            "type": "stock_shipped",
            "payload": {"qty": 1, "reservation_id": "r"},
        },
    ]
    path = tmp_path / "events.jsonl"
    path.write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
    return str(path)


def run(argv):
    out = io.StringIO()
    code = main(argv, out)
    return code, out.getvalue()


def test_replay_prints_state_with_sets_as_lists(tmp_path):
    code, text = run(["replay", write_events(tmp_path)])
    state = json.loads(text)
    assert code == 0 and state["sku:A"]["levels"] == {"on_hand": 4, "reserved": 0}
    assert state["sku:A"]["reservations"]["closed"] == ["r"]


def test_low_stock_and_usage_errors(tmp_path):
    path = write_events(tmp_path)
    assert run(["low-stock", path, "10"]) == (0, "A\n")
    code, text = run([])
    assert code == 1 and text.startswith("usage:")
    code, text = run(["replay", str(tmp_path / "missing.jsonl")])
    assert code == 2 and text.startswith("error: ")
