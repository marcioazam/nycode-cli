from helpers import slugify


def link(title):
    return "/posts/" + slugify(title)
