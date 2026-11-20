"""Mensagens exibidas ao operador para cada código de erro do legado."""

MENSAGENS = {
    1: "pedido sem itens",
    2: "CEP invalido",
    3: "item invalido",
    4: "servico indisponivel para o destino",
    5: "peso acima do limite",
}

COMENTARIO = "#"
SEP_CAMPO = ";"
SEP_ITEM = "|"
SEP_VALOR = ","


def mensagem(codigo: int) -> str:
    return MENSAGENS.get(codigo, "erro %d" % codigo)  # noqa: UP031
