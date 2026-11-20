USERS = {"ana": "pw1", "admin": "root"}


def attempt(user, password):
    return USERS.get(user) == password
