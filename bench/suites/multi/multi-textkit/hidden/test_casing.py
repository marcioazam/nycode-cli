import pytest
from casing import to_camel, to_snake


@pytest.mark.parametrize(
    "src,out",
    [
        ("HTTPServerError", "http_server_error"),
        ("userID2", "user_id2"),
        ("my-var name", "my_var_name"),
        ("getHTTPResponse", "get_http_response"),
        ("already_snake", "already_snake"),
        ("", ""),
        ("A", "a"),
    ],
)
def test_snake(src, out):
    assert to_snake(src) == out


@pytest.mark.parametrize(
    "src,out",
    [
        ("user_id_name", "userIdName"),
        ("Foo-bar", "fooBar"),
        ("two words", "twoWords"),
        ("__lead__trail__", "lead" + "Trail"),
        ("", ""),
        ("single", "single"),
    ],
)
def test_camel(src, out):
    assert to_camel(src) == out
