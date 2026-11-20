"""Prioridade, estado e plano do cliente."""

from enum import Enum, IntEnum

from helpdesk.errors import ValidationError


def _parse(cls, value, field):
    if isinstance(value, str):
        key = value.strip().lower()
        for member in cls:
            if member.label == key:
                return member
    names = ", ".join(member.label for member in cls)
    raise ValidationError(f"{field} must be one of {names}", field)


class Priority(IntEnum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4

    @property
    def label(self):
        return self.name.lower()

    @classmethod
    def parse(cls, value):
        return _parse(cls, value, "priority")


class Status(str, Enum):
    OPEN = "open"
    PENDING = "pending"
    RESOLVED = "resolved"
    CLOSED = "closed"

    @property
    def label(self):
        return self.value

    @property
    def is_open(self):
        return self in (Status.OPEN, Status.PENDING)

    @classmethod
    def parse(cls, value):
        return _parse(cls, value, "status")


class Tier(str, Enum):
    STANDARD = "standard"
    GOLD = "gold"
    ENTERPRISE = "enterprise"

    @property
    def label(self):
        return self.value

    @classmethod
    def parse(cls, value):
        return _parse(cls, value, "customer.tier")
