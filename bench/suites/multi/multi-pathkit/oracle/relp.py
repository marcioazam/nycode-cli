import posixpath


def relpath(target: str, start: str) -> str:
    if not (target.startswith("/") and start.startswith("/")):
        raise ValueError("paths must be absolute")
    return posixpath.relpath(posixpath.normpath(target), posixpath.normpath(start))
