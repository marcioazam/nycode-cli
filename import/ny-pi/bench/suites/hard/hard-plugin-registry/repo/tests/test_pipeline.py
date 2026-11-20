import pytest
from docflow import registry
from docflow.core import loader, resolver
from docflow.core.config import format_spec, parse_spec
from docflow.core.document import Document
from docflow.core.pipeline import Pipeline
from docflow.errors import PipelineError, PluginNotFoundError

loader.load_builtins()


def test_parse_spec():
    assert parse_spec("strip | lower") == ["strip", "lower"]
    assert parse_spec("") == []
    assert parse_spec("a||b|") == ["a", "b"]
    assert format_spec(["a", "b"]) == "a|b"


def test_pipeline_runs_stages_in_given_order():
    assert Pipeline(["strip-tags", "collapse", "upper"]).run("<p> a   b </p>") == "A B"
    assert Pipeline([]).run("same") == "same"


def test_pipeline_rejects_observer_and_unknown():
    with pytest.raises(PipelineError):
        Pipeline(["wordcount"]).run("x")
    with pytest.raises(PluginNotFoundError):
        Pipeline(["vis-nope"]).run("x")


def test_run_document_keeps_meta():
    doc = Document("  Hi ", {"lang": "en"})
    out = Pipeline(["strip", "lower"]).run_document(doc)
    assert out == Document("hi", {"lang": "en"})
    assert doc.text == "  Hi "
    with pytest.raises(TypeError):
        Pipeline([]).run_document("text")


def test_resolver():
    assert resolver.resolve("lower") is registry.get("lower")
    observers = resolver.by_kind("observer")
    assert set(observers) >= {"wordcount", "charcount", "audit"}
    assert "lower" not in observers
    assert resolver.describe("audit") == {
        "name": "audit",
        "kind": "observer",
        "priority": 200,
        "requires": ["wordcount"],
    }


def test_load_plugins_returns_instances_in_order():
    lower, strip = loader.load_plugins(["lower", "strip"])
    assert lower.apply("A") == "a"
    assert strip.apply(" a ") == "a"
