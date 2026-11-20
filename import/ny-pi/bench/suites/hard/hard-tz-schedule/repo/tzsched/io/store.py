"""Carrega um calendário a partir de registros."""

from tzsched.io.parse import series_from_dict
from tzsched.model.attendee import Attendee
from tzsched.model.calendar import Calendar


def load_calendar(records: list[dict], attendees: list[dict] | None = None) -> Calendar:
    cal = Calendar()
    for r in records:
        cal.add(series_from_dict(r))
    for a in attendees or []:
        cal.add_attendee(Attendee(a["name"], a["zone"]))
    return cal
