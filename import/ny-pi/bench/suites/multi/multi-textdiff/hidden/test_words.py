import pytest
from words import top_words


def test_order_and_ties():
    t = "the cat and The dog and THE bird"
    assert top_words(t, 3) == [("the", 3), ("and", 2), ("bird", 1)]
    assert top_words("b a c", 5) == [("a", 1), ("b", 1), ("c", 1)]


def test_punctuation_and_apostrophe():
    assert top_words("Don't stop. don't, STOP! 123 stop", 2) == [
        ("stop", 3),
        ("don't", 2),
    ]
    assert top_words("123 !!! ...", 3) == []


def test_limits():
    assert top_words("a b", 0) == []
    assert top_words("", 3) == []
    assert top_words("a a b", 1) == [("a", 2)]


def test_negative():
    with pytest.raises(ValueError):
        top_words("a", -1)
