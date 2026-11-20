"""Classe base de plugin."""


class Plugin:
    """Um plugin tem nome, tipo, prioridade e dependências.

    kind: "transform" (entra em pipelines) ou "observer" (só reage a hooks).
    priority: número menor aparece primeiro nas listagens.
    requires: nomes de plugins que precisam estar carregados antes deste.
    registry / plugin_name: preenchidos pelo registro antes de setup().
    """

    name = ""
    kind = "transform"
    priority = 100
    requires = ()
    registry = None
    plugin_name = None

    def setup(self):
        """Chamado uma vez quando o plugin é carregado."""

    def teardown(self):
        """Chamado quando o plugin é descarregado."""

    def apply(self, text):
        """Transforma o texto (plugins "transform")."""
        return text
