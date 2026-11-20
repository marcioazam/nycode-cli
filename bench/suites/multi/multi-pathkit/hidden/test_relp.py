import pytest
from relp import relpath


@pytest.mark.parametrize(
    "t,s,out",
    [
        ("/a/b/c", "/a", "b/c"),
        ("/a", "/a/b/c", "../.."),
        ("/a/x", "/a/b", "../x"),
        ("/a/b", "/a/b", "."),
        ("/a/b/", "/a/b", "."),
        ("/a/./b/../c", "/a/d//", "../c"),
        ("/x", "/", "x"),
        ("/", "/x/y", "../.."),
        ("/a/b/c/d", "/a/b/e/f", "../../c/d"),
        ("/a/../b", "/b/c/..", "."),
    ],
)
def test_rel(t, s, out):
    assert relpath(t, s) == out


@pytest.mark.parametrize("t,s", [("a/b", "/a"), ("/a", "b"), ("a", "b"), ("", "/")])
def test_not_absolute(t, s):
    with pytest.raises(ValueError):
        relpath(t, s)
