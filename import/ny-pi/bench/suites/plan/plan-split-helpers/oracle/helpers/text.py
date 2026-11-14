import re


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def titlecase(s):
    return " ".join(w.capitalize() for w in s.split())
