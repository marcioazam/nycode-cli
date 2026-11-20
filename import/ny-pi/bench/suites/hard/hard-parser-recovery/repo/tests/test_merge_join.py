from cfgparse.reader.join import join_lines
from cfgparse.reader.source import split_lines
from cfgparse.result.merge import merge


def test_merge_deep():
    assert merge({"a": {"x": 1, "y": 2}, "b": 1}, {"a": {"y": 3}}) == {
        "a": {"x": 1, "y": 3},
        "b": 1,
    }


def test_join_spans_and_first_line():
    logical = join_lines(split_lines("a = [\n  1,\n  2\n]\nb = 2"))
    assert [lg.line for lg in logical] == [1, 5]
    assert len(logical[0].starts) == 4


def test_locate_inside_line():
    lg = join_lines(split_lines("a = [\n  1,\n  2\n]"))[0]
    assert lg.locate(lg.text.index("2")) == (3, 3)


def test_comment_backslash_does_not_continue():
    assert len(join_lines(split_lines("# x \\\na = 1"))) == 2
