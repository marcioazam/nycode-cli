from legacy import frete_tab


def test_limpa_cep():
    assert frete_tab.limpa_cep("01310-100") == "01310100"
    assert frete_tab.limpa_cep(" 01.310-100 ") == "01310100"
    assert frete_tab.limpa_cep("1234") == ""
    assert frete_tab.limpa_cep(None) == ""


def test_zona():
    assert frete_tab.zona_do_cep("01310100") == 0
    assert frete_tab.zona_do_cep("04567000") == 1
    assert frete_tab.zona_do_cep("69012345") == 5


def test_preco_base():
    assert frete_tab.preco_base(1, 800) == 1500
    assert frete_tab.preco_base(1, 4000) == 2200
    assert frete_tab.preco_base(1, 12000) == 3600


def test_tabelas_consistentes():
    assert frete_tab.confere_tabelas() == []
    assert frete_tab.servicos_da_zona(5) == ["N", "E"]
    assert frete_tab.zonas_atendidas() == [0, 1, 2, 3, 4, 5]
