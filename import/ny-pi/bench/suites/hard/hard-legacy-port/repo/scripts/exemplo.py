"""Exemplo de uso do legado: ``python3 scripts/exemplo.py`` a partir da raiz."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from legacy import frete_calc, frete_fmt


def main() -> None:
    frete_calc.zera()
    cod, res = frete_calc.calcula(
        {
            "cep": "04567-000",
            "serv": "E",
            "cupom": "frete10",
            "itens": [(1200, 30, 20, 10, 2, 15000)],
        }
    )
    print(frete_fmt.etiqueta(res) if cod == frete_calc.OK else "erro %d" % cod)  # noqa: UP031


if __name__ == "__main__":
    main()
