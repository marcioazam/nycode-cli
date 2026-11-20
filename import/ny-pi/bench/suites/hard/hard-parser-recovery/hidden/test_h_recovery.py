import pytest
from cfgparse import load, parse
from cfgparse.cli import main
from cfgparse.parser.diagnostics import ParseError


def run(text, **kw):
    result = parse(text, **kw)
    return [(d.line, d.col, d.code) for d in result.diagnostics], result.config


# --- sintoma relatado: linha inválida estraga as seguintes (regras 5, 9, 14) ---


def test_unterminated_string_then_multiline_list():
    text = 'a = "abc\nxs = [\n  1,\n  2,\n]\nb = 2\n'
    assert run(text) == ([(1, 5, "E_STRING")], {"xs": [1, 2], "b": 2})


def test_unterminated_string_then_string_with_bracket():
    text = 'a = "abc\nname = "x[y"\nb = 2\nc = @\n'
    assert run(text) == (
        [(1, 5, "E_STRING"), (4, 5, "E_CHAR")],
        {"name": "x[y", "b": 2},
    )


def test_unterminated_string_then_comment_with_bracket():
    text = 'a = "abc\nb = "v" # ver [1\nc = 3\n'
    assert run(text) == ([(1, 5, "E_STRING")], {"b": "v", "c": 3})


def test_unterminated_string_crlf():
    text = 'a = "abc\r\nxs = [\r\n1,\r\n]\r\nb = $\r\n'
    assert run(text) == ([(1, 5, "E_STRING"), (5, 5, "E_CHAR")], {"xs": [1]})


def test_header_without_closing_bracket():
    text = "[bad\nk = 1\nj = @\n[ok]\nx = 1\ny = $\n"
    assert run(text) == (
        [(1, 1, "E_HEADER"), (3, 5, "E_CHAR"), (6, 5, "E_CHAR")],
        {"ok": {"x": 1}},
    )


def test_header_without_closing_bracket_then_multiline_list():
    text = "top = 1\n[a.b\nk = 1\n[c]\nxs = [\n  1,\n]\n"
    assert run(text) == ([(2, 1, "E_HEADER")], {"top": 1, "c": {"xs": [1]}})


def test_stray_closing_bracket_then_multiline_list():
    text = "a = 1]\nxs = [\n1,\n2\n]\nb = 3\n"
    assert run(text) == ([(1, 6, "E_SYNTAX")], {"xs": [1, 2], "b": 3})


def test_stray_bracket_does_not_leak_into_next_section():
    text = "[s]\na = ]\n[t]\nxs = [\n  [1],\n  [2],\n]\nb = 1\n"
    assert run(text) == (
        [(2, 5, "E_SYNTAX")],
        {"s": {}, "t": {"xs": [[1], [2]], "b": 1}},
    )


def test_extra_closing_bracket_in_multiline_list():
    text = "xs = [\n1\n]]\nys = [\n2\n]\nz = 1\n"
    assert run(text) == ([(3, 2, "E_SYNTAX")], {"ys": [2], "z": 1})


def test_unterminated_string_inside_multiline_list():
    text = 'xs = [\n  "abc,\n  2,\n]\nb = 1\nc = $\n'
    assert run(text) == ([(2, 3, "E_STRING"), (6, 5, "E_CHAR")], {"b": 1})


def test_unterminated_string_with_bracket_inside_multiline_list():
    text = 'xs = [\n  "a]b,\n  2\n]\nys = [\n  3\n]\n'
    assert run(text) == ([(2, 3, "E_STRING")], {"ys": [3]})


def test_several_bad_lines_each_contained():
    text = 'a = "x\nb = 1]\n[h\nc = "y\n[ok]\nxs = [\n  "p[", "q]",\n]\nd = 4\n'
    want = [
        (1, 5, "E_STRING"),
        (2, 6, "E_SYNTAX"),
        (3, 1, "E_HEADER"),
        (4, 5, "E_STRING"),
    ]
    assert run(text) == (want, {"ok": {"xs": ["p[", "q]"], "d": 4}})


def test_schema_after_bad_line():
    text = 'a = "abc\n[server]\nports = [\n  80,\n]\nport = "x"\n'
    diags, config = run(text, schema={"server.port": "int", "server.ports": "list"})
    assert diags == [(1, 5, "E_STRING"), (6, 1, "E_TYPE")]
    assert config == {"server": {"ports": [80], "port": "x"}}


def test_strict_reports_only_the_real_error():
    text = "a = 1]\nxs = [\n  1,\n]\n"
    with pytest.raises(ParseError) as exc:
        load(text)
    d = exc.value.diagnostic
    assert (d.line, d.col, d.code) == (1, 6, "E_SYNTAX")
    assert len(parse(text).diagnostics) == 1


def test_cli_lists_only_real_errors(tmp_path, capsys):
    path = tmp_path / "c.cfg"
    path.write_bytes(b'a = "abc\nxs = [\n  1,\n]\nb = @\n')
    assert main([str(path)]) == 1
    lines = capsys.readouterr().out.strip().splitlines()
    assert [ln.split(": ", 2)[:2] for ln in lines] == [
        ["1:5", "E_STRING"],
        ["5:5", "E_CHAR"],
    ]


# --- regras vizinhas que o conserto não pode quebrar ---


def test_valid_multiline_forms_still_join():
    text = 'xs = [\n[1, 2],\n["a]", "b["], # ] [\n]\ny = \\\n  [1,\n  2]\nz = "q" # "\nw = [\n]\n'
    assert load(text) == {"xs": [[1, 2], ["a]", "b["]], "y": [1, 2], "z": "q", "w": []}


def test_unterminated_list_consumes_rest_once():
    text = "a = 1\nb = [1,\n  2,\n\n  [3],\n"
    assert run(text) == ([(2, 5, "E_LIST")], {"a": 1})


def test_error_position_inside_multiline_list():
    assert run("xs = [\n1,\noops,\n3\n]\nb = 2\n") == ([(3, 1, "E_SYNTAX")], {"b": 2})
    assert run('xs = [\n  1,\n  "a\\q",\n]\nb = 2\n') == (
        [(3, 5, "E_STRING")],
        {"b": 2},
    )


def test_invalid_header_body_checked_and_discarded():
    text = "[s]\na = 1\n[s]\na = 2\na = 3\nb = [\n  $,\n]\n[t]\nc = 3\n[t.u\nd = 1\n[v]\ne = 5\n"
    want = [(3, 1, "E_DUP_SECTION"), (7, 3, "E_CHAR"), (11, 1, "E_HEADER")]
    assert run(text) == (want, {"s": {"a": 1}, "t": {"c": 3}, "v": {"e": 5}})


def test_invalid_line_defines_nothing():
    text = "a = 1 2\na = 3\n[s x]\nk = 1\n[s]\nk = 2\n"
    assert run(text) == (
        [(1, 7, "E_SYNTAX"), (3, 4, "E_HEADER")],
        {"a": 3, "s": {"k": 2}},
    )


def test_comment_backslash_and_continuation():
    text = "a = 1 # nota \\\nb = \\\n  2\nc = [ # abre \\\n  3]\n"
    assert load(text) == {"a": 1, "b": 2, "c": [3]}
