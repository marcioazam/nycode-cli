CATALOG = {
    "en": {
        "auth.invalid_password": "Invalid password",
        "cart.empty": "Cart is empty",
        "greeting.hello": "Hello, {name}!",
    },
    "pt": {
        "auth.invalid_password": "Senha inválida",
        "cart.empty": "Carrinho vazio",
        "greeting.hello": "Olá, {name}!",
    },
}

_locale = "en"


def set_locale(loc):
    global _locale
    if loc not in CATALOG:
        raise ValueError(f"unsupported locale: {loc!r}")
    _locale = loc


def get_locale():
    return _locale


def t(key, **params):
    text = CATALOG[_locale].get(key) or CATALOG["en"].get(key)
    return key if text is None else text.format(**params)
