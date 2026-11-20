"""Critérios de busca tipados."""

from dataclasses import dataclass

from helpdesk.errors import ValidationError
from helpdesk.models.enums import Priority, Status, Tier


@dataclass(frozen=True)
class Criteria:
    status: "Status | None" = None
    min_priority: "Priority | None" = None
    tag: "str | None" = None
    tier: "Tier | None" = None
    assignee: "str | None" = None
    text: "str | None" = None

    @classmethod
    def from_dict(cls, data):
        if data is None:
            return cls()
        for key in data:
            if key not in cls.__dataclass_fields__:
                raise ValidationError(f"unknown criterion: {key}", key)
        values = {}
        for key, value in data.items():
            if key in ("status", "min_priority", "tier"):
                parser = {"status": Status, "min_priority": Priority, "tier": Tier}[key]
                try:
                    values[key] = parser.parse(value)
                except ValidationError as exc:
                    raise ValidationError(str(exc), key) from None
                continue
            if not isinstance(value, str):
                raise ValidationError(f"bad {key}", key)
            values[key] = value.strip().lower() if key == "tag" else value
        return cls(**values)
