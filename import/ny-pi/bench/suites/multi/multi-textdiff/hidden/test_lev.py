import pytest
from lev import closest, levenshtein


@pytest.mark.parametrize(
    "a,b,d",
    [
        ("kitten", "sitting", 3),
        ("", "", 0),
        ("", "abc", 3),
        ("abc", "", 3),
        ("same", "same", 0),
        ("flaw", "lawn", 2),
        ("ab", "ba", 2),
        ("intention", "execution", 5),
    ],
)
def test_distance(a, b, d):
    assert levenshtein(a, b) == d
    assert levenshtein(b, a) == d


def test_closest():
    c = ["apple", "apply", "ample", "zebra"]
    assert closest("appel", c) == "apple"
    assert closest("applx", c) == "apple"
    assert closest("zzzzzzz", c) is None
    assert closest("x", []) is None
    assert closest("zebr", c) == "zebra"


def test_closest_max_dist_and_ties():
    assert closest("cat", ["cut", "cot"]) == "cut"
    assert closest("cat", ["dog"], max_dist=3) == "dog"
    assert closest("cat", ["dog"], max_dist=2) is None
    assert closest("cat", ["cat", "cut"], max_dist=0) == "cat"
