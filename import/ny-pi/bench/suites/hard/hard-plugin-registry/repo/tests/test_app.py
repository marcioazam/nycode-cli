from docflow import App, hooks, registry
from docflow.plugin import Plugin


def test_run_pipeline():
    app = App()
    assert app.run("strip|lower", "  Hello World ") == "hello world"
    assert app.run("strip-tags | collapse | title", "<i>big</i>   news") == "Big News"


def test_plugins_lists_builtins():
    names = App().plugins()
    assert "slugify" in names and "audit" in names


def test_enable_observer_and_close():
    app = App()
    counter = app.enable("wordcount")
    assert app.run("strip", " a b c ") == "a b c"
    assert counter.last == 3
    app.run("strip", "one two")
    assert counter.total == 5
    assert "wordcount" in app.close()


def test_enable_audit_brings_its_dependency():
    app = App()
    audit = app.enable("audit")
    app.run("lower", "A B")
    assert audit.log == ["start", "2 words"]
    app.disable("audit")
    app.run("lower", "A B C")
    assert audit.log == ["start", "2 words"]
    app.close()


def test_globally_registered_plugin_is_visible_to_app():
    @registry.register
    class Exclaim(Plugin):
        name = "vis-exclaim"

        def apply(self, text):
            return text + "!"

    app = App()
    try:
        assert "vis-exclaim" in app.plugins()
        assert app.run("upper|vis-exclaim", "hey") == "HEY!"
    finally:
        app.close()
        registry.unregister("vis-exclaim")


def test_global_hook_sees_app_runs():
    seen = []
    hooks.add_hook("after_run", seen.append, owner="vis-spy")
    try:
        App().run("upper", "ok")
    finally:
        hooks.remove_hooks("vis-spy")
    assert seen == ["OK"]
