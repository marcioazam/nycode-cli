"""Verificações pequenas, reaproveitadas pelo validador."""

from helpdesk.errors import ValidationError


def fail(field, message):
    raise ValidationError(message, field)


def is_email(text):
    if text.count("@") != 1:
        return False
    local, domain = text.split("@")
    return (
        bool(local)
        and "." in domain
        and not domain.startswith(".")
        and not domain.endswith(".")
    )
