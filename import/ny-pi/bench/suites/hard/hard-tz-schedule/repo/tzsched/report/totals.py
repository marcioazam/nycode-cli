"""Totais por dia (tempo decorrido, não relógio de parede)."""

from tzsched.model.occurrence import Occurrence


def minutes(item: Occurrence) -> int:
    return int((item.end_utc - item.start_utc).total_seconds() // 60)


def day_total(items: list[Occurrence]) -> int:
    return sum(minutes(i) for i in items)
