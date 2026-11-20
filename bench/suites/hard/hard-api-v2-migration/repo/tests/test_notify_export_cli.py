import io
import json

from helpdesk import Desk
from helpdesk.cli.main import main
from helpdesk.export import dump_jsonl, to_rows
from helpdesk.notify import build_digest, render_notification
from helpers import TODAY, raw


def test_notifications_digest_rows_jsonl():
    desk = Desk()
    desk.submit(raw("T-1", priority="high", tags=["b", "a"]), TODAY)
    desk.submit(raw("T-2", status="closed", assignee="zed"), TODAY)
    assert (
        render_notification(desk.get("T-1"))
        == "[HIGH] T-1 Printer on fire (Ana Souza) due 2024-03-10"
    )
    assert desk.notifications()[0].startswith("[HIGH] T-1")
    assert build_digest(desk.store.all()).splitlines()[0] == "Digest: 1 open"
    rows = to_rows(desk.store.all())
    assert rows[0][0] == "id" and rows[1] == [
        "T-1",
        "high",
        "open",
        "standard",
        "bruno",
        "2024-03-09",
        "a;b",
    ]
    assert rows[2][4] == "zed"
    lines = dump_jsonl(desk.store.all()).splitlines()
    assert json.loads(lines[0])["id"] == "T-1" and len(lines) == 2


def test_cli(tmp_path):
    path = tmp_path / "t.json"
    path.write_text(json.dumps([raw("T-1"), raw("bad")]), encoding="utf-8")
    out = io.StringIO()
    assert main(["submit", str(path)], out, TODAY) == 0
    results = json.loads(out.getvalue())
    assert results[0]["ok"] is True and results[1]["field"] == "id"
    out = io.StringIO()
    assert (
        main(["report", str(path)], out, TODAY) == 0
        and json.loads(out.getvalue())["total"] == 1
    )
    out = io.StringIO()
    assert (
        main(["search", str(path), '{"tier": "gold"}'], out, TODAY) == 0
        and json.loads(out.getvalue()) == []
    )
    out = io.StringIO()
    assert main(
        ["search", str(path), '{"zzz": 1}'], out, TODAY
    ) == 2 and out.getvalue().startswith("error: ")
    assert main(["nope"], io.StringIO()) == 1
