import importlib

import helpers
import links
import pytest
import report
import schedule

NAMES = ["slugify", "titlecase", "clamp", "mean", "parse_iso", "days_between"]


def test_is_package_with_submodules():
    assert hasattr(helpers, "__path__")
    importlib.import_module("helpers.text")
    importlib.import_module("helpers.numbers")
    importlib.import_module("helpers.dates")


def test_ownership_and_identity():
    from helpers import dates, numbers, text

    assert text.slugify is helpers.slugify and text.titlecase is helpers.titlecase
    assert numbers.clamp is helpers.clamp and numbers.mean is helpers.mean
    assert (
        dates.parse_iso is helpers.parse_iso
        and dates.days_between is helpers.days_between
    )
    for mod, own in (
        (text, {"slugify", "titlecase"}),
        (numbers, {"clamp", "mean"}),
        (dates, {"parse_iso", "days_between"}),
    ):
        foreign = set(NAMES) - own
        assert not any(hasattr(mod, n) for n in foreign), mod.__name__


def test_all():
    assert sorted(helpers.__all__) == sorted(NAMES)


def test_old_import_style():
    for n in NAMES:
        assert callable(getattr(importlib.import_module("helpers"), n))


def test_behavior_preserved():
    assert helpers.slugify("  Hello,  World! ") == "hello-world"
    assert helpers.titlecase("hELLO wORLD") == "Hello World"
    assert (
        helpers.clamp(5, 0, 3) == 3
        and helpers.clamp(-1, 0, 3) == 0
        and helpers.clamp(2, 0, 3) == 2
    )
    with pytest.raises(ValueError):
        helpers.clamp(1, 3, 0)
    assert helpers.mean([1, 2, 3, 4]) == 2.5
    assert helpers.mean(iter([2, 4])) == 3
    with pytest.raises(ValueError):
        helpers.mean([])
    assert str(helpers.parse_iso("2024-02-29")) == "2024-02-29"
    with pytest.raises(ValueError):
        helpers.parse_iso("2023-02-29")
    assert helpers.days_between("2024-01-01", "2024-03-01") == 60


def test_consumers():
    assert links.link("My First Post!") == "/posts/my-first-post"
    assert report.summary("sales q1", [1, 2]) == "Sales Q1: 1.50"
    assert schedule.days_left("2024-01-01", "2024-01-11") == 10
    assert schedule.days_left("2024-01-11", "2024-01-01") == 0
    assert schedule.days_left("2020-01-01", "2024-01-01") == 365
