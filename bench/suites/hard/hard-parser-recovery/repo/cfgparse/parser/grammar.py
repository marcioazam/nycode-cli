"""Percorre as linhas lógicas, monta a árvore e coleta diagnósticos."""

from cfgparse.lexer.scan import tokenize
from cfgparse.parser.diagnostics import Diagnostic, Fail
from cfgparse.parser.recovery import SectionState
from cfgparse.parser.sections import parse_assignment, parse_header
from cfgparse.reader.logical import Logical
from cfgparse.result.tree import Tree


def parse_document(lines: list[Logical]) -> tuple[Tree, list[Diagnostic]]:
    tree, diags = Tree(), []
    state = SectionState()
    for lg in lines:
        toks = tokenize(lg.text)
        if not toks:
            continue
        is_header = toks[0].kind == "LBRACK"
        try:
            if is_header:
                path = parse_header(toks)
                tree.open_section(path, toks[0].pos, lg)
                state.enter(path)
            else:
                key, value, pos = parse_assignment(toks)
                if not state.discard:
                    tree.set(state.path, key, value, pos, lg)
        except Fail as fail:
            line, col = lg.locate(fail.pos)
            diags.append(Diagnostic(line, col, fail.code, fail.message))
            if is_header:
                state.invalidate()
    return tree, diags
