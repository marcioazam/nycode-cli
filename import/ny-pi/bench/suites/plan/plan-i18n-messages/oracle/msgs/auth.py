from msgs.i18n import t


def login(user, password):
    if password != "secret":
        raise ValueError(t("auth.invalid_password"))
    return {"user": user}
