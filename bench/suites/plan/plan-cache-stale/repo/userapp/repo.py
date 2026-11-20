class UserRepo:
    def __init__(self, users):
        self._d = {u["id"]: dict(u) for u in users}
        self.reads = 0

    def get(self, uid):
        self.reads += 1
        return dict(self._d[uid])

    def all(self):
        self.reads += 1
        return [dict(self._d[k]) for k in sorted(self._d)]

    def update(self, uid, name):
        self._d[uid]["name"] = name

    def delete(self, uid):
        del self._d[uid]
