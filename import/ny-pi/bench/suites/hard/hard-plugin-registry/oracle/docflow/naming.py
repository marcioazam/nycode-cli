"""Normalização de nomes de plugin."""

import re

from docflow.errors import InvalidPluginNameError

MAX_LENGTH = 32
_VALID = re.compile(r"[a-z][a-z0-9]*(-[a-z0-9]+)*")


def normalize_name(name):
    """Minúsculas, sem espaços nas pontas, `_` vira `-`; valida o formato."""
    if not isinstance(name, str):
        raise InvalidPluginNameError(f"plugin name must be str: {name!r}")
    key = name.strip().lower().replace("_", "-")
    if len(key) > MAX_LENGTH or not _VALID.fullmatch(key):
        raise InvalidPluginNameError(f"invalid plugin name: {name!r}")
    return key
