from qs import encode, parse_qs


def test_parse():
    assert parse_qs("?a=1&b=2") == {"a": ["1"], "b": ["2"]}
    assert parse_qs("a=1&a=2&a=3") == {"a": ["1", "2", "3"]}
    assert parse_qs("flag&x=") == {"flag": [""], "x": [""]}
    assert parse_qs("&&a=1&") == {"a": ["1"]}
    assert parse_qs("") == {}
    assert parse_qs("?") == {}


def test_parse_decoding():
    assert parse_qs("q=hello+world%21") == {"q": ["hello world!"]}
    assert parse_qs("a%26b=c%3Dd") == {"a&b": ["c=d"]}
    assert parse_qs("k=a=b") == {"k": ["a=b"]}
    assert parse_qs("n=%C3%A7") == {"n": ["ç"]}


def test_encode():
    assert encode({"a": "1", "b": "x y"}) == "a=1&b=x+y"
    assert encode({"t": ["a", "b"], "u": "z"}) == "t=a&t=b&u=z"
    assert encode({"k": "a&b=c"}) == "k=a%26b%3Dc"
    assert encode({"e": []}) == ""
    assert encode({}) == ""
    assert encode({"n": "ç"}) == "n=%C3%A7"


def test_roundtrip():
    d = {"a b": ["1&2", "3"], "c": ["~x/y"]}
    assert parse_qs(encode(d)) == d
