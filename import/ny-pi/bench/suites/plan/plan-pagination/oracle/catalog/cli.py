from catalog.service import search


def main(argv, store, out=print):
    q, page, per_page = "", 1, 10
    try:
        args = list(argv)
        while args:
            a = args.pop(0)
            if a in ("--page", "--per-page"):
                if not args:
                    raise ValueError(f"{a} needs a value")
                value = int(args.pop(0))
                if a == "--page":
                    page = value
                else:
                    per_page = value
            else:
                q = a
        r = search(store, q, page, per_page)
    except ValueError as e:
        out(f"error: {e}")
        return 2
    for item in r["items"]:
        out(item["name"])
    out(f"page {r['page']}/{r['pages']}")
    return 0
