import io
import json
from datetime import date

import pytest
from helpdesk import Desk, NotFoundError, ValidationError
from helpdesk.cli.main import main
from helpdesk.models import (
    Customer,
    HistoryEntry,
    Priority,
    Status,
    Summary,
    Ticket,
    Tier,
)
from v2data import RICH, RICH_OUT, TODAY, raw


def test_r15_submit_returns_the_v1_dict():
    desk = Desk()
    before = repr(RICH)
    result = desk.submit(RICH, TODAY)
    assert result == {"ok": True, "ticket": RICH_OUT} and repr(RICH) == before
    assert type(result["ticket"]) is dict and type(result["ticket"]["tags"]) is list
    json.dumps(result)
    result["ticket"]["origin"]["via"] = "changed"
    result["ticket"]["tags"].append("z")
    assert desk.search() == [RICH_OUT]
    kept = desk.submit(raw("T-2", status="closed", assignee="zed"), TODAY)["ticket"]
    assert (
        kept["assignee"] == "zed"
        and kept["history"] == []
        and kept["status"] == "closed"
    )


@pytest.mark.parametrize(
    "data,field,error",
    [
        (raw("X-1"), "id", "id must look like T-123"),
        (
            raw(priority="urgent"),
            "priority",
            "urgent needs a gold or enterprise customer",
        ),
        (
            raw(priority="meh"),
            "priority",
            "priority must be one of low, normal, high, urgent",
        ),
        (raw(status="closed"), "status", "a closed ticket needs an assignee"),
        (raw(created="2024-03-11"), "created", "created is in the future"),
        (raw(created="20240309"), "created", "created must be YYYY-MM-DD"),
        (raw(body=1, priority="meh"), "body", "body must be a string"),
        (
            raw("X-1", priority="meh"),
            "priority",
            "priority must be one of low, normal, high, urgent",
        ),
        (
            raw("X-1", customer={"name": "", "email": "bad"}),
            "id",
            "id must look like T-123",
        ),
        (raw(subject="   "), "subject", "subject must have 1..80 characters"),
        (
            raw(customer={"name": "A", "email": "a@b.co", "tier": "vip"}),
            "customer.tier",
            "customer.tier must be one of standard, gold, enterprise",
        ),
        (
            raw(history=[{"at": "x", "event": "e"}]),
            "history",
            "history must be YYYY-MM-DD",
        ),
        ({}, "id", "id is required"),
    ],
)
def test_r15_submit_errors_match_v1(data, field, error):
    desk = Desk()
    assert desk.submit(data, TODAY) == {"ok": False, "field": field, "error": error}
    assert desk.search() == []


def test_r15_submit_other_failures():
    assert Desk(agents=()).submit(raw(), TODAY) == {
        "ok": False,
        "field": "assignee",
        "error": "'no agents available'",
    }
    desk = Desk()
    assert desk.submit(raw("T-8"), TODAY)["ok"] is True
    assert desk.submit(raw("T-8", subject="again"), TODAY) == {
        "ok": False,
        "field": "id",
        "error": "duplicate id: T-8",
    }
    for bad in ([raw()], None, "T-1"):
        with pytest.raises(TypeError):
            desk.submit(bad, TODAY)


def filled():
    desk = Desk()
    desk.submit(raw("T-1", priority="low", tags=["net"]), TODAY)
    desk.submit(
        raw("T-2", priority="high", subject="Disk full", created="2024-03-05"), TODAY
    )
    desk.submit(
        raw(
            "T-3",
            priority="urgent",
            customer={"name": "B", "email": "b@x.io", "tier": "gold"},
        ),
        TODAY,
    )
    return desk


def test_r15_search_takes_and_returns_dicts():
    desk = filled()
    found = desk.search()
    assert all(type(t) is dict for t in found)
    assert [t["id"] for t in found] == ["T-3", "T-2", "T-1"]
    assert found[1] == {
        "id": "T-2",
        "customer": {
            "name": "Ana Souza",
            "email": "ana@example.com",
            "tier": "standard",
        },
        "subject": "Disk full",
        "body": "",
        "priority": "high",
        "tags": [],
        "status": "open",
        "created": "2024-03-05",
        "assignee": "carla",
        "history": [{"at": "2024-03-10", "event": "assigned:carla"}],
    }
    assert [t["id"] for t in desk.search({"min_priority": " HIGH "})] == ["T-3", "T-2"]
    assert [t["id"] for t in desk.search({"tag": "NET"})] == ["T-1"]
    assert [t["id"] for t in desk.search({"text": "disk", "status": "Open"})] == ["T-2"]
    assert [t["id"] for t in desk.search({"tier": "gold"}, sort="created")] == ["T-3"]
    assert [t["id"] for t in desk.search({"assignee": "ana"})] == ["T-3"]
    assert [t["id"] for t in desk.search({}, sort="sla")] == ["T-2", "T-3", "T-1"]
    assert [t["id"] for t in desk.search(sort="created")] == ["T-2", "T-1", "T-3"]
    found[0]["subject"] = "changed"
    assert desk.search()[0]["subject"] == "Printer on fire"


def test_r15_search_errors():
    desk = filled()
    for criteria, field in (
        ({"color": "red"}, "color"),
        ({"status": "nope"}, "status"),
        ({"tier": "vip"}, "tier"),
        ({"min_priority": 2}, "min_priority"),
        ({"tag": 5}, "tag"),
        ({"tier": "vip", "zzz": 1}, "zzz"),
    ):
        with pytest.raises(ValidationError) as info:
            desk.search(criteria)
        assert info.value.field == field
    with pytest.raises(ValueError):
        desk.search(sort="random")


def test_r16_get_returns_a_ticket():
    desk = Desk()
    desk.submit(RICH, TODAY)
    assert desk.get("T-4") == Ticket(
        id="T-4",
        customer=Customer("Ana", "ana@example.com", Tier.GOLD),
        subject="Hello",
        created=date(2024, 3, 9),
        priority=Priority.HIGH,
        status=Status.OPEN,
        body="b",
        tags=("a", "b"),
        assignee="bruno",
        history=(
            HistoryEntry(date(2024, 3, 1), "y"),
            HistoryEntry(date(2024, 3, 8), "x"),
            HistoryEntry(TODAY, "assigned:bruno"),
        ),
        extra={"origin": {"via": "mail"}},
    )
    assert desk.get("T-4").to_dict() == RICH_OUT
    with pytest.raises(NotFoundError):
        desk.get("T-99")


def test_r16_report_and_escalate_all():
    desk = Desk()
    desk.submit(raw("T-1", created="2024-03-01"), TODAY)
    desk.submit(raw("T-2", status="resolved"), TODAY)
    desk.submit(raw("T-3", priority="high", created="2024-03-01"), TODAY)
    report = desk.report()
    assert report == Summary(
        total=3,
        by_status={"open": 2, "pending": 0, "resolved": 1, "closed": 0},
        by_priority={"low": 0, "normal": 2, "high": 1, "urgent": 0},
        open_by_tier={"standard": 2, "gold": 0, "enterprise": 0},
    )
    changed = desk.escalate_all(TODAY)
    assert [type(t) for t in changed] == [Ticket]
    assert changed[0].id == "T-1" and changed[0].priority is Priority.HIGH
    assert changed[0].history[-1] == HistoryEntry(TODAY, "escalated")
    assert desk.get("T-1") == changed[0]
    assert desk.escalate_all(TODAY) == []
    assert desk.report().to_dict()["by_priority"] == {
        "low": 0,
        "normal": 1,
        "high": 2,
        "urgent": 0,
    }
    later = desk.escalate_all(date(2024, 3, 11))
    assert later == [] and desk.get("T-3").priority is Priority.HIGH


def test_r16_notifications_and_rows():
    desk = filled()
    assert desk.notifications() == [
        "[URGENT] T-3 Printer on fire (B) due 2024-03-09",
        "[HIGH] T-2 Disk full (Ana Souza) due 2024-03-06",
        "[LOW] T-1 Printer on fire (Ana Souza) due 2024-03-16",
    ]
    assert desk.rows() == [
        ["id", "priority", "status", "tier", "assignee", "created", "tags"],
        ["T-2", "high", "open", "standard", "carla", "2024-03-05", ""],
        ["T-1", "low", "open", "standard", "bruno", "2024-03-09", "net"],
        ["T-3", "urgent", "open", "gold", "ana", "2024-03-09", ""],
    ]


def run(args):
    out = io.StringIO()
    code = main(args, out, TODAY)
    return code, out.getvalue()


def test_r17_cli(tmp_path):
    path = tmp_path / "t.json"
    path.write_text(
        json.dumps([RICH, raw("bad"), raw("T-5", status="resolved")]), encoding="utf-8"
    )
    code, text = run(["submit", str(path)])
    results = json.loads(text)
    assert code == 0 and results[0] == {"ok": True, "ticket": RICH_OUT}
    assert results[1] == {
        "ok": False,
        "field": "id",
        "error": "id must look like T-123",
    }
    assert text == json.dumps(results, sort_keys=True) + "\n"
    code, text = run(["report", str(path)])
    summary = {
        "total": 2,
        "by_status": {"open": 1, "pending": 0, "resolved": 1, "closed": 0},
        "by_priority": {"low": 0, "normal": 1, "high": 1, "urgent": 0},
        "open_by_tier": {"standard": 0, "gold": 1, "enterprise": 0},
    }
    assert code == 0 and text == json.dumps(summary, sort_keys=True) + "\n"
    code, text = run(["search", str(path), '{"tier": "gold"}'])
    assert code == 0 and text == json.dumps([RICH_OUT], sort_keys=True) + "\n"
    code, text = run(["search", str(path)])
    assert code == 0 and [t["id"] for t in json.loads(text)] == ["T-4", "T-5"]
    code, text = run(["search", str(path), '{"zzz": 1}'])
    assert (code, text) == (2, "error: unknown criterion: zzz\n")
    code, text = run(["search", str(path), '{"tier": "vip"}'])
    assert code == 2 and text.startswith("error: ")
    assert run(["report", str(tmp_path / "missing.json")])[0] == 2
    assert run(["nope"])[0] == 1 and run(["report"])[0] == 1
