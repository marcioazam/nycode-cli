"""`bench gate --parity` (D-28, docs/migration/ny-pi-core/09 §2.4): compares two different arms. arm_version and
overlay_sha stop blocking; model and jobs still do; the verdict.json records which keys were ignored."""

import json
from pathlib import Path

from bench import gate as bg
from bench import run as rb
from bench import stats
from bench.tests.helpers import MP
from bench.tests.test_rounds import mk, tasks, write_round


def rounds(tmp: Path, cost: float = 1.0, **cand_meta: object) -> tuple[Path, Path]:
    base = write_round(
        tmp / "b", tasks(10), arm="ny-pi-pi160", arm_version="1.6.0", overlay_sha="aaa"
    )
    cand = write_round(
        tmp / "c",
        [mk(f"t{i}", r, True, cost=cost) for i in range(10) for r in range(2)],
        **{"arm": "nycode", "arm_version": "0.1.0", "overlay_sha": "bbb", **cand_meta},
    )  # fmt: skip
    return base, cand


def test_strict_gate_refuses_different_arm_versions(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    v, _md, code = bg.gate(*rounds(tmp_path))
    assert v["verdict"] == "NOT_COMPARABLE" and code == 4


def test_parity_ignores_arm_version_and_overlay_sha(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    v, _md, code = bg.gate(*rounds(tmp_path), parity=True)
    assert v["verdict"] == "PASS" and code == 0
    assert v["parity"] == {
        "ignored_meta": ["arm_version", "overlay_sha"],
        "cost_max": 1.10,
    }


def test_parity_still_refuses_another_model_or_jobs(
    tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    for meta in ({"model": "other"}, {"jobs": 2}):
        v, _md, code = bg.gate(
            *rounds(tmp_path / next(iter(meta)), **meta), parity=True
        )
        assert v["verdict"] == "NOT_COMPARABLE" and code == 4, meta


def test_parity_cost_margin_is_1_10(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    v, _md, _ = bg.gate(*rounds(tmp_path / "ok", cost=1.09), parity=True)
    assert v["rules"]["cost"] == "PASS"
    v, _md, code = bg.gate(*rounds(tmp_path / "bad", cost=1.2), parity=True)
    assert v["rules"]["cost"] == "FAIL" and v["verdict"] == "FAIL" and code == 1


def test_cli_parity_writes_verdict_json(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setattr(bg, "changed_paths", lambda *_: [])
    base, cand = rounds(tmp_path)
    assert rb.main(["gate", "--base", str(base), "--cand", str(cand)]) == 4
    assert "parity" not in json.loads((cand / "verdict.json").read_text())
    assert rb.main(["gate", "--base", str(base), "--cand", str(cand), "--parity"]) == 0
    assert json.loads((cand / "verdict.json").read_text())["parity"][
        "ignored_meta"
    ] == list(stats.PARITY_IGNORED_META)
