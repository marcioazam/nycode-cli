"""Exceções públicas do docflow."""


class DocflowError(Exception):
    """Base de todos os erros do pacote."""


class PluginNotFoundError(DocflowError, KeyError):
    """Nenhum plugin registrado com o nome pedido."""

    def __str__(self):
        return "plugin not found: %s" % (self.args[0] if self.args else "?")


class DuplicatePluginError(DocflowError, ValueError):
    """Já existe um plugin registrado com o mesmo nome."""


class PipelineError(DocflowError):
    """Pipeline inválido (estágio que não é um transform, por exemplo)."""
