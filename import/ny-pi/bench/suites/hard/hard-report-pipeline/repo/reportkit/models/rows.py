from dataclasses import dataclass


@dataclass(frozen=True)
class RawRow:
    """One data record as read: 1-based starting line and column -> text."""

    line: int
    fields: dict
