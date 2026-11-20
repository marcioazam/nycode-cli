import dataclasses
from datetime import date

import pytest
from helpdesk.errors import NotFoundError, ValidationError
from helpdesk.intake import normalize_ticket
from helpdesk.models import (
    Customer,
    HistoryEntry,
    Priority,
    Status,
    Ticket,
    Tier,
)
from helpdesk.routing import assign, escalate, sla_deadline
from helpdesk.validation import validate_ticket
from v2data import AGENTS, ENTERPRISE, GOLD, OLD, TODAY, tk


def test_r11_normalize_ticket():
    h = (
        HistoryEntry(date(2024, 3, 8), "b"),
        HistoryEntry(date(2024, 3, 1), "z"),
        HistoryEntry(date(2024, 3, 8), "a"),
    )
    t = tk(
        subject="  Hello  ",
        customer=Customer(" Ana ", " ANA@Example.com ", Tier.GOLD),
        tags=("B", "a", " b ", " ", ""),
        history=h,
        extra={"k": 1},
    )
    out = normalize_ticket(t)
    assert isinstance(out, Ticket) and out is not t
    assert out.subject == "Hello" and out.tags == ("a", "b")
    assert out.customer == Customer("Ana", "ana@example.com", Tier.GOLD)
    assert out.history == (h[1], h[0], h[2])
    assert out.extra == {"k": 1} and out.id == "T-1"
    assert t.subject == "  Hello  " and t.tags == ("B", "a", " b ", " ", "")
    assert normalize_ticket(tk()) == tk()


@pytest.mark.parametrize(
    "changes,field,message",
    [
        ({"id": "X-1"}, "id", "id must look like T-123"),
        ({"customer": Customer("A", "bad")}, "customer.email", "invalid email"),
        ({"customer": Customer("", "a@b.co")}, "customer.name", "name is required"),
        ({"subject": ""}, "subject", "subject must have 1..80 characters"),
        ({"subject": "x" * 81}, "subject", "subject must have 1..80 characters"),
        (
            {"priority": Priority.URGENT},
            "priority",
            "urgent needs a gold or enterprise customer",
        ),
        ({"tags": tuple("abcdefghi")}, "tags", "too many or too long tags"),
        ({"tags": ("x" * 21,)}, "tags", "too many or too long tags"),
        ({"status": Status.CLOSED}, "status", "a closed ticket needs an assignee"),
        ({"created": date(2024, 3, 11)}, "created", "created is in the future"),
        ({"id": "T1", "subject": ""}, "id", "id must look like T-123"),
        (
            {"status": Status.CLOSED, "created": date(2025, 1, 1)},
            "status",
            "a closed ticket needs an assignee",
        ),
    ],
)
def test_r11_validate_ticket_errors(changes, field, message):
    with pytest.raises(ValidationError) as info:
        validate_ticket(tk(**changes), TODAY)
    assert (info.value.field, str(info.value)) == (field, message)


def test_r11_validate_ticket_ok():
    for t in (
        tk(),
        tk(priority=Priority.URGENT, customer=GOLD),
        tk(status=Status.CLOSED, assignee="zed", created=TODAY),
        tk(subject="x" * 80, tags=tuple("abcdefgh")),
    ):
        assert validate_ticket(t, TODAY) == t


def test_r11_assign():
    t = tk("T-4")
    out = assign(t, AGENTS, TODAY)
    assert out == dataclasses.replace(
        t, assignee="bruno", history=(HistoryEntry(TODAY, "assigned:bruno"),)
    )
    assert t.assignee is None and t.history == ()
    assert (
        assign(
            tk("T-5", priority=Priority.URGENT, customer=GOLD), AGENTS, TODAY
        ).assignee
        == "ana"
    )
    assert assign(tk("T-5", customer=ENTERPRISE), AGENTS, TODAY).assignee == "ana"
    assert assign(tk("T-5"), AGENTS, TODAY).assignee == "carla"
    kept = tk(assignee="zed", history=(HistoryEntry(OLD, "x"),))
    assert assign(kept, (), TODAY) == kept
    with pytest.raises(NotFoundError):
        assign(tk(), (), TODAY)
    prior = tk(history=(HistoryEntry(OLD, "x"),))
    assert assign(prior, AGENTS, TODAY).history == (
        HistoryEntry(OLD, "x"),
        HistoryEntry(TODAY, "assigned:bruno"),
    )


def test_r11_r14_sla_deadline():
    assert sla_deadline(tk(priority=Priority.LOW)) == date(2024, 3, 16)
    assert sla_deadline(tk()) == date(2024, 3, 12)
    assert sla_deadline(tk(priority=Priority.HIGH)) == date(2024, 3, 10)
    assert sla_deadline(tk(priority=Priority.URGENT, customer=GOLD)) == date(2024, 3, 9)
    assert sla_deadline(tk(priority=Priority.LOW, customer=ENTERPRISE)) == date(
        2024, 3, 12
    )
    assert sla_deadline(tk(customer=ENTERPRISE)) == date(2024, 3, 10)
    assert sla_deadline(tk(priority=Priority.HIGH, customer=ENTERPRISE)) == date(
        2024, 3, 9
    )
    assert sla_deadline(tk(created=date(2024, 2, 28))) == date(2024, 3, 2)


def test_r11_r14_escalate():
    capped = tk(priority=Priority.HIGH, created=OLD)
    assert escalate(capped, TODAY) == capped
    g = tk(
        priority=Priority.HIGH,
        created=OLD,
        customer=GOLD,
        history=(HistoryEntry(OLD, "x"),),
    )
    once = escalate(g, TODAY)
    assert once == dataclasses.replace(
        g,
        priority=Priority.URGENT,
        history=(HistoryEntry(OLD, "x"), HistoryEntry(TODAY, "escalated")),
    )
    assert g.priority is Priority.HIGH and len(g.history) == 1
    assert escalate(once, TODAY) == once
    low = tk(priority=Priority.LOW, created=OLD)
    assert escalate(low, TODAY).priority is Priority.NORMAL
    assert (
        escalate(tk(created=date(2024, 3, 7)), TODAY).priority is Priority.NORMAL
    )  # vence hoje
    assert escalate(tk(created=date(2024, 3, 6)), TODAY).priority is Priority.HIGH
    for status in (Status.RESOLVED, Status.CLOSED):
        done = tk(created=OLD, status=status, assignee="zed")
        assert escalate(done, TODAY) == done
    assert (
        escalate(tk(created=OLD, status=Status.PENDING), TODAY).priority
        is Priority.HIGH
    )


def test_r14_escalate_once_per_day_compares_dates():
    today_done = tk(created=OLD, history=(HistoryEntry(TODAY, "escalated"),))
    assert escalate(today_done, TODAY) == today_done
    yesterday = tk(created=OLD, history=(HistoryEntry(date(2024, 3, 9), "escalated"),))
    out = escalate(yesterday, TODAY)
    assert out.priority is Priority.HIGH and out.history[-1] == HistoryEntry(
        TODAY, "escalated"
    )
    other_event = tk(created=OLD, history=(HistoryEntry(TODAY, "assigned:ana"),))
    assert escalate(other_event, TODAY).priority is Priority.HIGH
