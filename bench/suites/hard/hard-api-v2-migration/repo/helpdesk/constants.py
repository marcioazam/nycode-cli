"""Valores fixos do domínio."""

PRIORITIES = ("low", "normal", "high", "urgent")
STATUSES = ("open", "pending", "resolved", "closed")
TIERS = ("standard", "gold", "enterprise")
OPEN_STATUSES = ("open", "pending")

SLA_DAYS = {"low": 7, "normal": 3, "high": 1, "urgent": 0}

MAX_SUBJECT = 80
MAX_TAGS = 8
MAX_TAG_LEN = 20
