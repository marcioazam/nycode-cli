import pytest
from helpdesk import Desk
from helpers import TODAY, raw


def test_submit_ok_applies_defaults_and_assigns():
    desk = Desk()
    result = desk.submit(
        raw("T-4", subject="  Hello  ", tags=["B", "a", "b", " "]), TODAY
    )
    assert result["ok"] is True
    t = result["ticket"]
    assert t["subject"] == "Hello" and t["tags"] == ["a", "b"]
    assert (
        t["customer"]["tier"] == "standard"
        and t["priority"] == "normal"
        and t["status"] == "open"
    )
    assert t["assignee"] == "bruno" and t["history"] == [
        {"at": "2024-03-10", "event": "assigned:bruno"}
    ]
    assert t["body"] == ""


def test_unknown_keys_are_preserved_and_input_untouched():
    data = raw(origin={"via": "mail"}, tags=["X"])
    before = repr(data)
    t = Desk().submit(data, TODAY)["ticket"]
    assert t["origin"] == {"via": "mail"} and repr(data) == before


def test_errors_are_reported_in_the_result():
    desk = Desk()
    assert desk.submit(raw("X-1"), TODAY)["field"] == "id"
    assert (
        desk.submit(raw(customer={"name": "A", "email": "bad"}), TODAY)["field"]
        == "customer.email"
    )
    assert desk.submit(raw(priority="urgent"), TODAY)["field"] == "priority"
    assert desk.submit(raw(status="closed"), TODAY)["field"] == "status"
    assert desk.submit(raw(created="2024-03-11"), TODAY)["field"] == "created"
    assert desk.submit(raw(created="20240309"), TODAY)["field"] == "created"
    bad = desk.submit(raw(priority="meh"), TODAY)
    assert (
        bad["ok"] is False
        and bad["field"] == "priority"
        and isinstance(bad["error"], str)
    )
    assert Desk(agents=()).submit(raw(), TODAY)["field"] == "assignee"
    assert (
        desk.submit(raw("T-8"), TODAY)["ok"]
        and desk.submit(raw("T-8"), TODAY)["field"] == "id"
    )


def test_non_dict_is_a_type_error():
    with pytest.raises(TypeError):
        Desk().submit([raw()], TODAY)
