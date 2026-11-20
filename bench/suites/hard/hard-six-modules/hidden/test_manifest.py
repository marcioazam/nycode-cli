import pytest
from relkit.core.manifest import Manifest, parse_manifest
from relkit.errors import ConfigError

BASE = """\
# comentário
[release]
name = "relkit" # com comentário
version = 1.4.0
note = a#b
tag = x #y
"""


def _erro(texto):
    with pytest.raises(ConfigError) as info:
        parse_manifest(texto)
    return info.value.line, info.value.reason


def test_secoes_chaves_e_comentarios():
    m = parse_manifest(BASE + "; outro\n\n[b-2_x]\nk.sub = v = w\r\nvazio =\n")
    assert isinstance(m, Manifest)
    assert m.sections == {
        "release": {"name": "relkit", "version": "1.4.0", "note": "a#b", "tag": "x"},
        "b-2_x": {"k.sub": "v = w", "vazio": ""},
    }
    assert list(m.sections) == ["release", "b-2_x"]
    m = parse_manifest(BASE)
    assert m.get("release.version") == "1.4.0"
    assert m.get("release.nada", "pad") == "pad" and m.get("nada.x", "") == ""
    with pytest.raises(ConfigError) as info:
        m.get("release.nada")
    assert (info.value.line, info.value.reason) == (0, "missing 'release.nada'")
    assert str(info.value) == "line 0: missing 'release.nada'"


def test_valores_entre_aspas():
    m = parse_manifest(
        '[s]\na = "  x  y  "\nb = "q\\"r\\\\s\\n\\tz" # c\nc = "a=b"\nd = ""\n'
    )
    assert m.sections["s"] == {"a": "  x  y  ", "b": 'q"r\\s\n\tz', "c": "a=b", "d": ""}
    assert _erro('[s]\na = "x" y\n') == (2, "text after closing quote")
    assert _erro('[s]\na = "x"y\n') == (2, "text after closing quote")
    assert _erro('[s]\n\na = "abc\n') == (3, "unterminated string")
    assert _erro('[s]\na = "abc\\"\n') == (2, "unterminated string")
    assert _erro('[s]\na = "a\\q"\n') == (2, "bad escape '\\q'")
    assert parse_manifest('[s]\na = "x" #c\n').sections["s"]["a"] == "x"


def test_continuacao():
    m = parse_manifest("[s]\nlista = um,\n   dois,   # c\n\ttres\nb = 1\n")
    assert m.sections["s"] == {"lista": "um, dois, tres", "b": "1"}
    assert _erro("[s]\na = 1\n\n  b\n") == (4, "unexpected continuation")
    assert _erro("  x\n") == (1, "unexpected continuation")
    assert _erro('[s]\na = "q"\n  mais\n') in (
        (2, "continuation of quoted value"),  # M7: a linha da chave
        (3, "continuation of quoted value"),
    )
    assert parse_manifest("[s]\na = 1\n# c\n  b\n").sections["s"]["a"] == "1 b"


def test_erros_de_sintaxe_com_linha():
    assert _erro("[s]\n[s]\n") == (2, "duplicate section 's'")
    assert _erro("[1x]\n") == (1, "bad section header")
    assert _erro("[s]\nsolto\n") == (2, "expected 'key = value'")
    assert _erro("[s]\n= 1\n") == (2, "empty key")
    assert _erro("[s]\n1a = 1\n") == (2, "bad key '1a'")
    assert _erro("a = 1\n") == (1, "key outside section")
    assert _erro("[s]\n\n\na = 1\na = 2\n") == (5, "duplicate key 'a'")
    assert _erro("1a\n[s]\n") == (1, "expected 'key = value'")
    assert parse_manifest("").sections == {} and parse_manifest("[s]").sections == {
        "s": {}
    }


def test_interpolacao():
    m = parse_manifest(
        "[a]\nx = ${b.y}/z\nbarra = ${a.x}!\n[b]\ny = ${c.k} + $$5 $ ${c.k}\n[c]\nk = v\nd = $${a.x}\ne = ${c.d}\n"
    )
    assert m.sections["a"] == {"x": "v + $5 $ v/z", "barra": "v + $5 $ v/z!"}
    assert m.sections["c"] == {"k": "v", "d": "${a.x}", "e": "${a.x}"}


def test_interpolacao_erros():
    assert _erro("[s]\nx = ${s.nada}\n") == (2, "unknown reference 's.nada'")
    assert _erro("[s]\n\nx = ${nada.y}\n") == (3, "unknown reference 'nada.y'")
    assert _erro("[s]\nx = a ${s.x\n") == (2, "unterminated reference")
    assert _erro("[s]\nx = ${s.x}\n") == (2, "cycle at 's.x'")
    assert _erro("[s]\nx = ${s.y}\ny = ${s.x}\n") == (3, "cycle at 's.x'")
    assert _erro("[s]\na = ${s.b}\nb = ${s.c}\nc = ${s.a}\n") == (4, "cycle at 's.a'")
