"""Customer types that pay no sales tax."""

from pricing import config


def is_exempt(customer_type: str | None) -> bool:
    return customer_type in config.EXEMPT_CUSTOMER_TYPES
