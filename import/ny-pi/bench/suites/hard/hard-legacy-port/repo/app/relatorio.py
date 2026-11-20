"""Relatório do lote: etiquetas, erros e rodapé (usa o legado)."""

from legacy import frete_calc, frete_fmt

from app import config


def relatorio(pedidos) -> str:
    blocos = []
    ok = 0
    erros = 0
    total = 0
    for indice, pedido in enumerate(pedidos, start=1):
        cod, res = frete_calc.calcula(pedido)
        if cod != frete_calc.OK:
            erros += 1
            blocos.append(
                "PEDIDO %d: ERRO %d - %s" % (indice, cod, config.mensagem(cod))  # noqa: UP031
            )
            continue
        ok += 1
        total += res["total"]
        blocos.append(frete_fmt.etiqueta(res))
    blocos.append(frete_fmt.rodape(ok, erros, total))
    return "\n\n".join(blocos) + "\n"
