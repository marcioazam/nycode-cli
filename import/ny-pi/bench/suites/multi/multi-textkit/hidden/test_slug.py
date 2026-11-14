import pytest
from slug import slugify


@pytest.mark.parametrize(
    "src,out",
    [
        ("Hello, World!", "hello-world"),
        ("  Ação  Rápida -- já! ", "acao-rapida-ja"),
        ("a___b", "a-b"),
        ("---", ""),
        ("", ""),
        ("Café 2024", "cafe-2024"),
    ],
)
def test_slugify(src, out):
    assert slugify(src) == out
