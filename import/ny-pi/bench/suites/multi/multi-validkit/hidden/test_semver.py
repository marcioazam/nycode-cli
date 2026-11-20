import pytest
from semver import compare

ORDER = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.1.0",
    "2.0.0",
    "10.0.0",
]


def test_spec_order():
    for i, a in enumerate(ORDER):
        for j, b in enumerate(ORDER):
            assert compare(a, b) == (i > j) - (i < j), (a, b)


def test_build_ignored():
    assert compare("1.0.0+a", "1.0.0+b") == 0
    assert compare("1.0.0-x+1", "1.0.0-x") == 0


@pytest.mark.parametrize(
    "bad",
    ["1.0", "1", "01.0.0", "1.0.0-", "1.0.0-01", "1.0.0-a..b", "v1.0.0", "", "1.0.0.0"],
)
def test_invalid(bad):
    with pytest.raises(ValueError):
        compare(bad, "1.0.0")
    with pytest.raises(ValueError):
        compare("1.0.0", bad)
