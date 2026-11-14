from msgs.i18n import t


def greet(name):
    return t("greeting.hello", name=name)
