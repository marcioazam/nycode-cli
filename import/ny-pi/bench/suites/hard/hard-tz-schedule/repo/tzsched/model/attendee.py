"""Quem visualiza o relatório."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Attendee:
    name: str
    zone: str
