"""Ticket tipado e a conversão de/para o dict legado."""

import copy
from dataclasses import dataclass, field
from datetime import date

from helpdesk.dates import parse_date
from helpdesk.errors import ValidationError
from helpdesk.models.enums import Priority, Status, Tier

_KNOWN = {
    "id",
    "customer",
    "subject",
    "body",
    "priority",
    "tags",
    "status",
    "created",
    "assignee",
    "history",
}


@dataclass(frozen=True)
class Customer:
    name: str
    email: str
    tier: Tier = Tier.STANDARD


@dataclass(frozen=True)
class HistoryEntry:
    at: date
    event: str


@dataclass(frozen=True)
class Ticket:
    id: str
    customer: Customer
    subject: str
    created: date
    priority: Priority = Priority.NORMAL
    status: Status = Status.OPEN
    body: str = ""
    tags: tuple = ()
    assignee: "str | None" = None
    history: tuple = ()
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise TypeError("ticket must be a dict")
        for key in ("id", "customer", "subject", "created"):
            if key not in data:
                raise ValidationError(f"{key} is required", key)
        tags = data.get("tags", [])
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            raise ValidationError("tags must be a list of strings", "tags")
        assignee = data.get("assignee")
        if assignee is not None and not isinstance(assignee, str):
            raise ValidationError("assignee must be a string or null", "assignee")
        created = parse_date(data["created"])
        return cls(
            id=_text(data, "id"),
            customer=_customer(data["customer"]),
            subject=_text(data, "subject"),
            created=created,
            body=_text(data, "body") if "body" in data else "",
            priority=Priority.parse(data.get("priority", "normal")),
            status=Status.parse(data.get("status", "open")),
            tags=tuple(tags),
            assignee=assignee,
            history=_history(data.get("history", [])),
            extra={k: copy.deepcopy(v) for k, v in data.items() if k not in _KNOWN},
        )

    def to_dict(self):
        out = {
            "id": self.id,
            "customer": {
                "name": self.customer.name,
                "email": self.customer.email,
                "tier": self.customer.tier.label,
            },
            "subject": self.subject,
            "body": self.body,
            "priority": self.priority.label,
            "tags": list(self.tags),
            "status": self.status.label,
            "created": self.created.isoformat(),
            "assignee": self.assignee,
            "history": [
                {"at": h.at.isoformat(), "event": h.event} for h in self.history
            ],
        }
        out.update(copy.deepcopy(self.extra))
        return out


def _text(data, key, name=None):
    value = data[key]
    if not isinstance(value, str):
        raise ValidationError("%s must be a string" % (name or key), name or key)
    return value


def _customer(raw):
    if not isinstance(raw, dict):
        raise ValidationError("customer must be an object", "customer")
    for key in ("name", "email"):
        if key not in raw:
            raise ValidationError(f"customer.{key} is required", "customer." + key)
    return Customer(
        _text(raw, "name", "customer.name"),
        _text(raw, "email", "customer.email"),
        Tier.parse(raw.get("tier", "standard")),
    )


def _history(raw):
    if not isinstance(raw, list):
        raise ValidationError("history must be a list", "history")
    out = []
    for entry in raw:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("event"), str)
            or "at" not in entry
        ):
            raise ValidationError("bad history entry", "history")
        out.append(HistoryEntry(parse_date(entry["at"], "history"), entry["event"]))
    return tuple(out)
