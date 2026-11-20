import math


def search(store, q="", page=1, per_page=10):
    if per_page < 1:
        raise ValueError("per_page must be >= 1")
    q = q.lower()
    hits = sorted(
        (i for i in store.items if q in i["name"].lower()), key=lambda i: i["name"]
    )
    pages = max(1, math.ceil(len(hits) / per_page))
    if not 1 <= page <= pages:
        raise ValueError(f"page must be in 1..{pages}")
    start = (page - 1) * per_page
    return {
        "items": hits[start : start + per_page],
        "page": page,
        "per_page": per_page,
        "total": len(hits),
        "pages": pages,
    }
