"""Validação de um ticket canônico (dict)."""

import re

from helpdesk import constants
from helpdesk.dates import parse_date
from helpdesk.validation.rules import fail, is_email

_ID = re.compile(r"T-\d+")


def validate_ticket(ticket, today):
    """Devolve o ticket se ele for válido; senão levanta ValidationError (1º erro)."""
    if not _ID.fullmatch(ticket["id"]):
        fail("id", "id must look like T-123")
    if not is_email(ticket["customer"]["email"]):
        fail("customer.email", "invalid email")
    if not ticket["customer"]["name"]:
        fail("customer.name", "name is required")
    if not 1 <= len(ticket["subject"]) <= constants.MAX_SUBJECT:
        fail("subject", f"subject must have 1..{constants.MAX_SUBJECT} characters")
    if ticket["priority"] == "urgent" and ticket["customer"]["tier"] == "standard":
        fail("priority", "urgent needs a gold or enterprise customer")
    tags = ticket["tags"]
    if len(tags) > constants.MAX_TAGS or any(
        len(t) > constants.MAX_TAG_LEN for t in tags
    ):
        fail("tags", "too many or too long tags")
    if ticket["status"] == "closed" and ticket["assignee"] is None:
        fail("status", "a closed ticket needs an assignee")
    if parse_date(ticket["created"]) > today:
        fail("created", "created is in the future")
    return ticket
