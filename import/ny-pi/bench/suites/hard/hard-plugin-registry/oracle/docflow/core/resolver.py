"""Resolução de plugins por nome e por tipo."""

from docflow.naming import normalize_name
from docflow.registry import default_registry


def _pick(registry):
    return default_registry() if registry is None else registry


def resolve(name, registry=None):
    """Classe do plugin com esse nome."""
    return _pick(registry).get(name)


def by_kind(kind, registry=None):
    """Nomes dos plugins desse tipo, na ordem de listagem do registro."""
    registry = _pick(registry)
    return [name for name in registry.names() if registry.get(name).kind == kind]


def describe(name, registry=None):
    """Dados de exibição de um plugin."""
    registry = _pick(registry)
    cls = registry.get(name)
    return {
        "name": normalize_name(name),
        "kind": cls.kind,
        "priority": registry.priority(name),
        "requires": list(cls.requires),
    }
