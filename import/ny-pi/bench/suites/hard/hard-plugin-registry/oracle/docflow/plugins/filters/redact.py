"""Oculta dígitos."""

import re

from docflow.plugin import Plugin

_DIGIT = re.compile(r"[0-9]")


class RedactDigits(Plugin):
    name = "redact-digits"
    priority = 80

    def apply(self, text):
        return _DIGIT.sub("#", text)
