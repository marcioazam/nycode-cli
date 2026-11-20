"""API pública: `parse` e `load`."""

from dataclasses import dataclass, field
from typing import Any

from cfgparse.parser.diagnostics import Diagnostic, ParseError
from cfgparse.parser.grammar import parse_document
from cfgparse.reader.join import join_lines
from cfgparse.reader.source import split_lines
from cfgparse.schema.validate import validate


@dataclass
class Result:
    config: dict[str, Any]
    diagnostics: list[Diagnostic] = field(default_factory=list)


def parse(
    text: str, strict: bool = False, schema: dict[str, str] | None = None
) -> Result:
    tree, diags = parse_document(join_lines(split_lines(text)))
    if schema:
        diags += validate(tree, schema)
    diags.sort(key=lambda d: (d.line, d.col))
    if strict and diags:
        raise ParseError(diags[0])
    return Result(tree.data, diags)


def load(text: str, schema: dict[str, str] | None = None) -> dict[str, Any]:
    """Como `parse(strict=True)`, devolvendo só a configuração."""
    return parse(text, strict=True, schema=schema).config
