def normalize(path: str) -> str:
    absolute = path.startswith("/")
    out: list[str] = []
    for p in path.split("/"):
        if p in ("", "."):
            continue
        if p == "..":
            if out and out[-1] != "..":
                out.pop()
            elif not absolute:
                out.append("..")
        else:
            out.append(p)
    r = "/".join(out)
    return "/" + r if absolute else (r or ".")
