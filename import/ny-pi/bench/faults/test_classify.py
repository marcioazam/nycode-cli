"""Classification of a run: ok, failed loudly, silent (masked) or hung."""

import classify as c
import pytest

FINAL = "DONE"


@pytest.mark.parametrize(
    ("rc", "out", "timed_out", "want"),
    [
        (0, "x DONE", False, c.OK),
        (1, "DONE", False, c.OK),
        (0, "nothing", False, c.SILENT),
        (0, "", False, c.SILENT),
        (1, "", False, c.FAILED),
        (None, "DONE", True, c.HUNG),
    ],
)
def test_classify(rc: int | None, out: str, timed_out: bool, want: str) -> None:
    assert c.classify(rc, out, FINAL, timed_out=timed_out) == want


def test_outcome_flags() -> None:
    silent = c.Outcome("a", "s", c.SILENT, 0, 1, 0.5)
    assert silent.masked and not silent.success
    ok = c.Outcome("a", "s", c.OK, 0, 1, 0.5)
    assert ok.success and not ok.masked
    assert ok.as_dict()["success"] is True
