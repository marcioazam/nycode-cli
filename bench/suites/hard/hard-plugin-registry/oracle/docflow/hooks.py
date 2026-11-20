"""API antiga de hooks: delega ao registro default."""

from docflow.registry import default_registry


def add_hook(event, fn, owner=None, priority=100):
    """Associa fn ao evento no registro default."""
    default_registry().add_hook(event, fn, owner=owner, priority=priority)


def emit(event, *args, **kwargs):
    """Emite o evento no registro default; devolve os retornos."""
    return default_registry().emit(event, *args, **kwargs)


def remove_hooks(owner):
    """Remove os hooks do dono no registro default; devolve quantos removeu."""
    return default_registry().remove_hooks(owner)
