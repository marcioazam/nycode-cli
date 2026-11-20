"""Linha de comando: valida um arquivo e imprime os diagnósticos."""

import sys

from cfgparse.api import parse
from cfgparse.util.text import format_diagnostics


def main(argv: list[str]) -> int:
    with open(argv[0], encoding="utf-8", newline="") as fh:
        result = parse(fh.read())
    if result.diagnostics:
        print(format_diagnostics(result.diagnostics))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
