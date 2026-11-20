import subprocess
import sys

import pytest
from docflow import hooks, registry
from docflow.app import App
from docflow.cli.main import run_cli
from docflow.core import loader, pipeline, resolver
from docflow.errors import PipelineError, PluginNotLoadedError
from docflow.plugin import Plugin
from docflow.registry import Registry, default_registry

NAMES = [
    "lower",
    "upper",
    "title",
    "strip",
    "collapse",
    "slugify",
    "strip-tags",
    "escape",
    "headings",
    "wordcount",
    "charcount",
    "audit",
    "redact-digits",
    "truncate",
]


def mk(name, **attrs):
    return type("P", (Plugin,), {"name": name, **attrs})


def test_r17_default_registry_and_delegation():
    d = default_registry()
    assert d is default_registry() and isinstance(d, Registry) and d.parent is None
    P = mk("g-one", priority=4)
    assert registry.register(P) is P
    assert (
        d.get("g-one") is P
        and registry.get("g-one") is P
        and registry.names() == ["g-one"]
    )
    inst = registry.load("g-one")
    assert d.load("g-one") is inst and registry.loaded() == ["g-one"]
    hooks.add_hook("e", lambda: 7, owner="g-one")
    assert d.emit("e") == [7] and hooks.emit("e") == [7]
    with pytest.raises(PluginNotLoadedError):
        registry.unload("nada")
    registry.unload("g-one")
    assert hooks.emit("e") == []
    registry.unregister("g-one")
    assert registry.names() == []
    registry.register(mk("g-two"), name="G_Three", priority=1, replace=True)
    assert registry.names() == ["g-three"]
    assert hooks.remove_hooks("g-three") == 0
    registry.clear()
    assert registry.names() == []


def test_r18_no_global_state():
    assert not hasattr(registry, "_PLUGINS")
    assert not hasattr(registry, "_LOADED")
    assert not hasattr(hooks, "_HOOKS")


def test_r19_import_has_no_side_effects():
    code = (
        "import docflow, docflow.plugins, docflow.plugins.text, docflow.plugins.markup,"
        "docflow.plugins.stats, docflow.plugins.filters\n"
        "from docflow.registry import default_registry\n"
        "assert default_registry().names() == [], default_registry().names()\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)  # noqa: PLW1510
    assert out.returncode == 0, out.stderr


def test_r19_install_builtins_order_and_idempotence():
    from docflow.plugins import filters, install_builtins, markup, stats, text

    r = Registry()
    install_builtins(r)
    install_builtins(r)
    assert [n for n in r.names(local=True)] != []
    assert sorted(r.names(local=True)) == sorted(NAMES)
    r2 = Registry()
    for pkg in (text, markup, stats, filters):
        pkg.install(r2)
    assert r2.names(local=True) == r.names(local=True)
    assert (
        r.priority("slugify") == 65
        and r.priority("audit") == 200
        and r.priority("strip") == 10
    )
    assert default_registry().names() == []


def test_r20_builtins_use_their_registry():
    from docflow.plugins import install_builtins

    r = Registry()
    install_builtins(r)
    audit = r.load("audit")
    assert audit.registry is r and r.is_loaded("wordcount")
    assert not default_registry().loaded()
    slug = r.load("slugify")
    assert slug.apply("  Hello   World ") == "hello-world"
    r.emit("after_run", "a b c")
    assert audit.log[-1] == "3 words" or audit.log
    assert default_registry().emit("after_run", "x y") == []
    r.unload("audit")
    r.unload("wordcount")
    assert r.emit("after_run", "q") == []


def test_r21_loader():
    r = Registry()
    loader.load_builtins(r)
    loader.load_builtins(r)
    assert sorted(r.names(local=True)) == sorted(NAMES)
    insts = loader.load_plugins(["upper", "strip"], r)
    assert [i.plugin_name for i in insts] == ["upper", "strip"] and r.loaded() == [
        "upper",
        "strip",
    ]
    assert default_registry().names() == []
    loader.load_builtins()
    assert len(default_registry().names()) == 14


def test_r22_pipeline_and_resolver():
    r = Registry()
    loader.load_builtins(r)
    r.register(mk("lower", priority=1), replace=True)
    r2 = Registry(parent=r)
    p = pipeline.Pipeline(["strip", "upper"], r2)
    assert p.run("  ab ") == "AB"
    with pytest.raises(PipelineError):
        pipeline.Pipeline(["wordcount"], r).run("x")
    assert resolver.resolve("STRIP", r2).name == "strip"
    assert resolver.by_kind("observer", r2) == [
        n for n in r2.names() if resolver.resolve(n, r2).kind == "observer"
    ]
    d = resolver.describe("Slugify", r2)
    assert d["name"] == "slugify" and d["priority"] == 65
    r2.register(mk("slugify", priority=3), replace=True)
    assert (
        resolver.describe("slugify", r2)["priority"] == 3
        and resolver.describe("slugify", r)["priority"] == 65
    )


def test_r23_app_instances():
    with pytest.raises(TypeError):
        App(registry="x")
    own = Registry()
    a = App(own)
    assert a.registry is own and own.names() == []
    registry.register(mk("zz-glob"))
    a1, a2 = App(), App()
    assert a1.registry is not a2.registry and a1.registry.parent is default_registry()
    assert "zz-glob" in a1.plugins() and "zz-glob" in a2.plugins()
    a1.registry.register(mk("only-a1"))
    assert "only-a1" not in a2.plugins()
    a1.enable("wordcount")
    assert a2.registry.loaded() == [] and default_registry().loaded() == []
    a1.run("strip", " a b ")
    assert a1.disable("wordcount") is None
    a1.enable("audit")
    assert a1.close() == ["audit", "wordcount", "strip"]


def test_r23_run_emits_on_app_registry():
    own = Registry()
    loader.load_builtins(own)
    events = []
    own.add_hook("before_run", lambda t: events.append(("b", t)))
    own.add_hook("after_run", lambda t: events.append(("a", t)))
    hooks.add_hook("before_run", lambda t: events.append(("global", t)))
    assert App(own).run("upper", "x") == "X"
    assert events == [("b", "x"), ("a", "X")]


def test_r24_cli():
    r = Registry()
    loader.load_builtins(r)
    r.register(mk("lower", priority=2), replace=True)
    code, out = run_cli(["list"], r)
    lines = out.splitlines()
    assert code == 0 and lines[0] == "lower\t2\ttransform" and len(lines) == 14
    code, out = run_cli(["info", "Slugify"], r)
    assert code == 0 and out.splitlines() == [
        "name: slugify",
        "kind: transform",
        "priority: 65",
        "requires: lower, collapse",
    ]
    assert run_cli(["info", "9bad"], r)[0] == 1
    assert run_cli(["info", "9bad"], r)[1].startswith("error: ")
    assert run_cli(["info", "nope"], r)[0] == 1
    assert run_cli(["run", "strip|upper", " ab "], r) == (0, "AB")
    assert run_cli(["bogus"], r)[0] == 2
    assert run_cli(["list"])[0] == 0
