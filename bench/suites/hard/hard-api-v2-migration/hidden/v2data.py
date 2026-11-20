"""Dados compartilhados pelos testes ocultos."""

from datetime import date

from helpdesk.models import Customer, Priority, Status, Ticket, Tier

TODAY = date(2024, 3, 10)
ANA = Customer("Ana Souza", "ana@example.com")
GOLD = Customer("Bia", "b@x.io", Tier.GOLD)
ENTERPRISE = Customer("Caio", "c@x.io", Tier.ENTERPRISE)


def raw(id="T-1", **changes):
    data = {
        "id": id,
        "customer": {"name": "Ana Souza", "email": "ana@example.com"},
        "subject": "Printer on fire",
        "created": "2024-03-09",
    }
    data.update(changes)
    return data


def tk(id="T-1", **changes):
    fields = {
        "id": id,
        "customer": ANA,
        "subject": "Printer on fire",
        "created": date(2024, 3, 9),
    }
    fields.update(changes)
    return Ticket(**fields)


AGENTS = ("ana", "bruno", "carla")
OLD = date(2024, 3, 1)


def some():
    return [
        tk("T-1", priority=Priority.LOW, tags=("net",), body="Cable DISK"),
        tk(
            "T-2",
            priority=Priority.HIGH,
            subject="Disk full",
            created=date(2024, 3, 5),
            assignee="ana",
        ),
        tk("T-3", priority=Priority.URGENT, customer=GOLD, status=Status.PENDING),
        tk(
            "T-10",
            priority=Priority.HIGH,
            created=date(2024, 3, 5),
            status=Status.RESOLVED,
            assignee="zed",
        ),
        tk(
            "T-9", priority=Priority.HIGH, created=date(2024, 3, 5), customer=ENTERPRISE
        ),
    ]


def ids(tickets):
    assert all(isinstance(t, Ticket) for t in tickets)
    return [t.id for t in tickets]


RICH = raw(
    "T-4",
    subject="  Hello  ",
    body="b",
    priority="High",
    tags=["B", "a", "b", " "],
    customer={"name": " Ana ", "email": " ANA@Example.com ", "tier": " GOLD "},
    history=[{"at": "2024-03-08", "event": "x"}, {"at": "2024-03-01", "event": "y"}],
    origin={"via": "mail"},
)
RICH_OUT = {
    "id": "T-4",
    "customer": {"name": "Ana", "email": "ana@example.com", "tier": "gold"},
    "subject": "Hello",
    "body": "b",
    "priority": "high",
    "tags": ["a", "b"],
    "status": "open",
    "created": "2024-03-09",
    "assignee": "bruno",
    "history": [
        {"at": "2024-03-01", "event": "y"},
        {"at": "2024-03-08", "event": "x"},
        {"at": "2024-03-10", "event": "assigned:bruno"},
    ],
    "origin": {"via": "mail"},
}
