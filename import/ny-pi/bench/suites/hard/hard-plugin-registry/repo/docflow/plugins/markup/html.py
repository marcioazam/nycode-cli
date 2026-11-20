"""HTML: remoção de tags e escape."""

import html
import re

from docflow.plugin import Plugin
from docflow.registry import register

_TAG = re.compile(r"<[^>]*>")


@register
class StripTags(Plugin):
    name = "strip-tags"
    priority = 30

    def apply(self, text):
        return _TAG.sub("", text)


@register
class Escape(Plugin):
    name = "escape"
    priority = 70

    def apply(self, text):
        return html.escape(text, quote=False)
