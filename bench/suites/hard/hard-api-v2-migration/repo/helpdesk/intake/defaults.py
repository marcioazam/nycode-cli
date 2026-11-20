"""Do dict de entrada ao dict canônico (padrões aplicados, tipos conferidos)."""

import copy

from helpdesk import constants
from helpdesk.dates import parse_date
from helpdesk.errors import ValidationError

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


def _text(data, key, field=None):
    value = data[key]
    if not isinstance(value, str):
        raise ValidationError("%s must be a string" % (field or key), field or key)
    return value


def _choice(value, allowed, field):
    if not isinstance(value, str) or value.strip().lower() not in allowed:
        raise ValidationError(
            "{} must be one of {}".format(field, ", ".join(allowed)), field
        )
    return value.strip().lower()


def _customer(raw):
    if not isinstance(raw, dict):
        raise ValidationError("customer must be an object", "customer")
    for key in ("name", "email"):
        if key not in raw:
            raise ValidationError(f"customer.{key} is required", "customer." + key)
    return {
        "name": _text(raw, "name", "customer.name"),
        "email": _text(raw, "email", "customer.email"),
        "tier": _choice(raw.get("tier", "standard"), constants.TIERS, "customer.tier"),
    }


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
        parse_date(entry["at"], "history")
        out.append({"at": entry["at"], "event": entry["event"]})
    return out


def canonicalize(data):
    """Dict canônico com todas as chaves; chaves desconhecidas são preservadas."""
    for key in ("id", "customer", "subject", "created"):
        if key not in data:
            raise ValidationError(f"{key} is required", key)
    tags = data.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValidationError("tags must be a list of strings", "tags")
    assignee = data.get("assignee")
    if assignee is not None and not isinstance(assignee, str):
        raise ValidationError("assignee must be a string or null", "assignee")
    parse_date(data["created"])
    out = {
        "id": _text(data, "id"),
        "customer": _customer(data["customer"]),
        "subject": _text(data, "subject"),
        "body": _text(data, "body") if "body" in data else "",
        "priority": _choice(
            data.get("priority", "normal"), constants.PRIORITIES, "priority"
        ),
        "tags": list(tags),
        "status": _choice(data.get("status", "open"), constants.STATUSES, "status"),
        "created": data["created"],
        "assignee": assignee,
        "history": _history(data.get("history", [])),
    }
    for key, value in data.items():
        if key not in _KNOWN:
            out[key] = copy.deepcopy(value)
    return out
