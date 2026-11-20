from msgs.i18n import t


def checkout(items):
    if not items:
        raise ValueError(t("cart.empty"))
    return sum(items)
