"""HTML: remoção de tags e escape."""

import html
import re

from docflow.plugin import Plugin

_TAG = re.compile(r"<[^>]*>")


class StripTags(Plugin):
    name = "strip-tags"
    priority = 30

    def apply(self, text):
        return _TAG.sub("", text)


class Escape(Plugin):
    name = "escape"
    priority = 70

    def apply(self, text):
        return html.escape(text, quote=False)
