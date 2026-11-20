import dataclasses
import enum

import pytest
from helpdesk import models
from helpdesk.errors import ValidationError
from helpdesk.models import (
    Criteria,
    Customer,
    HistoryEntry,
    Priority,
    Status,
    Summary,
    Ticket,
    Tier,
)
from v2data import ANA, TODAY


def test_r1_exports():
    for name in (
        "Priority",
        "Status",
        "Tier",
        "Customer",
        "HistoryEntry",
        "Ticket",
        "Criteria",
        "Summary",
    ):
        assert hasattr(models, name)


def test_r2_enums():
    assert issubclass(Priority, enum.IntEnum)
    assert [(p.name, int(p), p.label) for p in Priority] == [
        ("LOW", 1, "low"),
        ("NORMAL", 2, "normal"),
        ("HIGH", 3, "high"),
        ("URGENT", 4, "urgent"),
    ]
    assert Priority.LOW < Priority.NORMAL < Priority.HIGH < Priority.URGENT
    assert Priority(3) is Priority.HIGH
    assert issubclass(Status, enum.Enum) and issubclass(Tier, enum.Enum)
    assert [(s.name, s.label) for s in Status] == [
        ("OPEN", "open"),
        ("PENDING", "pending"),
        ("RESOLVED", "resolved"),
        ("CLOSED", "closed"),
    ]
    assert [(t.name, t.label) for t in Tier] == [
        ("STANDARD", "standard"),
        ("GOLD", "gold"),
        ("ENTERPRISE", "enterprise"),
    ]
    assert [s.is_open for s in Status] == [True, True, False, False]


def test_r3_parse_accepts_spaces_and_case():
    assert Priority.parse(" HIGH ") is Priority.HIGH
    assert Priority.parse("low") is Priority.LOW
    assert Status.parse("Pending\n") is Status.PENDING
    assert Tier.parse("\tENTERPRISE") is Tier.ENTERPRISE


@pytest.mark.parametrize("bad", ["meh", "", None, 3, ["high"], "hi gh"])
def test_r3_parse_rejects(bad):
    for cls, name, labels in (
        (Priority, "priority", "low, normal, high, urgent"),
        (Status, "status", "open, pending, resolved, closed"),
        (Tier, "customer.tier", "standard, gold, enterprise"),
    ):
        with pytest.raises(ValidationError) as info:
            cls.parse(bad)
        assert str(info.value) == f"{name} must be one of {labels}"
        assert info.value.field == name


def test_r4_customer_and_history_entry():
    c = Customer("Ana", "a@b.co")
    assert (c.name, c.email, c.tier) == ("Ana", "a@b.co", Tier.STANDARD)
    assert Customer("Ana", "a@b.co", Tier.GOLD).tier is Tier.GOLD
    assert c == Customer(name="Ana", email="a@b.co", tier=Tier.STANDARD)
    h = HistoryEntry(TODAY, "x")
    assert (h.at, h.event) == (TODAY, "x") and h == HistoryEntry(at=TODAY, event="x")
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.name = "B"
    with pytest.raises(dataclasses.FrozenInstanceError):
        h.event = "y"


def test_r5_ticket_defaults_equality_and_frozen():
    t = Ticket(id="T-1", customer=ANA, subject="S", created=TODAY)
    assert (t.priority, t.status, t.body) == (Priority.NORMAL, Status.OPEN, "")
    assert (t.tags, t.assignee, t.history, t.extra) == ((), None, (), {})
    other = Ticket(id="T-1", customer=ANA, subject="S", created=TODAY)
    assert t == other and t.extra is not other.extra
    assert t != dataclasses.replace(t, priority=Priority.HIGH)
    with pytest.raises(dataclasses.FrozenInstanceError):
        t.priority = Priority.HIGH
    with pytest.raises(dataclasses.FrozenInstanceError):
        t.tags = ("a",)
    with pytest.raises(TypeError):
        Ticket(id="T-1", customer=ANA, subject="S")


def test_r9_criteria_defaults_and_conversion():
    empty = Criteria()
    assert Criteria.from_dict(None) == empty and Criteria.from_dict({}) == empty
    assert (empty.status, empty.min_priority, empty.tag) == (None, None, None)
    assert (empty.tier, empty.assignee, empty.text) == (None, None, None)
    c = Criteria.from_dict(
        {
            "status": " OPEN ",
            "min_priority": "High",
            "tier": "gold ",
            "tag": " NET ",
            "assignee": " Ana ",
            "text": " Disk ",
        }
    )
    assert c == Criteria(
        status=Status.OPEN,
        min_priority=Priority.HIGH,
        tag="net",
        tier=Tier.GOLD,
        assignee=" Ana ",
        text=" Disk ",
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.tag = "x"


@pytest.mark.parametrize(
    "data,field",
    [
        ({"tier": "vip"}, "tier"),
        ({"tier": None}, "tier"),
        ({"min_priority": "meh"}, "min_priority"),
        ({"min_priority": 3}, "min_priority"),
        ({"status": "nope"}, "status"),
        ({"tag": 1}, "tag"),
        ({"assignee": None}, "assignee"),
        ({"text": ["a"]}, "text"),
        ({"status": "nope", "zzz": 1}, "zzz"),
        ({"tag": 1, "color": "red"}, "color"),
    ],
)
def test_r9_criteria_errors_name_the_criterion(data, field):
    with pytest.raises(ValidationError) as info:
        Criteria.from_dict(data)
    assert info.value.field == field
    if field not in Criteria.__dataclass_fields__:
        assert str(info.value) == "unknown criterion: " + field


def test_r10_summary():
    s = Summary(
        total=1,
        by_status={"open": 1, "pending": 0, "resolved": 0, "closed": 0},
        by_priority={"low": 0, "normal": 1, "high": 0, "urgent": 0},
        open_by_tier={"standard": 1, "gold": 0, "enterprise": 0},
    )
    out = s.to_dict()
    assert out == {
        "total": 1,
        "by_status": {"open": 1, "pending": 0, "resolved": 0, "closed": 0},
        "by_priority": {"low": 0, "normal": 1, "high": 0, "urgent": 0},
        "open_by_tier": {"standard": 1, "gold": 0, "enterprise": 0},
    }
    out["by_status"]["open"] = 99
    assert s.to_dict()["by_status"]["open"] == 1
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.total = 2
