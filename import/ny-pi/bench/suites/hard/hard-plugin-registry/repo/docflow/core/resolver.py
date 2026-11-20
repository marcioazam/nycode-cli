"""Resolução de plugins por nome e por tipo."""

from docflow import registry


def resolve(name):
    """Classe do plugin com esse nome."""
    return registry.get(name)


def by_kind(kind):
    """Nomes dos plugins desse tipo, na ordem de listagem do registro."""
    return [name for name in registry.names() if registry.get(name).kind == kind]


def describe(name):
    """Dados de exibição de um plugin."""
    cls = registry.get(name)
    return {
        "name": name.strip().lower(),
        "kind": cls.kind,
        "priority": cls.priority,
        "requires": list(cls.requires),
    }
