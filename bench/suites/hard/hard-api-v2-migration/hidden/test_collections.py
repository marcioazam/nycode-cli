import dataclasses
import json
from datetime import date

import pytest
from helpdesk.errors import NotFoundError, ValidationError
from helpdesk.export import dump_jsonl, to_rows
from helpdesk.models import (
    Criteria,
    Priority,
    Status,
    Summary,
    Ticket,
    Tier,
)
from helpdesk.notify import build_digest, render_notification
from helpdesk.search import filter_tickets, sort_tickets
from helpdesk.stats import aging_buckets, summarize
from helpdesk.store import TicketStore
from v2data import GOLD, OLD, TODAY, ids, some, tk


def test_r11_filter_tickets():
    items = some()
    assert ids(filter_tickets(items, Criteria())) == [
        "T-1",
        "T-2",
        "T-3",
        "T-10",
        "T-9",
    ]
    assert ids(filter_tickets(items, Criteria(min_priority=Priority.HIGH))) == [
        "T-2",
        "T-3",
        "T-10",
        "T-9",
    ]
    assert ids(filter_tickets(items, Criteria(status=Status.PENDING))) == ["T-3"]
    assert ids(filter_tickets(items, Criteria(tag="net"))) == ["T-1"]
    assert ids(filter_tickets(items, Criteria(tier=Tier.ENTERPRISE))) == ["T-9"]
    assert ids(filter_tickets(items, Criteria(assignee="ana"))) == ["T-2"]
    assert ids(filter_tickets(items, Criteria(text="DiSk"))) == ["T-1", "T-2"]
    assert ids(
        filter_tickets(items, Criteria(text="disk", min_priority=Priority.HIGH))
    ) == ["T-2"]
    assert ids(
        filter_tickets(items, Criteria.from_dict({"tag": " NET ", "status": "open"}))
    ) == ["T-1"]


def test_r11_sort_tickets():
    items = some()
    assert ids(sort_tickets(items)) == ["T-3", "T-2", "T-9", "T-10", "T-1"]
    assert ids(sort_tickets(items, "created")) == ["T-2", "T-9", "T-10", "T-1", "T-3"]
    assert ids(sort_tickets(items, "sla")) == ["T-9", "T-2", "T-10", "T-3", "T-1"]
    with pytest.raises(ValueError):
        sort_tickets(items, "random")
    with pytest.raises(ValueError):
        sort_tickets([], "random")


def test_r11_summarize_and_aging():
    s = summarize(some())
    assert s == Summary(
        total=5,
        by_status={"open": 3, "pending": 1, "resolved": 1, "closed": 0},
        by_priority={"low": 1, "normal": 0, "high": 3, "urgent": 1},
        open_by_tier={"standard": 2, "gold": 1, "enterprise": 1},
    )
    assert summarize([]).to_dict() == {
        "total": 0,
        "by_status": {"open": 0, "pending": 0, "resolved": 0, "closed": 0},
        "by_priority": {"low": 0, "normal": 0, "high": 0, "urgent": 0},
        "open_by_tier": {"standard": 0, "gold": 0, "enterprise": 0},
    }
    assert aging_buckets(some(), TODAY) == {"0-1": 2, "2-7": 2, "8+": 0}
    extra = [
        tk(created=OLD),
        tk(created=date(2024, 3, 2)),
        tk(created=date(2024, 3, 20)),
    ]
    assert aging_buckets(extra, TODAY) == {"0-1": 1, "2-7": 0, "8+": 2}


def test_r11_notify():
    assert (
        render_notification(tk(priority=Priority.HIGH))
        == "[HIGH] T-1 Printer on fire (Ana Souza) due 2024-03-10"
    )
    assert (
        build_digest(some())
        == "Digest: 4 open\n[URGENT] T-3 Printer on fire (Bia) due 2024-03-09\n[HIGH] T-2 Disk full (Ana Souza) due 2024-03-06\n[HIGH] T-9 Printer on fire (Caio) due 2024-03-05\n[LOW] T-1 Printer on fire (Ana Souza) due 2024-03-16"
    )
    assert build_digest([]) == "Digest: 0 open"


def test_r11_export():
    items = [
        tk(priority=Priority.HIGH, tags=("a", "b")),
        tk("T-2", customer=GOLD, assignee="zed", extra={"o": 1}),
    ]
    assert to_rows(items) == [
        ["id", "priority", "status", "tier", "assignee", "created", "tags"],
        ["T-1", "high", "open", "standard", "", "2024-03-09", "a;b"],
        ["T-2", "normal", "open", "gold", "zed", "2024-03-09", ""],
    ]
    text = dump_jsonl(items)
    assert text == "".join(
        json.dumps(t.to_dict(), sort_keys=True) + "\n" for t in items
    )
    second = json.loads(text.splitlines()[1])
    assert (
        second["o"] == 1
        and second["customer"]["tier"] == "gold"
        and second["created"] == "2024-03-09"
    )
    assert dump_jsonl([]) == "" and to_rows([])[1:] == []


def test_r11_store():
    store = TicketStore()
    a, b, c = tk("T-10"), tk("T-9"), tk("T-3", created=OLD)
    for t in (a, b, c):
        assert store.add(t) is None
    assert (
        len(store) == 3
        and store.get("T-9") == b
        and isinstance(store.get("T-9"), Ticket)
    )
    assert store.all() == [c, b, a]
    with pytest.raises(ValidationError) as info:
        store.add(tk("T-9", subject="other"))
    assert (info.value.field, str(info.value)) == ("id", "duplicate id: T-9")
    assert store.get("T-9").subject == "Printer on fire"
    changed = dataclasses.replace(b, priority=Priority.HIGH)
    assert store.update(changed) is None and store.get("T-9") == changed
    with pytest.raises(NotFoundError):
        store.update(tk("T-77"))
    with pytest.raises(NotFoundError):
        store.get("T-77")
