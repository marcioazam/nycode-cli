"""Exceções do pacote; `codigo` é o código numérico do legado."""


class ErroFrete(Exception):
    codigo = 0


class ErroPedidoVazio(ErroFrete):
    codigo = 1


class ErroCep(ErroFrete):
    codigo = 2


class ErroItem(ErroFrete):
    codigo = 3


class ErroServico(ErroFrete):
    codigo = 4


class ErroPeso(ErroFrete):
    codigo = 5
