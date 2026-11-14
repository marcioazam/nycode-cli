import os

from people.model import Person
from people.store import load, save


def _person(args):
    try:
        if len(args) == 2:
            first, _, last = args[0].rpartition(" ")
            return (
                Person(first, last, int(args[1]))
                if first
                else Person(last, "", int(args[1]))
            )
        if len(args) == 3:
            return Person(args[0], args[1], int(args[2]))
    except ValueError:
        pass
    return None


def main(argv, path):
    people = load(path) if os.path.exists(path) else []
    if argv[:1] == ["add"]:
        person = _person(argv[1:])
        if person is None:
            return 1
        people.append(person)
        save(path, people)
        return 0
    if argv[:1] == ["list"]:
        for p in people:
            print(f"{p.name} ({p.age})")
        return 0
    return 1
