from datetime import date

from helpdesk import Desk
from helpdesk.routing import escalate, sla_deadline
from helpdesk.stats import aging_buckets
from helpers import TODAY, raw


def test_sla_deadline_by_priority_and_tier():
    desk = Desk()
    t = desk.submit(raw(priority="high"), TODAY)["ticket"]
    assert sla_deadline(t) == date(2024, 3, 10)
    e = desk.submit(
        raw(
            "T-2",
            priority="normal",
            customer={"name": "A", "email": "a@b.co", "tier": "enterprise"},
        ),
        TODAY,
    )["ticket"]
    assert sla_deadline(e) == date(2024, 3, 10)


def test_escalate_caps_and_is_idempotent_per_day():
    desk = Desk()
    t = desk.submit(raw(priority="high", created="2024-03-01"), TODAY)["ticket"]
    assert escalate(t, TODAY)["priority"] == "high"  # standard não passa de high
    g = desk.submit(
        raw(
            "T-2",
            priority="high",
            created="2024-03-01",
            customer={"name": "A", "email": "a@b.co", "tier": "gold"},
        ),
        TODAY,
    )["ticket"]
    once = escalate(g, TODAY)
    assert once["priority"] == "urgent" and once["history"][-1] == {
        "at": "2024-03-10",
        "event": "escalated",
    }
    assert escalate(once, TODAY) == once
    assert g["priority"] == "high"


def test_report_escalate_all_and_aging():
    desk = Desk()
    desk.submit(raw("T-1", created="2024-03-01"), TODAY)
    desk.submit(raw("T-2", status="resolved"), TODAY)
    report = desk.report()
    assert report["total"] == 2 and report["by_status"] == {
        "open": 1,
        "pending": 0,
        "resolved": 1,
        "closed": 0,
    }
    assert report["open_by_tier"] == {"standard": 1, "gold": 0, "enterprise": 0}
    assert [t["id"] for t in desk.escalate_all(TODAY)] == ["T-1"]
    assert desk.get("T-1")["priority"] == "high"
    assert aging_buckets(desk.store.all(), TODAY) == {"0-1": 0, "2-7": 0, "8+": 1}
