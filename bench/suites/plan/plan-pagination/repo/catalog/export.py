from catalog.service import search


def to_csv(store):
    lines = ["name,price"] + [f"{i['name']},{i['price']}" for i in search(store)]
    return "\n".join(lines) + "\n"
