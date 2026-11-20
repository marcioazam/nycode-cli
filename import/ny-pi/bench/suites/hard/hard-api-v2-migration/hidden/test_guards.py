import pytest
from helpdesk.export import dump_jsonl, to_rows
from helpdesk.intake import normalize_ticket
from helpdesk.models import (
    Criteria,
    Customer,
)
from helpdesk.notify import build_digest, render_notification
from helpdesk.routing import assign, escalate, sla_deadline
from helpdesk.search import filter_tickets, sort_tickets
from helpdesk.stats import aging_buckets, summarize
from helpdesk.store import TicketStore
from helpdesk.validation import validate_ticket
from v2data import AGENTS, ANA, OLD, TODAY, ids, raw, some, tk

V1 = {
    "id": "T-2",
    "customer": {"name": "A", "email": "a@b.co", "tier": "standard"},
    "subject": "S",
    "body": "",
    "priority": "normal",
    "tags": [],
    "status": "closed",
    "created": "2024-03-09",
    "assignee": "zed",
    "history": [],
}
ONE = [
    lambda x: normalize_ticket(x),
    lambda x: validate_ticket(x, TODAY),
    lambda x: assign(x, AGENTS, TODAY),
    lambda x: assign(x, (), TODAY),
    lambda x: sla_deadline(x),
    lambda x: escalate(x, TODAY),
    lambda x: render_notification(x),
    lambda x: TicketStore().add(x),
    lambda x: TicketStore().update(x),
]
MANY = [
    lambda xs: filter_tickets(xs, Criteria()),
    lambda xs: sort_tickets(xs),
    lambda xs: sort_tickets(xs, "bogus"),
    lambda xs: summarize(xs),
    lambda xs: aging_buckets(xs, TODAY),
    lambda xs: build_digest(xs),
    lambda xs: to_rows(xs),
    lambda xs: dump_jsonl(xs),
]
BAD = [
    (dict(V1), "dict"),
    (None, "NoneType"),
    ("T-1", "str"),
    (raw(), "dict"),
    (("T-1",), "tuple"),
]


@pytest.mark.parametrize("call", ONE)
@pytest.mark.parametrize("bad,name", BAD)
def test_r12_single_ticket_functions_reject_non_tickets(call, bad, name):
    with pytest.raises(TypeError) as info:
        call(bad)
    assert str(info.value) == "expected Ticket, got " + name


@pytest.mark.parametrize("call", MANY)
@pytest.mark.parametrize("bad,name", BAD)
def test_r12_list_functions_reject_any_non_ticket(call, bad, name):
    for items in ([bad], [tk(), bad], [tk(), tk("T-3"), bad, tk("T-4")]):
        with pytest.raises(TypeError) as info:
            call(items)
        assert str(info.value) == "expected Ticket, got " + name


def test_r12_store_keeps_nothing_and_criteria_is_checked_first():
    store = TicketStore()
    with pytest.raises(TypeError):
        store.add(dict(V1))
    assert len(store) == 0 and store.all() == []
    for bad, name in (({}, "dict"), (None, "NoneType"), ({"tag": "net"}, "dict")):
        for items in ([], [tk()], [dict(V1)]):
            with pytest.raises(TypeError) as info:
                filter_tickets(items, bad)
            assert str(info.value) == "expected Criteria, got " + name
    with pytest.raises(TypeError) as info:
        filter_tickets([dict(V1)], Criteria(tag="zzz"))
    assert str(info.value) == "expected Ticket, got dict"


def test_r13_generators_are_accepted_and_read_once():
    def gen():
        yield from some()

    assert ids(filter_tickets(gen(), Criteria(tag="net"))) == ["T-1"]
    assert ids(sort_tickets(gen(), "created")) == ["T-2", "T-9", "T-10", "T-1", "T-3"]
    assert summarize(gen()).total == 5 and summarize(gen()).by_status["open"] == 3
    assert aging_buckets(gen(), TODAY) == {"0-1": 2, "2-7": 2, "8+": 0}
    assert (
        build_digest(gen()).splitlines()[0] == "Digest: 4 open"
        and len(build_digest(gen()).splitlines()) == 5
    )
    assert len(to_rows(gen())) == 6 and len(dump_jsonl(gen()).splitlines()) == 5
    with pytest.raises(TypeError):
        summarize(t for t in [tk(), dict(V1)])


def test_r14_nothing_is_mutated():
    t = tk("T-4", created=OLD, tags=("B", "a"), extra={"o": [1]})
    snapshot = t.to_dict()
    normalize_ticket(t)
    validate_ticket(t, TODAY)
    assign(t, AGENTS, TODAY)
    escalate(t, TODAY)
    sort_tickets([t])
    summarize([t])
    to_rows([t])
    dump_jsonl([t])
    store = TicketStore()
    store.add(t)
    assert t.to_dict() == snapshot and t == tk(
        "T-4", created=OLD, tags=("B", "a"), extra={"o": [1]}
    )
    assert store.get("T-4") == t and ANA == Customer("Ana Souza", "ana@example.com")
