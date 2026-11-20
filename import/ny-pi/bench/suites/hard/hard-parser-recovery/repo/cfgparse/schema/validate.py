"""Valida valores contra um esquema `{"secao.chave": "tipo"}`."""

from cfgparse.parser.diagnostics import Diagnostic
from cfgparse.result.tree import Tree
from cfgparse.schema.types import CHECKS


def validate(tree: Tree, schema: dict[str, str]) -> list[Diagnostic]:
    out = []
    for dotted, kind in schema.items():
        *path, key = dotted.split(".")
        where = tree.positions.get((tuple(path), key))
        node = tree.data
        for name in path:
            node = node.get(name, {}) if isinstance(node, dict) else {}
        if where is None or key not in node:
            continue
        if not CHECKS[kind](node[key]):
            out.append(
                Diagnostic(where[0], where[1], "E_TYPE", f"{dotted} deve ser {kind}")
            )
    return out
