import pytest
from catalog import cli, export, service
from catalog.store import Store


def make(n=25):
    return Store([{"name": f"item{i:02d}", "price": i} for i in range(n)])


def test_pages():
    s = make()
    r = service.search(s, "", 1, 10)
    assert (r["page"], r["per_page"], r["total"], r["pages"]) == (1, 10, 25, 3)
    assert [i["name"] for i in r["items"]] == [f"item{i:02d}" for i in range(10)]
    r3 = service.search(s, page=3)
    assert [i["name"] for i in r3["items"]] == [f"item{i:02d}" for i in range(20, 25)]
    assert service.search(s, per_page=5, page=5)["items"][0]["name"] == "item20"


def test_defaults_and_filter():
    s = Store(
        [
            {"name": "Widget", "price": 1},
            {"name": "gadget", "price": 2},
            {"name": "WIDGET pro", "price": 3},
        ]
    )
    r = service.search(s, "widget")
    assert [i["name"] for i in r["items"]] == ["WIDGET pro", "Widget"] and r[
        "total"
    ] == 2
    assert (r["page"], r["per_page"], r["pages"]) == (1, 10, 1)
    assert service.search(s)["items"][0]["name"] == "WIDGET pro"


def test_exact_multiple_pages():
    assert service.search(make(20), per_page=10)["pages"] == 2
    assert service.search(make(21), per_page=10)["pages"] == 3


def test_empty_result():
    r = service.search(make(), "zzz")
    assert r == {"items": [], "page": 1, "per_page": 10, "total": 0, "pages": 1}
    with pytest.raises(ValueError):
        service.search(make(), "zzz", page=2)


@pytest.mark.parametrize(
    "kw", [{"page": 0}, {"page": -1}, {"page": 4}, {"per_page": 0}, {"per_page": -5}]
)
def test_invalid(kw):
    with pytest.raises(ValueError):
        service.search(make(), **kw)


def test_export_still_everything():
    lines = export.to_csv(make(25)).splitlines()
    assert lines[0] == "name,price" and len(lines) == 26 and lines[-1] == "item24,24"
    assert export.to_csv(make(0)) == "name,price\n"


def run(argv, store=None):
    lines = []
    code = cli.main(argv, store or make(), out=lines.append)
    return code, lines


def test_cli_default():
    code, lines = run([])
    assert (
        code == 0
        and len(lines) == 11
        and lines[0] == "item00"
        and lines[-1] == "page 1/3"
    )


def test_cli_options():
    code, lines = run(["item1", "--page", "2", "--per-page", "4"])
    assert code == 0
    assert lines == ["item14", "item15", "item16", "item17", "page 2/3"]
    code, lines = run(["--per-page", "30"])
    assert code == 0 and len(lines) == 26 and lines[-1] == "page 1/1"


@pytest.mark.parametrize(
    "argv",
    [
        ["--page", "9"],
        ["--page", "0"],
        ["--per-page", "0"],
        ["--page", "x"],
        ["--page"],
    ],
)
def test_cli_invalid(argv):
    code, lines = run(argv)
    assert code == 2 and len(lines) == 1 and lines[0].startswith("error: ")
