import sys

from ingest.errors import IngestError
from ingest.loader import load


def main(argv):
    strict = argv[:1] == ["--strict"]
    path = argv[1] if strict else argv[0]
    with open(path) as f:
        lines = f.read().splitlines()
    try:
        records, errors = load(lines, strict=strict)
    except IngestError as e:
        print(e, file=sys.stderr)
        return 2
    for r in records:
        print(f"{r['name']} {r['qty']} {r['price']}")
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0
