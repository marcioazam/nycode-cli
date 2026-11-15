from datetime import date

import pytest
from helpdesk.errors import ValidationError
from helpdesk.intake import canonicalize
from helpdesk.models import (
    Customer,
    HistoryEntry,
    Priority,
    Status,
    Ticket,
    Tier,
)
from v2data import raw, tk

FULL = {
    "id": "T-7",
    "customer": {"name": " Ana ", "email": "ANA@x.io", "tier": " Gold "},
    "subject": "  Hello  ",
    "body": "text",
    "priority": " URGENT ",
    "tags": ["B", "a", "B"],
    "status": "Pending",
    "created": "2024-03-09",
    "assignee": "zed",
    "history": [
        {"at": "2024-03-08", "event": "x", "junk": 1},
        {"at": "2024-03-01", "event": "y"},
    ],
    "origin": {"via": ["mail"]},
}
FULL_OUT = {
    "id": "T-7",
    "customer": {"name": " Ana ", "email": "ANA@x.io", "tier": "gold"},
    "subject": "  Hello  ",
    "body": "text",
    "priority": "urgent",
    "tags": ["B", "a", "B"],
    "status": "pending",
    "created": "2024-03-09",
    "assignee": "zed",
    "history": [
        {"at": "2024-03-08", "event": "x"},
        {"at": "2024-03-01", "event": "y"},
    ],
    "origin": {"via": ["mail"]},
}


def test_r6_from_dict_defaults_and_types():
    t = Ticket.from_dict(raw())
    assert t == tk()
    assert isinstance(t.created, date) and isinstance(t.tags, tuple)
    assert isinstance(t.history, tuple) and t.customer.tier is Tier.STANDARD


def test_r6_from_dict_does_not_normalize_or_validate():
    t = Ticket.from_dict(FULL)
    assert t == Ticket(
        id="T-7",
        customer=Customer(" Ana ", "ANA@x.io", Tier.GOLD),
        subject="  Hello  ",
        created=date(2024, 3, 9),
        priority=Priority.URGENT,
        status=Status.PENDING,
        body="text",
        tags=("B", "a", "B"),
        assignee="zed",
        history=(
            HistoryEntry(date(2024, 3, 8), "x"),
            HistoryEntry(date(2024, 3, 1), "y"),
        ),
        extra={"origin": {"via": ["mail"]}},
    )
    assert Ticket.from_dict(raw("X-1", subject="")).id == "X-1"


def test_r6_from_dict_input_isolated():
    data = raw(origin={"via": ["mail"]}, tags=["x"])
    before = repr(data)
    t = Ticket.from_dict(data)
    assert repr(data) == before
    data["origin"]["via"].append("phone")
    data["tags"].append("y")
    assert t.extra == {"origin": {"via": ["mail"]}} and t.tags == ("x",)


@pytest.mark.parametrize("bad", [None, [], "T-1", 3])
def test_r6_from_dict_non_dict(bad):
    with pytest.raises(TypeError) as info:
        Ticket.from_dict(bad)
    assert str(info.value) == "ticket must be a dict"


def _without(key):
    data = raw()
    del data[key]
    return data


ERRORS = [
    (_without("id"), "id", "id is required"),
    (_without("created"), "created", "created is required"),
    ({"subject": "s"}, "id", "id is required"),
    (raw(customer="ana"), "customer", "customer must be an object"),
    (raw(customer={"name": "A"}), "customer.email", "customer.email is required"),
    (raw(customer={"email": 1}), "customer.name", "customer.name is required"),
    (
        raw(customer={"name": "A", "email": 1}),
        "customer.email",
        "customer.email must be a string",
    ),
    (
        raw(customer={"name": "A", "email": "a@b.co", "tier": "vip"}),
        "customer.tier",
        "customer.tier must be one of standard, gold, enterprise",
    ),
    (raw(tags="net"), "tags", "tags must be a list of strings"),
    (raw(tags=["a", 1]), "tags", "tags must be a list of strings"),
    (raw(assignee=3), "assignee", "assignee must be a string or null"),
    (raw(created="20240309"), "created", "created must be YYYY-MM-DD"),
    (raw(created="2024-02-30"), "created", "created is not a real date"),
    (raw(created=20240309), "created", "created must be YYYY-MM-DD"),
    (raw(id=5), "id", "id must be a string"),
    (raw(subject=None), "subject", "subject must be a string"),
    (
        raw(priority=None),
        "priority",
        "priority must be one of low, normal, high, urgent",
    ),
    (
        raw(status="done"),
        "status",
        "status must be one of open, pending, resolved, closed",
    ),
    (raw(history={}), "history", "history must be a list"),
    (raw(history=[{"at": "2024-03-01"}]), "history", "bad history entry"),
    (raw(history=[{"event": "x"}]), "history", "bad history entry"),
    (
        raw(history=[{"at": "03/01", "event": "x"}]),
        "history",
        "history must be YYYY-MM-DD",
    ),
    # mais de um erro: vence o primeiro, na ordem da v1
    (raw(body=1, priority="meh"), "body", "body must be a string"),
    (
        raw(priority="meh", status="nope"),
        "priority",
        "priority must be one of low, normal, high, urgent",
    ),
    (raw(id=5, tags="x"), "tags", "tags must be a list of strings"),
    (
        raw(id=5, assignee=1, created="x"),
        "assignee",
        "assignee must be a string or null",
    ),
    (raw(id=5, created="x"), "created", "created must be YYYY-MM-DD"),
    (raw(id=5, customer=1), "id", "id must be a string"),
    (
        raw(subject=1, customer={"name": "A", "email": "a@b.co", "tier": 1}),
        "customer.tier",
        "customer.tier must be one of standard, gold, enterprise",
    ),
    (
        raw(status="nope", history=3),
        "status",
        "status must be one of open, pending, resolved, closed",
    ),
    (raw(subject=1, body=2), "subject", "subject must be a string"),
]


@pytest.mark.parametrize("data,field,message", ERRORS)
def test_r6_r8_errors_in_v1_order(data, field, message):
    for convert in (Ticket.from_dict, canonicalize):
        with pytest.raises(ValidationError) as info:
            convert(data)
        assert (info.value.field, str(info.value)) == (field, message)


def test_r7_to_dict():
    t = Ticket.from_dict(FULL)
    out = t.to_dict()
    assert out == FULL_OUT
    assert tk().to_dict() == {
        "id": "T-1",
        "customer": {
            "name": "Ana Souza",
            "email": "ana@example.com",
            "tier": "standard",
        },
        "subject": "Printer on fire",
        "body": "",
        "priority": "normal",
        "tags": [],
        "status": "open",
        "created": "2024-03-09",
        "assignee": None,
        "history": [],
    }
    out["origin"]["via"].append("phone")
    out["tags"].append("z")
    out["history"].clear()
    out["customer"]["name"] = "changed"
    assert t.to_dict() == FULL_OUT and t.extra == {"origin": {"via": ["mail"]}}


def test_r7_round_trip():
    for t in (tk(), Ticket.from_dict(FULL), tk(extra={"n": [1, {"k": None}]})):
        assert Ticket.from_dict(t.to_dict()) == t


def test_r8_canonicalize_returns_v1_dict():
    data = dict(FULL)
    before = repr(data)
    assert canonicalize(data) == FULL_OUT and repr(data) == before
    assert canonicalize(raw())["customer"]["tier"] == "standard"
