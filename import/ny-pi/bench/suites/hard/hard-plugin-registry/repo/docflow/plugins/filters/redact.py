"""Oculta dígitos."""

import re

from docflow.plugin import Plugin
from docflow.registry import register

_DIGIT = re.compile(r"[0-9]")


@register
class RedactDigits(Plugin):
    name = "redact-digits"
    priority = 80

    def apply(self, text):
        return _DIGIT.sub("#", text)
