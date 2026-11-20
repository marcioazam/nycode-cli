import pytest
from util import numeros, texto


def test_pct_meio_acima():
    assert numeros.pct_meio_acima(4725, 150) == 7088
    assert numeros.pct_meio_acima(1200, 10) == 120
    with pytest.raises(ValueError):
        numeros.pct_meio_acima(-1, 10)


def test_tetos():
    assert numeros.teto_div(2100, 1000) == 3
    assert numeros.teto_multiplo(999, 100) == 1000
    assert numeros.teto_multiplo(1000, 100) == 1000


def test_texto():
    assert texto.so_digitos("0123")
    assert not texto.so_digitos("12a")
    assert not texto.so_digitos("")
    assert texto.agrupa_milhar(1234567) == "1.234.567"
    assert texto.plural(1, "dia", "dias") == "dia"
