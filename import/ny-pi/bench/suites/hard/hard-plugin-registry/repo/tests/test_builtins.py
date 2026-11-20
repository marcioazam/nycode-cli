from docflow import registry
from docflow.core import loader

loader.load_builtins()

BUILTINS = {
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
}


def test_builtins_are_registered():
    assert BUILTINS <= set(registry.names())


def test_load_builtins_twice_is_harmless():
    loader.load_builtins()
    assert BUILTINS <= set(registry.names())


def test_priority_orders_listing():
    names = registry.names()
    assert names.index("strip") < names.index("collapse") < names.index("lower")
    assert names.index("upper") < names.index("title") < names.index("audit")


def test_transforms():
    def apply(name, text):
        return registry.get(name)().apply(text)

    assert apply("lower", "AbC") == "abc"
    assert apply("upper", "AbC") == "ABC"
    assert apply("title", "hello big world") == "Hello Big World"
    assert apply("strip", "  x  ") == "x"
    assert apply("collapse", " a   b \n c ") == "a b c"
    assert apply("strip-tags", "<b>hi</b> there") == "hi there"
    assert apply("escape", "a < b & c") == "a &lt; b &amp; c"
    assert apply("headings", "## Title\nbody # x") == "Title\nbody # x"
    assert apply("redact-digits", "tel 555-1234") == "tel ###-####"
    assert apply("truncate", "x" * 50) == "x" * 37 + "..."
    assert apply("truncate", "short") == "short"


def test_slugify_uses_its_dependencies():
    slug = registry.load("slugify")
    assert slug.apply("Hello   Big  World") == "hello-big-world"
    assert {"lower", "collapse", "slugify"} <= set(registry.loaded())
