"""Leitura do arquivo de lote: uma linha por pedido.

Formato: ``cep;servico;cupom;p,c,l,a,q,v|p,c,l,a,q,v``
"""

from app import config


def parse_linha(linha: str) -> dict:
    campos = linha.strip().split(config.SEP_CAMPO)
    if len(campos) != 4:
        raise ValueError(f"linha de lote precisa de 4 campos: {linha!r}")
    cep, serv, cupom, bruto = campos
    itens = []
    for pedaco in bruto.split(config.SEP_ITEM):
        if pedaco.strip() == "":
            continue
        valores = tuple(v.strip() for v in pedaco.split(config.SEP_VALOR))
        if len(valores) not in (5, 6):
            raise ValueError(f"item precisa de 5 ou 6 valores: {pedaco!r}")
        itens.append(valores)
    return {"cep": cep, "serv": serv, "cupom": cupom, "itens": itens}


def parse_lote(linhas) -> list:
    return [parse_linha(l) for l in linhas]
