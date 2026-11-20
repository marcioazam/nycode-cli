import pytest
from helpdesk import Desk, NotFoundError, ValidationError
from helpers import TODAY, raw


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


def test_search_filters_and_default_order():
    desk = filled()
    assert [t["id"] for t in desk.search()] == ["T-3", "T-2", "T-1"]
    assert [t["id"] for t in desk.search({"min_priority": "high"})] == ["T-3", "T-2"]
    assert [t["id"] for t in desk.search({"tag": "NET"})] == ["T-1"]
    assert [t["id"] for t in desk.search({"text": "disk"})] == ["T-2"]
    assert [t["id"] for t in desk.search({"tier": "gold"}, sort="created")] == ["T-3"]
    assert [t["id"] for t in desk.search(sort="created")] == ["T-2", "T-1", "T-3"]


def test_search_rejects_bad_input():
    desk = filled()
    with pytest.raises(ValidationError) as info:
        desk.search({"color": "red"})
    assert info.value.field == "color"
    with pytest.raises(ValidationError):
        desk.search({"status": "nope"})
    with pytest.raises(ValueError):
        desk.search(sort="random")


def test_store_get_and_copies():
    desk = filled()
    ticket = desk.get("T-1")
    ticket["subject"] = "changed"
    assert desk.get("T-1")["subject"] == "Printer on fire"
    with pytest.raises(NotFoundError):
        desk.get("T-99")
