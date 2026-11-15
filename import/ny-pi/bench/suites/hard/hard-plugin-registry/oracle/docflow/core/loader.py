"""Carga dos plugins embutidos e de listas de plugins."""

from docflow.plugins import install_builtins
from docflow.registry import default_registry


def _pick(registry):
    return default_registry() if registry is None else registry


def load_builtins(registry=None):
    """Instala os plugins embutidos no registro (o default, se omitido)."""
    install_builtins(_pick(registry))


def load_plugins(names, registry=None):
    """Carrega os plugins pedidos e devolve as instâncias, na mesma ordem."""
    registry = _pick(registry)
    return [registry.load(name) for name in names]
