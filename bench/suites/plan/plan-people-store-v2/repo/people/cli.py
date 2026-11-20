import os

from people.model import Person
from people.store import load, save


def main(argv, path):
    people = load(path) if os.path.exists(path) else []
    if argv[:1] == ["add"] and len(argv) == 3:
        people.append(Person(argv[1], int(argv[2])))
        save(path, people)
        return 0
    if argv[:1] == ["list"]:
        for p in people:
            print(f"{p.name} ({p.age})")
        return 0
    return 1
