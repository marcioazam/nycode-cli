import pytest
from userapp.cache import Cache
from userapp.repo import UserRepo
from userapp.service import Service


def make():
    repo = UserRepo(
        [{"id": 1, "name": "ann"}, {"id": 2, "name": "bob"}, {"id": 3, "name": "cy"}]
    )
    return Service(repo, Cache()), repo


def names(svc):
    return [u["name"] for u in svc.list_users()]


def test_rename_refreshes_list_and_get():
    svc, _ = make()
    assert names(svc) == ["ann", "bob", "cy"]
    assert svc.get_user(2)["name"] == "bob"
    svc.rename_user(2, "robert")
    assert names(svc) == ["ann", "robert", "cy"]
    assert svc.get_user(2)["name"] == "robert"


def test_rename_unread_user_does_not_crash():
    svc, _ = make()
    svc.rename_user(1, "anna")
    assert svc.get_user(1)["name"] == "anna"
    svc2, _ = make()
    svc2.rename_user(3, "cyd")
    assert names(svc2) == ["ann", "bob", "cyd"]


def test_delete_refreshes_get_and_list():
    svc, _ = make()
    svc.get_user(1)
    svc.list_users()
    svc.delete_user(1)
    with pytest.raises(KeyError):
        svc.get_user(1)
    assert names(svc) == ["bob", "cy"]


def test_delete_unread_user():
    svc, _ = make()
    svc.delete_user(2)
    assert names(svc) == ["ann", "cy"]


def test_cache_still_effective():
    svc, repo = make()
    svc.get_user(1)
    svc.get_user(1)
    svc.get_user(2)
    assert repo.reads == 2
    svc.list_users()
    svc.list_users()
    assert repo.reads == 3


def test_other_entries_survive_a_write():
    svc, repo = make()
    svc.get_user(1)
    svc.get_user(3)
    svc.rename_user(2, "x")
    before = repo.reads
    svc.get_user(1)
    svc.get_user(3)
    assert repo.reads == before


def test_missing_user_raises_and_is_not_cached():
    svc, repo = make()
    for _ in range(2):
        with pytest.raises(KeyError):
            svc.get_user(99)
    assert repo.reads == 2
    with pytest.raises(KeyError):
        svc.rename_user(99, "z")
    with pytest.raises(KeyError):
        svc.delete_user(99)
    assert names(svc) == ["ann", "bob", "cy"]
