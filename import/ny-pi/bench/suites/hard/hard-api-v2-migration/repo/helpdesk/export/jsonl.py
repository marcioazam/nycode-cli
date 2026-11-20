"""Um ticket por linha, em JSON."""

import json


def dump_jsonl(tickets):
    return "".join(json.dumps(t, sort_keys=True) + "\n" for t in tickets)
