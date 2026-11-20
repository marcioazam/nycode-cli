import pytest
from relkit.core.globmatch import filter_paths, glob_match
from relkit.errors import ParseError


def test_curingas_simples():
    assert glob_match("src/*.py", "src/a.py")
    assert not glob_match("src/*.py", "src/sub/a.py")
    assert (
        glob_match("a?c", "abc")
        and not glob_match("a?c", "ac")
        and not glob_match("a?c", "abbc")
    )
    assert glob_match("*", "x") and glob_match("a*", "a")
    assert not glob_match("A.py", "a.py")
    assert glob_match("./src//*.py", "src\\a.py")


def test_duplo_asterisco():
    assert glob_match("a/**/b", "a/b") and glob_match("a/**/b", "a/x/y/b")
    assert glob_match("a/**", "a") and glob_match("a/**", "a/x/y")
    assert glob_match("**/x.py", "x.py") and glob_match("**/x.py", "p/q/x.py")
    assert not glob_match("a/**/b", "a/x/c")
    assert glob_match("**", "") and glob_match("**", "q/r")


def test_classes():
    assert glob_match("f[abc].txt", "fb.txt") and not glob_match("f[abc].txt", "fd.txt")
    assert glob_match("f[a-c].txt", "fc.txt") and not glob_match(
        "f[!a-c].txt", "fc.txt"
    )
    assert glob_match("f[!a-c].txt", "fz.txt")
    assert glob_match("f[]x].txt", "f].txt") and glob_match("f[!]x].txt", "fa.txt")
    assert glob_match("f[{].txt", "f{.txt")


def test_chaves_e_escapes():
    assert glob_match("src/*.{py,pyi}", "src/a.pyi") and glob_match(
        "src/*.{py,pyi}", "src/a.py"
    )
    assert not glob_match("src/*.{py,pyi}", "src/a.pyx")
    assert glob_match("a{,b}c", "ac") and glob_match("a{,b}c", "abc")
    assert glob_match("a/{x,y}/{1,2}", "a/y/2") and not glob_match(
        "a/{x,y}/{1,2}", "a/z/2"
    )
    assert glob_match("a\\*b", "a*b") and not glob_match("a\\*b", "axb")
    assert glob_match("a\\{b", "a{b")


def test_nomes_ocultos():
    assert (
        not glob_match("*", ".env")
        and glob_match(".*", ".env")
        and glob_match(".env", ".env")
    )
    assert not glob_match("**/x.py", ".git/x.py") and glob_match(
        ".git/x.py", ".git/x.py"
    )
    assert not glob_match("?env", ".env") and not glob_match("[.]env", ".env")
    assert glob_match("src/.*/c", "src/.cache/c")
    assert not glob_match("**", ".hidden/a")


def test_erros_de_padrao():
    esperado = {
        "": "empty",
        "/": "empty",
        "./": "empty",
        "a[b": "unclosed class",
        "a{b": "unclosed brace",
        "a{b{c}}": "nested braces",
        "ab\\": "dangling escape",
        "[z-a]": "bad class",
        "a/[": "unclosed class",
    }
    for pattern, reason in esperado.items():
        with pytest.raises(ParseError) as info:
            glob_match(pattern, "zzz")
        assert (info.value.kind, info.value.reason) == ("pattern", reason), pattern
    with pytest.raises(ParseError):
        filter_paths(["ok", "a[b"], [])


def test_filter_paths():
    caminhos = [
        "src/a.py",
        "src/b.pyc",
        "tests/t.py",
        ".github/ci.yml",
        "README.md",
        "src\\c.py",
    ]
    assert filter_paths(["src/**"], caminhos) == ["src/a.py", "src/b.pyc", "src\\c.py"]
    assert filter_paths(["**/*.py", "!tests/**"], caminhos) == ["src/a.py", "src\\c.py"]
    assert filter_paths(["!src/*.py", "src/**"], caminhos) == [
        "src/a.py",
        "src/b.pyc",
        "src\\c.py",
    ]
    assert filter_paths(["src/**", "!src/*.py", "src/a.py"], caminhos) == [
        "src/a.py",
        "src/b.pyc",
    ]
    assert filter_paths([], caminhos) == []
    assert filter_paths(["\\!x"], ["!x", "x"]) == ["!x"]
    with pytest.raises(ParseError):
        filter_paths(["!"], caminhos)
