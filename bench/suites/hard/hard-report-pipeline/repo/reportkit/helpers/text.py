"""Text fitting for fixed-width output."""

ELLIPSIS = "..."
_FLATTEN = str.maketrans({"\t": " ", "\r": " ", "\n": " "})


def flatten(text):
    """Replace each tab, carriage return and line feed by one space."""
    return text.translate(_FLATTEN)


def fit(text, width):
    """Flatten, cut to `width` (marking the cut with an ellipsis) and pad right."""
    text = flatten(text)
    if len(text) > width:
        text = text[: width - len(ELLIPSIS)] + ELLIPSIS
    return text.ljust(width)
