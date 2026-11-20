"""Fachada da aplicação."""

from docflow.core import loader
from docflow.core.config import parse_spec
from docflow.core.pipeline import Pipeline
from docflow.registry import Registry, default_registry


class App:
    """Ponto de entrada: tem um registro próprio e roda pipelines nele."""

    def __init__(self, registry=None):
        if registry is None:
            loader.load_builtins()
            registry = Registry(parent=default_registry())
        elif not isinstance(registry, Registry):
            raise TypeError("registry must be a Registry")
        self.registry = registry

    def plugins(self):
        """Nomes de plugins disponíveis."""
        return self.registry.names()

    def enable(self, name):
        """Carrega um plugin (por exemplo um observer) e devolve a instância."""
        return self.registry.load(name)

    def disable(self, name):
        """Descarrega um plugin."""
        self.registry.unload(name)

    def run(self, spec, text):
        """Roda o pipeline descrito por spec ("strip|lower") sobre o texto."""
        pipeline = Pipeline(parse_spec(spec), self.registry)
        self.registry.emit("before_run", text)
        result = pipeline.run(text)
        self.registry.emit("after_run", result)
        return result

    def close(self):
        """Descarrega tudo, do mais recente para o mais antigo."""
        return self.registry.unload_all()
