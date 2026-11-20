import pytest
from stockroom.config import reset_config
from stockroom.util.ids import reset_ids


@pytest.fixture(autouse=True)
def _clean_process_state():
    reset_ids()
    reset_config()
    yield
    reset_ids()
    reset_config()
