from helpers import mean, titlecase


def summary(title, values):
    return f"{titlecase(title)}: {mean(values):.2f}"
