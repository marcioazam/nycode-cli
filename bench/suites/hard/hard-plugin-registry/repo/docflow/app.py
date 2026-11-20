"""Fachada da aplicação."""

from docflow import hooks, registry
from docflow.core import loader
from docflow.core.config import parse_spec
from docflow.core.pipeline import Pipeline


class App:
    """Ponto de entrada: carrega os plugins embutidos e roda pipelines."""

    def __init__(self):
        loader.load_builtins()

    def plugins(self):
        """Nomes de plugins disponíveis."""
        return registry.names()

    def enable(self, name):
        """Carrega um plugin (por exemplo um observer) e devolve a instância."""
        return registry.load(name)

    def disable(self, name):
        """Descarrega um plugin."""
        registry.unload(name)

    def run(self, spec, text):
        """Roda o pipeline descrito por spec ("strip|lower") sobre o texto."""
        pipeline = Pipeline(parse_spec(spec))
        hooks.emit("before_run", text)
        result = pipeline.run(text)
        hooks.emit("after_run", result)
        return result

    def close(self):
        """Descarrega tudo, do mais recente para o mais antigo."""
        unloaded = []
        for name in reversed(registry.loaded()):
            registry.unload(name)
            unloaded.append(name)
        return unloaded
