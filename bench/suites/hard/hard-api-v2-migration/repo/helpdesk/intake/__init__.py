"""Entrada de dados: formato canônico e normalização."""

from helpdesk.intake.defaults import canonicalize
from helpdesk.intake.normalize import normalize_ticket

__all__ = ["canonicalize", "normalize_ticket"]
