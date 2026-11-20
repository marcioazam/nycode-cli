import pytest
from normp import normalize


@pytest.mark.parametrize(
    "src,out",
    [
        ("a//b///c", "a/b/c"),
        ("./a/./b", "a/b"),
        ("a/b/../c", "a/c"),
        ("a/..", "."),
        ("", "."),
        (".", "."),
        ("../a", "../a"),
        ("../../a/b/../..", "../.."),
        ("a/../..", ".."),
        ("/", "/"),
        ("//", "/"),
        ("/..", "/"),
        ("/../../a", "/a"),
        ("/a/b/", "/a/b"),
        ("/a/./b/../../c", "/c"),
        ("a/b/", "a/b"),
        ("..", ".."),
        ("a/..b/c", "a/..b/c"),
    ],
)
def test_normalize(src, out):
    assert normalize(src) == out
