from catalog.service import search


def main(argv, store, out=print):
    q = argv[0] if argv else ""
    for item in search(store, q):
        out(item["name"])
    return 0
