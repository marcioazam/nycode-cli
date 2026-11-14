def search(store, q=""):
    q = q.lower()
    hits = (i for i in store.items if q in i["name"].lower())
    return sorted(hits, key=lambda i: i["name"])
