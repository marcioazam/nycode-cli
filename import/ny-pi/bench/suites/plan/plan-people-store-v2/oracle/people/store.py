import json

from people.model import Person


def _read(path):
    with open(path) as f:
        data = json.load(f)
    version = data.get("version", 1)
    if version == 1:
        out = []
        for p in data["people"]:
            first, _, last = p["name"].rpartition(" ")
            out.append(
                Person(first, last, p["age"]) if first else Person(last, "", p["age"])
            )
        return version, out
    if version == 2:
        return version, [
            Person(p["first"], p["last"], p["age"]) for p in data["people"]
        ]
    raise ValueError(f"unknown version {version}")


def load(path):
    return _read(path)[1]


def save(path, people):
    data = {
        "version": 2,
        "people": [{"first": p.first, "last": p.last, "age": p.age} for p in people],
    }
    with open(path, "w") as f:
        json.dump(data, f)


def migrate(path):
    version, people = _read(path)
    if version == 2:
        return False
    save(path, people)
    return True
