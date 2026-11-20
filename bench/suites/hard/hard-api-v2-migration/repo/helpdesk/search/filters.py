"""Filtro de tickets por critérios (todos precisam casar)."""

from helpdesk import constants
from helpdesk.errors import ValidationError

_KEYS = {"status", "min_priority", "tag", "tier", "assignee", "text"}


def _check(criteria):
    for key in criteria:
        if key not in _KEYS:
            raise ValidationError(f"unknown criterion: {key}", key)
    for key, allowed in (
        ("status", constants.STATUSES),
        ("tier", constants.TIERS),
        ("min_priority", constants.PRIORITIES),
    ):
        if key in criteria and (
            not isinstance(criteria[key], str)
            or criteria[key].strip().lower() not in allowed
        ):
            raise ValidationError(f"bad {key}", key)


def _matches(ticket, criteria):
    rank = constants.PRIORITIES.index
    if "status" in criteria and ticket["status"] != criteria["status"].strip().lower():
        return False
    if "min_priority" in criteria and rank(ticket["priority"]) < rank(
        criteria["min_priority"].strip().lower()
    ):
        return False
    if "tag" in criteria and criteria["tag"].strip().lower() not in ticket["tags"]:
        return False
    if (
        "tier" in criteria
        and ticket["customer"]["tier"] != criteria["tier"].strip().lower()
    ):
        return False
    if "assignee" in criteria and ticket["assignee"] != criteria["assignee"]:
        return False
    if "text" in criteria:
        needle = criteria["text"].lower()
        if (
            needle not in ticket["subject"].lower()
            and needle not in ticket["body"].lower()
        ):
            return False
    return True


def filter_tickets(tickets, criteria):
    _check(criteria)
    return [t for t in tickets if _matches(t, criteria)]
