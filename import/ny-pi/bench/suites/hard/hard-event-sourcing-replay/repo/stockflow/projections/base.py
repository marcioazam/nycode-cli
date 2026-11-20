"""Contrato das projeções."""


class Projection:
    """Redutor sem estado próprio: o estado é passado a cada chamada.

    name: chave do estado dentro do agregado.
    kind: tipo de agregado atendido ("sku", "order") ou "*" para todos.
    """

    name = ""
    kind = "*"

    def initial(self):
        """Estado de um agregado antes do primeiro evento (objeto novo)."""
        raise NotImplementedError

    def apply(self, state, event):
        """Aplica um evento alterando state no lugar."""
        raise NotImplementedError
