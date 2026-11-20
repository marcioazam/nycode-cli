"""Command line entry point (SPEC sections 8 and 9)."""

import argparse
import sys

from reportkit.errors import ReportError
from reportkit.pipeline import run_with_warnings


def build_parser():
    parser = argparse.ArgumentParser(
        prog="reportkit", description="Sales report from an orders CSV."
    )
    parser.add_argument("input", help="path of the orders CSV (UTF-8)")
    parser.add_argument(
        "-f", "--format", default="text", help="text, csv or json (default: text)"
    )
    parser.add_argument(
        "-o", "--output", help="write the result to this file instead of stdout"
    )
    parser.add_argument(
        "-r",
        "--report",
        default="summary",
        help="summary or monthly (default: summary)",
    )
    parser.add_argument(
        "--skip-invalid",
        action="store_true",
        help="drop invalid rows instead of failing",
    )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    # newline="" keeps CRLF and bare LF exactly as stored.
    with open(args.input, encoding="utf-8", newline="") as handle:
        text = handle.read()
    try:
        result, warnings = run_with_warnings(
            text, args.format, args.report, args.skip_invalid
        )
    except ReportError as exc:
        sys.stderr.write(f"error: {exc}\n")
        return 2
    for warning in warnings:
        sys.stderr.write(f"warning: {warning}\n")
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as handle:
            handle.write(result)
    else:
        sys.stdout.write(result)
    return 0
