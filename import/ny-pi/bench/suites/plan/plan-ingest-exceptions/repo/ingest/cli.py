import sys

from ingest.loader import load


def main(argv):
    with open(argv[0]) as f:
        records, errors = load(f.read().splitlines())
    for r in records:
        print(f"{r['name']} {r['qty']} {r['price']}")
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0
