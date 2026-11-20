"""Registro global de plugins.

Os plugins se registram com o decorador ``register``; o estado vive em
dicionários de módulo, compartilhados por todo o processo.
"""

from docflow import hooks
from docflow.errors import DuplicatePluginError, PluginNotFoundError
from docflow.naming import normalize_name

_PLUGINS = {}
_LOADED = {}


def register(plugin_cls=None, *, name=None):
    """Registra uma classe de plugin. Serve como chamada direta ou decorador."""

    def _do(cls):
        key = normalize_name(name or cls.name)
        if key in _PLUGINS:
            raise DuplicatePluginError(key)
        _PLUGINS[key] = cls
        return cls

    if plugin_cls is None:
        return _do
    return _do(plugin_cls)


def get(name):
    """Devolve a classe registrada com o nome."""
    key = normalize_name(name)
    try:
        return _PLUGINS[key]
    except KeyError:
        raise PluginNotFoundError(key) from None


def names():
    """Nomes registrados, por prioridade e depois por nome."""
    return sorted(_PLUGINS, key=lambda key: (_PLUGINS[key].priority, key))


def unregister(name):
    """Remove o plugin do registro."""
    key = normalize_name(name)
    if key not in _PLUGINS:
        raise PluginNotFoundError(key)
    del _PLUGINS[key]


def load(name):
    """Instancia o plugin (e antes dele as dependências) e chama setup()."""
    key = normalize_name(name)
    if key in _LOADED:
        return _LOADED[key]
    cls = get(key)
    for dep in cls.requires:
        load(dep)
    instance = cls()
    instance.setup()
    _LOADED[key] = instance
    return instance


def unload(name):
    """Chama teardown() e remove os hooks do plugin."""
    key = normalize_name(name)
    if key not in _LOADED:
        raise PluginNotFoundError(key)
    instance = _LOADED.pop(key)
    instance.teardown()
    hooks.remove_hooks(key)


def loaded():
    """Nomes carregados, na ordem de carga."""
    return list(_LOADED)


def clear():
    """Descarrega tudo e esvazia o registro."""
    for key in reversed(list(_LOADED)):
        unload(key)
    _PLUGINS.clear()
