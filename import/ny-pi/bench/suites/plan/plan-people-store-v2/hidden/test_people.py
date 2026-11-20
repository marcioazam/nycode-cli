import json
from pathlib import Path

import pytest
from people import cli, store
from people.model import Person

V1 = {
    "people": [
        {"name": "Ada Lovelace", "age": 36},
        {"name": "Jean Claude Van Damme", "age": 60},
        {"name": "Plato", "age": 80},
    ]
}


def put(tmp_path, data):
    p = tmp_path / "db.json"
    p.write_text(json.dumps(data))
    return str(p)


def raw(path):
    with open(path) as f:
        return json.load(f)


def test_person():
    p = Person("Ada", "Lovelace", 36)
    assert (p.first, p.last, p.age, p.name) == ("Ada", "Lovelace", 36, "Ada Lovelace")
    assert Person(first="Plato", last="", age=80).name == "Plato"


def test_load_v1(tmp_path):
    people = store.load(put(tmp_path, V1))
    assert [(p.first, p.last, p.age) for p in people] == [
        ("Ada", "Lovelace", 36),
        ("Jean Claude Van", "Damme", 60),
        ("Plato", "", 80),
    ]


def test_load_v2_and_save_roundtrip(tmp_path):
    path = put(
        tmp_path, {"version": 2, "people": [{"first": "A", "last": "B", "age": 1}]}
    )
    people = store.load(path)
    assert people == [Person("A", "B", 1)]
    store.save(path, people + [Person("C", "", 2)])
    assert raw(path) == {
        "version": 2,
        "people": [
            {"first": "A", "last": "B", "age": 1},
            {"first": "C", "last": "", "age": 2},
        ],
    }


def test_save_writes_v2_from_v1(tmp_path):
    path = put(tmp_path, V1)
    store.save(path, store.load(path))
    assert raw(path)["version"] == 2


def test_unknown_version(tmp_path):
    with pytest.raises(ValueError):
        store.load(put(tmp_path, {"version": 3, "people": []}))


def test_migrate(tmp_path):
    path = put(tmp_path, V1)
    assert store.migrate(path) is True
    data = raw(path)
    assert data["version"] == 2 and data["people"][1] == {
        "first": "Jean Claude Van",
        "last": "Damme",
        "age": 60,
    }
    before = Path(path).read_text()
    assert store.migrate(path) is False
    assert Path(path).read_text() == before


def test_migrate_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        store.migrate(str(tmp_path / "nope.json"))


def test_cli_add_both_forms(tmp_path, capsys):
    path = put(tmp_path, V1)
    assert cli.main(["add", "Grace Hopper", "85"], path) == 0
    assert cli.main(["add", "Alan", "Turing", "41"], path) == 0
    assert cli.main(["add", "Cher", "77"], path) == 0
    data = raw(path)
    assert data["version"] == 2
    assert data["people"][-3:] == [
        {"first": "Grace", "last": "Hopper", "age": 85},
        {"first": "Alan", "last": "Turing", "age": 41},
        {"first": "Cher", "last": "", "age": 77},
    ]
    assert cli.main(["list"], path) == 0
    out = capsys.readouterr().out.splitlines()
    assert (
        out[0] == "Ada Lovelace (36)"
        and out[-1] == "Cher (77)"
        and "Alan Turing (41)" in out
    )


def test_cli_new_file(tmp_path):
    path = str(tmp_path / "new.json")
    assert cli.main(["add", "A", "B", "3"], path) == 0
    assert raw(path) == {
        "version": 2,
        "people": [{"first": "A", "last": "B", "age": 3}],
    }


@pytest.mark.parametrize(
    "argv",
    [
        ["add"],
        ["add", "X"],
        ["add", "A", "x"],
        ["add", "A", "B", "x"],
        ["add", "A", "B", "C", "4"],
        ["nope"],
        [],
    ],
)
def test_cli_invalid_leaves_file(tmp_path, argv):
    path = put(tmp_path, V1)
    before = Path(path).read_text()
    assert cli.main(argv, path) == 1
    assert Path(path).read_text() == before
