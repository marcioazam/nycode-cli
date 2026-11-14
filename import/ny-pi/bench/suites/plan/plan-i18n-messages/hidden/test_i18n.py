import pytest
from msgs import auth, cart, greeting, i18n


@pytest.fixture(autouse=True)
def reset():
    i18n.set_locale("en")
    yield
    i18n.set_locale("en")


def test_default_english_unchanged():
    assert i18n.get_locale() == "en"
    with pytest.raises(ValueError, match="^Invalid password$"):
        auth.login("u", "x")
    assert auth.login("u", "secret") == {"user": "u"}
    with pytest.raises(ValueError, match="^Cart is empty$"):
        cart.checkout([])
    assert cart.checkout([1, 2]) == 3
    assert greeting.greet("Ana") == "Hello, Ana!"


def test_portuguese():
    i18n.set_locale("pt")
    assert i18n.get_locale() == "pt"
    with pytest.raises(ValueError, match="^Senha inválida$"):
        auth.login("u", "x")
    with pytest.raises(ValueError, match="^Carrinho vazio$"):
        cart.checkout([])
    assert greeting.greet("Ana") == "Olá, Ana!"


def test_switch_back_and_forth():
    i18n.set_locale("pt")
    i18n.set_locale("en")
    assert greeting.greet("B") == "Hello, B!"


@pytest.mark.parametrize("loc", ["fr", "", "PT", None])
def test_unsupported_locale(loc):
    with pytest.raises(ValueError):
        i18n.set_locale(loc)
    assert i18n.get_locale() == "en"


def test_t_unknown_key_and_params():
    assert i18n.t("no.such.key") == "no.such.key"
    i18n.set_locale("pt")
    assert i18n.t("no.such.key") == "no.such.key"
    assert i18n.t("greeting.hello", name="Zé") == "Olá, Zé!"
    assert i18n.t("cart.empty") == "Carrinho vazio"


def test_fallback_to_english(monkeypatch):
    i18n.set_locale("pt")
    monkeypatch.delitem(i18n.CATALOG["pt"], "cart.empty")
    assert i18n.t("cart.empty") == "Cart is empty"
    with pytest.raises(ValueError, match="^Cart is empty$"):
        cart.checkout([])


def test_catalog_shape():
    assert set(i18n.CATALOG) >= {"en", "pt"}
    assert (
        set(i18n.CATALOG["en"])
        == set(i18n.CATALOG["pt"])
        == {"auth.invalid_password", "cart.empty", "greeting.hello"}
    )
