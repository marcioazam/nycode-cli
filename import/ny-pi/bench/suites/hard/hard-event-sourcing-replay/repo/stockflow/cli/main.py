"""Comandos sobre um arquivo de eventos (um objeto JSON por linha)."""

import json
import sys

from ..errors import StockflowError
from ..events.codec import event_from_dict
from ..replay.full import replay_all
from ..services.reports import low_stock
from ..store.memory import InMemoryEventStore

USAGE = "usage: stockflow replay <events.jsonl> | low-stock <events.jsonl> <threshold>"


def load_store(path):
    store = InMemoryEventStore()
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                store.append(event_from_dict(json.loads(line)))
    return store


def jsonable(value):
    """Troca set por lista ordenada e tuple por lista, recursivamente."""
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted(jsonable(item) for item in value)
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    return value


def _run(args, out):
    if len(args) == 2 and args[0] == "replay":
        state = replay_all(load_store(args[1]))
        print(json.dumps(jsonable(state), sort_keys=True), file=out)
        return 0
    if len(args) == 3 and args[0] == "low-stock":
        for sku in low_stock(load_store(args[1]), int(args[2])):
            print(sku, file=out)
        return 0
    print(USAGE, file=out)
    return 1


def main(argv=None, out=None):
    """Retorna 0 (ok), 1 (uso incorreto) ou 2 (erro nos dados)."""
    out = sys.stdout if out is None else out
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        return _run(args, out)
    except (StockflowError, ValueError, OSError) as exc:
        print("error: " + str(exc), file=out)
        return 2


if __name__ == "__main__":
    sys.exit(main())
