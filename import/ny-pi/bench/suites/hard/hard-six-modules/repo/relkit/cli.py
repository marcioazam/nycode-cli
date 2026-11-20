"""Linha de comando: ``python3 -m relkit report manifest.ini files.json``."""

import argparse
import sys

from relkit.errors import RelkitError
from relkit.report.build import build_report
from relkit.report.model import load_entries


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="relkit")
    sub = parser.add_subparsers(dest="command", required=True)
    report = sub.add_parser("report", help="imprime o relatório de release")
    report.add_argument("manifest")
    report.add_argument("files")
    report.add_argument("--history", default="", help="versões separadas por vírgula")
    args = parser.parse_args(argv)

    history = [item for item in args.history.split(",") if item]
    try:
        entries = load_entries(_read(args.files))
        print(build_report(_read(args.manifest), entries, history))
    except RelkitError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0
