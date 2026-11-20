import random

from diff import line_diff


def lcs_len(a, b):
    t = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            t[i + 1][j + 1] = t[i][j] + 1 if x == y else max(t[i][j + 1], t[i + 1][j])
    return t[-1][-1]


def check(a, b):
    d = line_diff(a, b)
    assert all(op in " -+" for op, _ in d)
    assert [x for op, x in d if op in " -"] == a
    assert [x for op, x in d if op in " +"] == b
    assert sum(op == " " for op, _ in d) == lcs_len(a, b)


def test_examples():
    assert line_diff([], []) == []
    assert line_diff(["a"], ["a"]) == [(" ", "a")]
    assert line_diff([], ["x", "y"]) == [("+", "x"), ("+", "y")]
    assert line_diff(["x", "y"], []) == [("-", "x"), ("-", "y")]
    assert line_diff(["a", "b", "c"], ["a", "c"]) == [
        (" ", "a"),
        ("-", "b"),
        (" ", "c"),
    ]
    assert line_diff(["a", "c"], ["a", "b", "c"]) == [
        (" ", "a"),
        ("+", "b"),
        (" ", "c"),
    ]


def test_properties_fixed():
    check(list("abcabba"), list("cbabac"))
    check(list("aaaa"), list("aa"))
    check(list("xyz"), list("abc"))
    check(["a", "", "a", ""], ["", "a"])


def test_properties_random():
    rng = random.Random(7)
    for _ in range(200):
        a = [rng.choice("abc") for _ in range(rng.randint(0, 9))]
        b = [rng.choice("abc") for _ in range(rng.randint(0, 9))]
        check(a, b)
