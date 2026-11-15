"""Registro de plugins por instância, com um registro default para a API antiga."""

from docflow.errors import (
    DependencyCycleError,
    DuplicatePluginError,
    PluginInUseError,
    PluginNotFoundError,
    PluginNotLoadedError,
)
from docflow.naming import normalize_name
from docflow.plugin import Plugin


def _check_priority(value):
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError("priority must be an int")
    return value


class _Entry:
    __slots__ = ("cls", "name", "priority", "seq")

    def __init__(self, name, cls, priority, seq):
        self.name = name
        self.cls = cls
        self.priority = priority
        self.seq = seq


class Registry:
    """Plugins, plugins carregados e hooks de uma aplicação."""

    def __init__(self, parent=None):
        if parent is not None and not isinstance(parent, Registry):
            raise TypeError("parent must be a Registry")
        self._parent = parent
        self._entries = {}
        self._seq = 0
        self._loaded = {}
        self._hooks = []
        self._hook_seq = 0

    @property
    def parent(self):
        return self._parent

    def _chain(self):
        """Registros da raiz até este."""
        chain = []
        current = self
        while current is not None:
            chain.append(current)
            current = current._parent
        chain.reverse()
        return chain

    # ---- registro

    def register(self, plugin_cls=None, *, name=None, priority=None, replace=False):
        def _do(cls):
            self._register(cls, name, priority, replace)
            return cls

        if plugin_cls is None:
            return _do
        return _do(plugin_cls)

    def _register(self, cls, name, priority, replace):
        if not (isinstance(cls, type) and issubclass(cls, Plugin)):
            raise TypeError("plugin must be a Plugin subclass")
        key = normalize_name(cls.name if name is None else name)
        value = _check_priority(cls.priority if priority is None else priority)
        current = self._entries.get(key)
        if current is None:
            self._seq += 1
            self._entries[key] = _Entry(key, cls, value, self._seq)
        elif replace:
            if key in self._loaded:
                raise PluginInUseError(key)
            current.cls = cls
            current.priority = value
        elif current.cls is not cls:
            raise DuplicatePluginError(key)

    def _find(self, key):
        current = self
        while current is not None:
            entry = current._entries.get(key)
            if entry is not None:
                return entry
            current = current._parent
        raise PluginNotFoundError(key)

    def get(self, name):
        return self._find(normalize_name(name)).cls

    def priority(self, name):
        return self._find(normalize_name(name)).priority

    def __contains__(self, name):
        try:
            self._find(normalize_name(name))
        except (ValueError, KeyError):
            return False
        return True

    def names(self, local=False):
        chain = [self] if local else self._chain()
        winners = {}
        for depth, reg in enumerate(chain):
            for entry in reg._entries.values():
                winners[entry.name] = (entry.priority, depth, entry.seq)
        return sorted(winners, key=winners.get)

    def __iter__(self):
        return iter(self.names())

    def __len__(self):
        return len(self.names())

    def unregister(self, name):
        key = normalize_name(name)
        if key not in self._entries:
            raise PluginNotFoundError(key)
        if key in self._loaded:
            raise PluginInUseError(key)
        del self._entries[key]

    # ---- hooks

    def add_hook(self, event, fn, owner=None, priority=100):
        if not callable(fn):
            raise TypeError("hook must be callable")
        _check_priority(priority)
        if owner is not None:
            owner = normalize_name(owner)
        self._hook_seq += 1
        self._hooks.append((event, priority, self._hook_seq, owner, fn))

    def emit(self, event, *args, **kwargs):
        selected = []
        for depth, reg in enumerate(self._chain()):
            for hook_event, priority, seq, _owner, fn in reg._hooks:
                if hook_event == event:
                    selected.append((priority, depth, seq, fn))
        selected.sort(key=lambda item: item[:3])
        return [fn(*args, **kwargs) for _p, _d, _s, fn in selected]

    def remove_hooks(self, owner):
        key = normalize_name(owner)
        kept = [hook for hook in self._hooks if hook[3] != key]
        removed = len(self._hooks) - len(kept)
        self._hooks = kept
        return removed

    # ---- carga

    def _requires(self, cls):
        return [normalize_name(dep) for dep in cls.requires]

    def _plan(self, key, order, visiting):
        if key in self._loaded or key in order:
            return
        if key in visiting:
            raise DependencyCycleError(key)
        cls = self._find(key).cls
        visiting.add(key)
        for dep in self._requires(cls):
            self._plan(dep, order, visiting)
        visiting.discard(key)
        order.append(key)

    def load(self, name):
        key = normalize_name(name)
        if key in self._loaded:
            return self._loaded[key]
        order = []
        self._plan(key, order, set())
        for item in order:
            instance = self._find(item).cls()
            instance.registry = self
            instance.plugin_name = item
            try:
                instance.setup()
            except BaseException:
                self.remove_hooks(item)
                raise
            self._loaded[item] = instance
        return self._loaded[key]

    def loaded(self):
        return list(self._loaded)

    def is_loaded(self, name):
        return normalize_name(name) in self._loaded

    def _stop(self, key):
        instance = self._loaded[key]
        try:
            instance.teardown()
        finally:
            self.remove_hooks(key)
            del self._loaded[key]

    def unload(self, name):
        key = normalize_name(name)
        if key not in self._loaded:
            raise PluginNotLoadedError(key)
        for other, instance in self._loaded.items():
            if other != key and key in self._requires(type(instance)):
                raise PluginInUseError(key)
        self._stop(key)

    def unload_all(self):
        unloaded = []
        first_error = None
        for key in reversed(list(self._loaded)):
            try:
                self._stop(key)
            except Exception as exc:  # noqa: BLE001
                if first_error is None:
                    first_error = exc
            unloaded.append(key)
        if first_error is not None:
            raise first_error
        return unloaded

    def clear(self):
        try:
            self.unload_all()
        finally:
            self._entries.clear()
            self._hooks = []


_DEFAULT = Registry()


def default_registry():
    """O registro usado pelas funções de módulo (API antiga)."""
    return _DEFAULT


def register(plugin_cls=None, *, name=None, priority=None, replace=False):
    return _DEFAULT.register(plugin_cls, name=name, priority=priority, replace=replace)


def get(name):
    return _DEFAULT.get(name)


def names():
    return _DEFAULT.names()


def unregister(name):
    _DEFAULT.unregister(name)


def load(name):
    return _DEFAULT.load(name)


def unload(name):
    _DEFAULT.unload(name)


def loaded():
    return _DEFAULT.loaded()


def clear():
    _DEFAULT.clear()
