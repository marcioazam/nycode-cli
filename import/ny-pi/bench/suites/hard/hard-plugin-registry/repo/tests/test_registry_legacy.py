import pytest
from docflow import hooks, registry
from docflow.errors import DocflowError, DuplicatePluginError, PluginNotFoundError
from docflow.plugin import Plugin


def test_register_decorator_get_and_unregister():
    @registry.register
    class Shout(Plugin):
        name = "vis-shout"

        def apply(self, text):
            return text + "!"

    try:
        assert registry.get("vis-shout") is Shout
        assert registry.get("  VIS-Shout ") is Shout
        assert "vis-shout" in registry.names()
    finally:
        registry.unregister("vis-shout")
    assert "vis-shout" not in registry.names()


def test_register_with_explicit_name():
    class Plain(Plugin):
        name = "vis-plain"

    assert registry.register(Plain, name="vis-alias") is Plain
    try:
        assert registry.get("vis-alias") is Plain
        with pytest.raises(PluginNotFoundError):
            registry.get("vis-plain")
    finally:
        registry.unregister("vis-alias")


def test_duplicate_name_is_rejected():
    class First(Plugin):
        name = "vis-dup"

    class Second(Plugin):
        name = "vis-dup"

    registry.register(First)
    try:
        with pytest.raises(DuplicatePluginError):
            registry.register(Second)
        assert registry.get("vis-dup") is First
    finally:
        registry.unregister("vis-dup")


def test_unknown_plugin():
    with pytest.raises(PluginNotFoundError):
        registry.get("vis-missing")
    with pytest.raises(KeyError):
        registry.unregister("vis-missing")
    assert issubclass(PluginNotFoundError, DocflowError)
    assert issubclass(DuplicatePluginError, ValueError)


def test_load_runs_setup_once_and_unload_runs_teardown():
    events = []

    class Tracked(Plugin):
        name = "vis-tracked"

        def setup(self):
            events.append("setup")

        def teardown(self):
            events.append("teardown")

    registry.register(Tracked)
    try:
        first = registry.load("vis-tracked")
        assert isinstance(first, Tracked)
        assert registry.load("vis-tracked") is first
        assert "vis-tracked" in registry.loaded()
        registry.unload("vis-tracked")
        assert "vis-tracked" not in registry.loaded()
        assert events == ["setup", "teardown"]
    finally:
        registry.unregister("vis-tracked")


def test_global_hooks():
    seen = []

    def first(value):
        seen.append(("first", value))
        return 1

    def second(value):
        seen.append(("second", value))
        return 2

    hooks.add_hook("vis-event", first, owner="vis-owner")
    hooks.add_hook("vis-event", second, "vis-owner")
    assert hooks.emit("vis-event", "x") == [1, 2]
    assert seen == [("first", "x"), ("second", "x")]
    assert hooks.remove_hooks("vis-owner") == 2
    assert hooks.emit("vis-event", "y") == []
