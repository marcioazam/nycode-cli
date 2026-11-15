"""Um ticket por linha, em JSON (formato legado)."""

import json

from helpdesk.models.guard import require_tickets


def dump_jsonl(tickets):
    return "".join(
        json.dumps(t.to_dict(), sort_keys=True) + "\n" for t in require_tickets(tickets)
    )
