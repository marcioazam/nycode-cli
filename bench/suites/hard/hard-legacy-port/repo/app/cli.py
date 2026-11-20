"""CLI do balcão: ``python3 -m app.cli lote.txt``."""

import argparse
import sys

from legacy import frete_calc

from app import arquivos, lote, relatorio


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Cota os pedidos de um arquivo de lote.")
    ap.add_argument("arquivo")
    args = ap.parse_args(argv)
    try:
        pedidos = lote.parse_lote(arquivos.le_lote(args.arquivo))
    except (OSError, ValueError) as exc:
        print(f"erro: {exc}", file=sys.stderr)
        return 2
    frete_calc.zera()
    sys.stdout.write(relatorio.relatorio(pedidos))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
