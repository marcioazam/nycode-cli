class Service:
    def __init__(self, repo, cache):
        self.repo = repo
        self.cache = cache

    def get_user(self, uid):
        key = f"user:{uid}"
        v = self.cache.get(key)
        if v is None:
            v = self.repo.get(uid)
            self.cache.set(key, v)
        return v

    def list_users(self):
        v = self.cache.get("users:all")
        if v is None:
            v = self.repo.all()
            self.cache.set("users:all", v)
        return v

    def rename_user(self, uid, name):
        self.repo.update(uid, name)
        self.cache.delete(f"user:{uid}")

    def delete_user(self, uid):
        self.repo.delete(uid)
        self.cache.delete("users:all")
