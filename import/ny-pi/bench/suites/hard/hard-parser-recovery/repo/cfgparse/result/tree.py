"""Árvore aninhada de seções e posições das chaves."""

from typing import Any

from cfgparse.parser.diagnostics import Fail
from cfgparse.reader.logical import Logical


class Tree:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {}
        self.opened: set[tuple[str, ...]] = set()
        self.positions: dict[tuple[tuple[str, ...], str], tuple[int, int]] = {}

    def _node(self, path: tuple[str, ...], pos: int) -> dict[str, Any]:
        node = self.data
        for name in path:
            child = node.setdefault(name, {})
            if not isinstance(child, dict):
                raise Fail(pos, "E_CONFLICT", f"'{name}' já é um valor")
            node = child
        return node

    def open_section(self, path: tuple[str, ...], pos: int, lg: Logical) -> None:
        if path in self.opened:
            raise Fail(pos, "E_DUP_SECTION", f"seção duplicada [{'.'.join(path)}]")
        self._node(path, pos)
        self.opened.add(path)

    def set(
        self, path: tuple[str, ...], key: str, value: Any, pos: int, lg: Logical
    ) -> None:
        node = self._node(path, pos)
        if key in node:
            raise Fail(pos, "E_DUP_KEY", f"chave duplicada {key!r}")
        node[key] = value
        self.positions[(path, key)] = lg.locate(pos)
