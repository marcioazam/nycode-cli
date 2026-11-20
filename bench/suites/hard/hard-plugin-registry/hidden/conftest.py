import pytest


@pytest.fixture(autouse=True)
def _clean_default():
    from docflow import registry as reg

    def wipe():
        try:
            reg.clear()
        except Exception:  # noqa: BLE001, S110
            pass
        d = getattr(reg, "default_registry", None)
        if d is not None:
            try:
                d().clear()
            except Exception:  # noqa: BLE001, S110
                pass

    wipe()
    yield
    wipe()
