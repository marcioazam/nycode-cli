import pytest
from stockroom.config import reset_config
from stockroom.util.ids import reset_ids


@pytest.fixture(autouse=True)
def _isolated_process_state():
    """Ids e configuração são globais do processo (SPEC 11 e 12): cada teste começa limpo."""
    reset_ids()
    reset_config()
    yield
    reset_ids()
    reset_config()
