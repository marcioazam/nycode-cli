from catalog.service import search


def to_csv(store):
    rows = search(store, per_page=max(1, len(store.items)))["items"]
    lines = ["name,price"] + [f"{i['name']},{i['price']}" for i in rows]
    return "\n".join(lines) + "\n"
