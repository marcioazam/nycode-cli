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


class InvalidPluginNameError(DocflowError, ValueError):
    """Nome de plugin fora do formato aceito."""


class DependencyCycleError(DocflowError):
    """As dependências de um plugin formam um ciclo."""


class PluginInUseError(DocflowError):
    """O plugin está carregado ou outro plugin carregado depende dele."""


class PluginNotLoadedError(DocflowError):
    """O plugin não está carregado neste registro."""
