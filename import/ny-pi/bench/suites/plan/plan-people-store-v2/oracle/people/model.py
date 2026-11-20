from dataclasses import dataclass


@dataclass
class Person:
    first: str
    last: str
    age: int

    @property
    def name(self):
        return f"{self.first} {self.last}".strip()
