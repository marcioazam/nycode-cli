import pytest
from docflow.errors import (
    DependencyCycleError,
    DocflowError,
    DuplicatePluginError,
    InvalidPluginNameError,
    PluginInUseError,
    PluginNotFoundError,
    PluginNotLoadedError,
)
from docflow.naming import normalize_name
from docflow.plugin import Plugin
from docflow.registry import Registry


def mk(name, priority=100, requires=(), log=None):
    class P(Plugin):
        pass

    P.name = name
    P.priority = priority
    P.requires = tuple(requires)
    if log is not None:
        P.setup = lambda self: log.append(("setup", name))
        P.teardown = lambda self: log.append(("teardown", name))
    return P


def _hier():
    assert issubclass(InvalidPluginNameError, (DocflowError, ValueError))
    assert issubclass(DependencyCycleError, DocflowError)
    assert issubclass(PluginInUseError, DocflowError)
    assert issubclass(PluginNotLoadedError, DocflowError)


def test_r1_isolation_and_parent_type():
    _hier()
    a, b = Registry(), Registry()
    a.register(mk("x"))
    assert "x" in a and "x" not in b
    a.add_hook("e", lambda: 1)
    assert b.emit("e") == []
    with pytest.raises(TypeError):
        Registry(parent=object())
    child = Registry(parent=a)
    assert child.parent is a and a.parent is None
    with pytest.raises(AttributeError):
        child.parent = b


def test_r2_names():
    for bad in [
        None,
        3,
        b"x",
        "",
        "   ",
        "9lives",
        "a--b",
        "-a",
        "a-",
        "a b",
        "a.b",
        "café",
        "a" * 33,
    ]:
        with pytest.raises(InvalidPluginNameError):
            normalize_name(bad)
    assert normalize_name("  Word_Count ") == "word-count"
    assert normalize_name("a" * 32) == "a" * 32


def test_r3_normalization_everywhere():
    r = Registry()
    r.register(mk("my-plug"))
    assert "  My_Plug" in r
    assert r.get("MY_PLUG").name == "my-plug"
    assert "9bad" not in r and None not in r and 5 not in r
    with pytest.raises(InvalidPluginNameError):
        r.get("9bad")
    with pytest.raises(InvalidPluginNameError):
        r.load("a--b")
    with pytest.raises(InvalidPluginNameError):
        r.unregister("")
    with pytest.raises(InvalidPluginNameError):
        r.add_hook("e", lambda: 1, owner="bad name")
    with pytest.raises(InvalidPluginNameError):
        r.remove_hooks("-x")
    r.register(mk("needs", requires=("Dep_One",)))
    with pytest.raises(PluginNotFoundError):
        r.load("needs")


def test_r4_register_forms_and_no_class_mutation():
    r1, r2 = Registry(), Registry()
    C = mk("base", priority=7)
    assert r1.register(C) is C

    @r1.register
    class D(Plugin):
        name = "dee"

    assert D.priority == 100

    @r1.register(name="Eee", priority=-5)
    class E(Plugin):
        name = "ignored"

    assert r1.get("eee") is E and r1.priority("eee") == -5 and E.priority == 100
    r2.register(C, name="other", priority=1)
    assert C.name == "base" and C.priority == 7
    assert r1.priority("base") == 7 and r2.priority("other") == 1
    assert r2.get("other") is C and "base" not in r2


def test_r4_rejections():
    r = Registry()
    with pytest.raises(TypeError):
        r.register(int)
    with pytest.raises(TypeError):
        r.register(mk("a"), priority="1")
    with pytest.raises(TypeError):
        r.register(mk("b"), priority=True)
    assert r.names() == []


def test_r5_conflicts():
    r = Registry()
    A, B = mk("dup", 10), mk("other", 5)
    r.register(A)
    r.register(mk("mid", 10))
    r.register(A, priority=99)  # b) no-op
    assert r.get("dup") is A and r.priority("dup") == 10
    with pytest.raises(DuplicatePluginError):
        r.register(mk("dup"))
    assert r.get("dup") is A
    r.register(B, name="dup", replace=True, priority=10)  # a) keeps position
    assert r.get("dup") is B and r.names() == ["dup", "mid"]
    r.register(mk("fresh"), replace=True)
    assert "fresh" in r


def test_r5_parent_name_can_be_shadowed_and_replace_blocked_when_loaded():
    p = Registry()
    P1, C1 = mk("sh", 10), mk("sh", 20)
    p.register(P1)
    c = Registry(parent=p)
    c.register(C1)
    assert c.get("sh") is C1 and p.get("sh") is P1
    c.load("sh")
    with pytest.raises(PluginInUseError):
        c.register(mk("sh"), replace=True)
    assert c.get("sh") is C1


def test_r6_resolution_chain_and_missing():
    g, p, c = Registry(), Registry(), Registry()
    p = Registry(parent=g)
    c = Registry(parent=p)
    g.register(mk("only-g", 3))
    with pytest.raises(PluginNotFoundError):
        c.get("nope")
    assert c.priority("only-g") == 3 and "only-g" in c
    with pytest.raises(PluginNotFoundError):
        c.priority("nope")


def test_r7_listing_order():
    g = Registry()
    c = Registry(parent=g)
    g.register(mk("g1", 10))
    g.register(mk("g2", 20))
    g.register(mk("tie", 10))
    c.register(mk("c1", 10))
    c.register(mk("g2", 5))
    c.register(mk("c2", 10))
    assert g.names() == ["g1", "tie", "g2"]
    assert c.names() == ["g2", "g1", "tie", "c1", "c2"]
    assert c.names(local=True) == ["g2", "c1", "c2"]
    assert list(c) == c.names() and len(c) == 5
    lst = c.names()
    lst.append("zzz")
    assert "zzz" not in c.names()


def test_r8_unregister():
    p = Registry()
    P1 = mk("u", 1)
    p.register(P1)
    c = Registry(parent=p)
    with pytest.raises(PluginNotFoundError):
        c.unregister("u")
    c.register(mk("u", 2))
    c.register(mk("z"))
    c.unregister("u")
    assert c.get("u") is P1
    c.register(mk("u", 100))
    assert c.names(local=True) == ["z", "u"]
    c.load("u")
    with pytest.raises(PluginInUseError):
        c.unregister("u")
    assert "u" in c.loaded()


def test_r9_load_semantics():
    log = []
    seen = {}
    C = mk("lo", log=log)

    def setup(self):
        seen["registry"], seen["pn"] = self.registry, self.plugin_name
        log.append("setup")

    C.setup = setup
    p = Registry()
    p.register(C)
    c = Registry(parent=p)
    inst = c.load("LO")
    assert seen == {"registry": c, "pn": "lo"}
    assert c.load("lo") is inst and log == ["setup"]
    assert c.is_loaded("lo") and not p.is_loaded("lo") and p.loaded() == []
    lst = c.loaded()
    lst.clear()
    assert c.loaded() == ["lo"]
    other = p.load("lo")
    assert other is not inst and other.registry is p


def test_r10_dependencies_order_and_atomic_resolution():
    log = []
    r = Registry()
    r.register(mk("d1", log=log))
    r.register(mk("d2", requires=("d1",), log=log))
    r.register(mk("top", requires=("d2", "d1"), log=log))
    r.load("top")
    assert [x[1] for x in log] == ["d1", "d2", "top"] and r.loaded() == [
        "d1",
        "d2",
        "top",
    ]

    log2 = []
    r2 = Registry()
    r2.register(mk("ok", log=log2))
    r2.register(mk("bad", requires=("ok", "ghost"), log=log2))
    with pytest.raises(PluginNotFoundError):
        r2.load("bad")
    assert log2 == [] and r2.loaded() == []

    r2.register(mk("c1", requires=("ok", "c2"), log=log2))
    r2.register(mk("c2", requires=("c1",), log=log2))
    r2.register(mk("selfy", requires=("selfy",), log=log2))
    for n in ("c1", "selfy"):
        with pytest.raises(DependencyCycleError):
            r2.load(n)
    assert log2 == [] and r2.loaded() == []


def test_r10_local_dependency_wins():
    p = Registry()
    log = []
    p.register(mk("dep", log=log))
    c = Registry(parent=p)
    Local = mk("dep", log=log)
    c.register(Local)
    p.register(mk("needy", requires=("dep",)))
    inst = c.load("needy")
    assert c.is_loaded("dep") and not p.is_loaded("dep")
    assert inst.registry is c


def test_r11_failing_setup():
    log = []
    r = Registry()
    r.register(mk("good", log=log))
    Bad = mk("boom", requires=("good",))

    def setup(self):
        self.registry.add_hook("ev", lambda: 1, owner="boom")
        raise RuntimeError("x")

    Bad.setup = setup
    r.register(Bad)
    with pytest.raises(RuntimeError):
        r.load("boom")
    assert r.loaded() == ["good"] and r.emit("ev") == []


def test_r12_hooks_order_and_snapshot():
    g = Registry()
    c = Registry(parent=g)
    g.add_hook("e", lambda: "g100")
    c.add_hook("e", lambda: "c100")
    c.add_hook("e", lambda: "c10", priority=10)
    g.add_hook("e", lambda: "g100b")
    g.add_hook("other", lambda: "no")
    assert c.emit("e") == ["c10", "g100", "g100b", "c100"]
    assert g.emit("e") == ["g100", "g100b"]
    r = Registry()
    r.add_hook("e", lambda: r.add_hook("e", lambda: "late"))
    assert len(r.emit("e")) == 1 and len(r.emit("e")) == 2
    r.add_hook("A", lambda x, k=0: (x, k))
    assert r.emit("A", 1, k=2) == [(1, 2)] and r.emit("a") == []
    with pytest.raises(TypeError):
        r.add_hook("e", "nope")
    with pytest.raises(TypeError):
        r.add_hook("e", print, priority=1.5)
    with pytest.raises(TypeError):
        r.add_hook("e", print, priority=False)


def test_r13_remove_hooks_local_only():
    g = Registry()
    c = Registry(parent=g)
    g.add_hook("e", lambda: 1, owner="own")
    c.add_hook("e", lambda: 2, owner="OWN")
    c.add_hook("f", lambda: 3, owner="own")
    c.add_hook("f", lambda: 4)
    assert c.remove_hooks("own") == 2
    assert c.emit("e") == [1] and c.emit("f") == [4]
    assert c.remove_hooks("own") == 0


def test_r14_unload():
    log = []
    r = Registry()
    r.register(mk("base", log=log))
    r.register(mk("up", requires=("base",), log=log))
    with pytest.raises(PluginNotLoadedError):
        r.unload("up")
    r.load("up")
    log.clear()
    with pytest.raises(PluginInUseError):
        r.unload("base")
    assert log == [] and r.loaded() == ["base", "up"]
    r.add_hook("e", lambda: 1, owner="up")
    r.unload("up")
    assert log == [("teardown", "up")] and r.emit("e") == [] and r.loaded() == ["base"]


def test_r14_teardown_failure_still_unloads():
    r = Registry()
    T = mk("td")

    def td(self):
        raise RuntimeError("td")

    T.teardown = td
    r.register(T)
    r.load("td")
    r.add_hook("e", lambda: 1, owner="td")
    with pytest.raises(RuntimeError):
        r.unload("td")
    assert r.loaded() == [] and r.emit("e") == []


def test_r15_unload_all_reverse_and_first_error():
    order = []
    r = Registry()
    for n in ("a", "b", "c"):
        C = mk(n)
        C.teardown = (lambda nm: lambda self: order.append(nm))(n)  # noqa: PLC3002
        r.register(C)
        r.load(n)
    assert r.unload_all() == ["c", "b", "a"] and order == ["c", "b", "a"]

    r2 = Registry()
    seen = []
    for n in ("a", "b", "c"):
        C = mk(n)

        def td(self, nm=n):
            seen.append(nm)
            if nm in ("c", "a"):
                raise RuntimeError(nm)

        C.teardown = td
        r2.register(C)
        r2.load(n)
    with pytest.raises(RuntimeError, match="c"):
        r2.unload_all()
    assert seen == ["c", "b", "a"] and r2.loaded() == []


def test_r16_clear_leaves_parent():
    p = Registry()
    p.register(mk("pp"))
    p.add_hook("e", lambda: 1)
    c = Registry(parent=p)
    c.register(mk("cc"))
    c.add_hook("e", lambda: 2)
    c.load("pp")
    c.clear()
    assert c.names(local=True) == [] and c.loaded() == [] and c.emit("e") == [1]
    assert "pp" in p
