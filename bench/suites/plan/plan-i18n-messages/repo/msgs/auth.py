def login(user, password):
    if password != "secret":
        raise ValueError("Invalid password")
    return {"user": user}
