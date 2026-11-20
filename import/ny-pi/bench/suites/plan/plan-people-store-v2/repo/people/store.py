import json

from people.model import Person


def load(path):
    with open(path) as f:
        data = json.load(f)
    return [Person(p["name"], p["age"]) for p in data["people"]]


def save(path, people):
    with open(path, "w") as f:
        json.dump({"people": [{"name": p.name, "age": p.age} for p in people]}, f)
