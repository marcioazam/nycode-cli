"""Shared fixtures for the bench orchestrator tests."""

from pathlib import Path

import pytest

from bench import runners as rn
from bench.tests.helpers import MP, s1_line

FAKE_EVALS = """
import sys, pathlib, os
args = sys.argv[1:]
state = pathlib.Path(os.environ["FAKE_STATE"])
d = state / "res"; d.mkdir(exist_ok=True)
(d / "runs.jsonl").write_text(open(state / "line").read() + "\\n")
(state / "argv").write_text(" ".join(args) + "|" + os.environ.get("PELO_PI_BIN", ""))
if "--resume" not in args and os.environ.get("FAKE_DRIFT"):
    print("harness changed during the round (pi:.local/bin/pi); stopping")
elif os.environ.get("FAKE_DRIFT") == "always":
    print("harness changed during the round; stopping")
print(f"results: {d}")
"""


@pytest.fixture
def fake_evals(tmp_path: Path, monkeypatch: MP) -> Path:
    state = tmp_path / "state"
    state.mkdir()
    (state / "line").write_text(s1_line("a", 0, True))
    f = tmp_path / "fake_evals.py"
    f.write_text(FAKE_EVALS)
    monkeypatch.setattr(rn, "EVALS_RUN", f)
    monkeypatch.setattr(rn, "PELO_RUN_PI", f)
    monkeypatch.setenv("FAKE_STATE", str(state))
    monkeypatch.delenv("FAKE_DRIFT", raising=False)
    return state


@pytest.fixture(autouse=True)
def _no_disk_floor(monkeypatch: MP) -> None:
    """The disk preflight of `bench run` depends on the host; tests opt in explicitly."""
    monkeypatch.setenv("BENCH_MIN_FREE_GB", "0")
