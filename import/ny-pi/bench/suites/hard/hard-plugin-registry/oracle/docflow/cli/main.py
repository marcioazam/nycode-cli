"""Entrada da CLI: `python3 -m docflow.cli.main <comando> ...`."""

import sys

from docflow.cli import commands
from docflow.errors import DocflowError

USAGE = "usage: docflow list | info <name> | run <spec> <text>"


def run_cli(argv, registry=None):
    """Executa o comando e devolve (código de saída, texto)."""
    if not argv:
        return 2, USAGE
    command, args = argv[0], list(argv[1:])
    app = commands.make_app(registry)
    try:
        if command == "list" and not args:
            return 0, commands.cmd_list(app)
        if command == "info" and len(args) == 1:
            return 0, commands.cmd_info(app, args[0])
        if command == "run" and len(args) == 2:
            return 0, commands.cmd_run(app, args[0], args[1])
    except DocflowError as exc:
        return 1, f"error: {exc}"
    if command in ("list", "info", "run"):
        return 2, USAGE
    return 2, f"unknown command: {command}"


def main(argv=None):
    code, text = run_cli(sys.argv[1:] if argv is None else argv)
    print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
