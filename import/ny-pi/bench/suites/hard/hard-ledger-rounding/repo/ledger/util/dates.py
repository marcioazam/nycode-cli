"""Datas ISO."""

from datetime import date


def parse_date(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except (TypeError, ValueError):
        raise ValueError(f"data inválida: {text!r}") from None


def days_between(start: str, end: str) -> int:
    return (parse_date(end) - parse_date(start)).days
