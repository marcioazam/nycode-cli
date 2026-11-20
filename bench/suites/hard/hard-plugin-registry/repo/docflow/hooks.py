"""Hooks globais: funções chamadas quando um evento é emitido."""

_HOOKS = {}


def add_hook(event, fn, owner=None):
    """Associa fn ao evento. owner é o nome do plugin dono do hook."""
    _HOOKS.setdefault(event, []).append((owner, fn))


def emit(event, *args):
    """Chama os hooks do evento, na ordem de inclusão; devolve os retornos."""
    return [fn(*args) for _owner, fn in list(_HOOKS.get(event, []))]


def remove_hooks(owner):
    """Remove todos os hooks do dono; devolve quantos removeu."""
    removed = 0
    for event in list(_HOOKS):
        kept = [item for item in _HOOKS[event] if item[0] != owner]
        removed += len(_HOOKS[event]) - len(kept)
        _HOOKS[event] = kept
    return removed
