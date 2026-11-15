"""Recuperação de erros: seção corrente e modo de descarte (docs/SPEC.md, regra 15)."""


class SectionState:
    def __init__(self) -> None:
        self.path: tuple[str, ...] = ()
        self.discard = False

    def enter(self, path: tuple[str, ...]) -> None:
        """Um cabeçalho válido abre a seção e volta ao modo normal."""
        self.path, self.discard = path, False

    def invalidate(self) -> None:
        """Depois de um cabeçalho inválido os valores são descartados até o próximo cabeçalho."""
        self.discard = True
