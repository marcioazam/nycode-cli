import pytest
from globm import glob_match


@pytest.mark.parametrize(
    "pat,path,ok",
    [
        ("*.py", "a.py", True),
        ("*.py", "src/a.py", False),
        ("*.py", "a.pyc", False),
        ("src/*.py", "src/a.py", True),
        ("src/*/x", "src/a/x", True),
        ("src/*/x", "src/a/b/x", False),
        ("a?c", "abc", True),
        ("a?c", "a/c", False),
        ("a?c", "ac", False),
        ("**/x.py", "x.py", True),
        ("**/x.py", "a/b/x.py", True),
        ("**/x.py", "a/b/y.py", False),
        ("a/**", "a", True),
        ("a/**", "a/b/c", True),
        ("a/**", "b/c", False),
        ("a/**/z", "a/z", True),
        ("a/**/z", "a/b/c/z", True),
        ("a/**/z", "a/b/c/y", False),
        ("**", "anything/at/all", True),
        ("[ab].txt", "a.txt", False),
        ("[ab].txt", "[ab].txt", True),
        ("a.b", "axb", False),
        ("a+b", "a+b", True),
        ("src", "src/a", False),
        ("*", "", True),
    ],
)
def test_glob(pat, path, ok):
    assert glob_match(pat, path) is ok
