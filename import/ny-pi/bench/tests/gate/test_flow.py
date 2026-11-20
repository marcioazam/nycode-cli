"""Sequential gate flow (bench/gate.py gate, tier pr): the three looks with a fake extension command. No model."""

import sys
from pathlib import Path
from typing import Any

from bench import gate as bg
from bench import runners as rn
from bench import stats
from bench.tests.helpers import MP
from bench.tests.test_rounds import write_round

# Fake `--extension`: one row per task x rep, failing for the tasks of FAKE_FAIL; logs "side reps tasks".
FAKE_EXT = """
import json, os
tasks = [t for t in os.environ["BENCH_EXTEND_TASKS"].split(",") if t]
reps = int(os.environ["BENCH_EXTEND_REPS"])
fail = set(os.environ.get("FAKE_FAIL", "").split(","))
with open(os.environ["BENCH_EXTEND_OUT"], "a") as f:
    for t in tasks:
        for r in range(reps):
            f.write(json.dumps({"suite": "s4", "task_id": t, "rep": r, "passed": t not in fail, "cost_usd": 1.0,
                                "wall_s": 1.0, "security": t.startswith("sec-"), "turns": 10, "error": None}) + "\\n")
with open(os.environ["FAKE_LOG"], "a") as f:
    f.write(f"{os.environ['BENCH_EXTEND_SIDE']} {reps} {len(tasks)}\\n")
"""


def row(
    suite: str, t: str, r: int, ok: bool = True, cost: float = 1.0, **kw: Any
) -> dict[str, Any]:
    return rn.make_run(suite, t, r, ok, cost_usd=cost, wall_s=1.0, turns=10, **kw)


def rounds(
    tmp: Path,
    fail: frozenset[int] | set[int] = frozenset(),
    cost: float = 1.0,
    sec_fails: int = 0,
) -> tuple[Path, Path]:
    names = [f"t{i}" for i in range(30)]
    base = [row("s4", t, r) for t in names for r in range(12)]
    base += [row("s1", "sec-x", r, security=True) for r in range(12)]
    base += [row("s2", "h0", r) for r in range(4)]
    cand = [row("s4", t, 0, i not in fail, cost) for i, t in enumerate(names)]
    cand += [row("s1", "sec-x", r, r >= sec_fails, security=True) for r in range(3)]
    cand += [row("s2", "h0", 0)]
    return write_round(tmp / "b", base), write_round(tmp / "c", cand, tier="pr")


def run_gate(
    tmp: Path, mp: MP, fail_ext: str = "", **kw: Any
) -> tuple[dict[str, Any], str, list[str]]:
    mp.setattr(bg, "changed_paths", lambda *_: [])
    b, c = rounds(tmp, **kw)
    (tmp / "ext.py").write_text(FAKE_EXT)
    mp.setenv("FAKE_LOG", str(tmp / "log"))
    mp.setenv("FAKE_FAIL", fail_ext)
    v, md, _ = bg.gate(b, c, f"{sys.executable} {tmp / 'ext.py'}")
    log = (tmp / "log").read_text().splitlines() if (tmp / "log").exists() else []
    return v, md, log


def test_look1_early_pass_runs_nothing_more(tmp_path: Path, monkeypatch: MP) -> None:
    v, md, log = run_gate(tmp_path, monkeypatch)
    assert (v["verdict"], v["look"], log) == ("PASS", 1, [])
    assert "Parou no olhar 1" in md and f"IC{round((1 - stats.ALPHA1) * 100)}" in md


def test_look1_early_fail_runs_nothing_more(tmp_path: Path, monkeypatch: MP) -> None:
    v, _, log = run_gate(tmp_path, monkeypatch, fail=set(range(15)))
    assert (v["verdict"], v["look"], log) == ("FAIL", 1, [])


def test_look2_completes_k3_on_non_security_non_harbor_tasks(tmp_path: Path, monkeypatch: MP) -> None:  # fmt: skip
    v, md, log = run_gate(tmp_path, monkeypatch, cost=1.08)
    assert (v["verdict"], v["look"], log) == ("PASS", 2, ["cand 2 30"])
    assert "Parou no olhar 2" in md


def test_look3_is_the_current_extension_of_discordant_tasks(tmp_path: Path, monkeypatch: MP) -> None:  # fmt: skip
    ext_fail = ",".join(f"t{i}" for i in range(6))
    v, md, log = run_gate(tmp_path, monkeypatch, fail_ext=ext_fail, fail={0}, cost=1.08)
    assert v["look"] == 3 and log[0] == "cand 2 30" and log[1].startswith("cand 3 ")
    assert "Parou no olhar 3" in md
