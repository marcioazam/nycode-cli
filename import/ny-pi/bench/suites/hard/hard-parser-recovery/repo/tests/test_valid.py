from cfgparse import load


def test_scalars_and_sections():
    cfg = load(
        'top = 1\n[server.http]\nport = 8080\nname = "a b"\nratio = 0.5\non = true\n'
    )
    assert cfg == {
        "top": 1,
        "server": {"http": {"port": 8080, "name": "a b", "ratio": 0.5, "on": True}},
    }


def test_lists_and_trailing_comma():
    cfg = load('xs = [1, "a", true,]\nys = []\nzs = [[1], [2]]\n')
    assert cfg == {"xs": [1, "a", True], "ys": [], "zs": [[1], [2]]}


def test_multiline_list_indented():
    assert load("ports = [\n  80,\n  443,\n]\n")["ports"] == [80, 443]


def test_continuation():
    assert load("a = \\\n  5\n")["a"] == 5


def test_comments_and_escapes():
    cfg = load('a = "x#y\\n\\"q\\""  # nota\n# so comentario\n')
    assert cfg == {"a": 'x#y\n"q"'}


def test_crlf():
    assert load("a = 1\r\n[s]\r\nb = 2\r\n") == {"a": 1, "s": {"b": 2}}
