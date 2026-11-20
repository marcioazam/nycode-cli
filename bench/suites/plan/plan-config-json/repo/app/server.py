from app.config import load


def describe(path):
    c = load(path)
    mode = "debug" if c["debug"] else "prod"
    return f"{c['host']}:{c['port']} ({mode})"
