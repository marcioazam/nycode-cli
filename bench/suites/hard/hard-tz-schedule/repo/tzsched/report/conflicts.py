"""Detecção de sobreposição entre ocorrências (intervalos semiabertos em UTC)."""

from tzsched.model.occurrence import Occurrence


def overlaps(a: Occurrence, b: Occurrence) -> bool:
    return a.start_utc < b.end_utc and b.start_utc < a.end_utc


def conflicting_ids(items: list[Occurrence]) -> set[tuple[str, object]]:
    out = set()
    for i, a in enumerate(items):
        for b in items[i + 1 :]:
            if overlaps(a, b):
                out.add((a.series_id, a.start_utc))
                out.add((b.series_id, b.start_utc))
    return out
