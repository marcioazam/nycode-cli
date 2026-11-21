"""The migration map generator (docs/migration/ny-pi-core/anexos/gerar-mapa.py): overrides, rules, TSV and summary."""

import importlib.util
import io
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[3]
    / "docs/migration/ny-pi-core/anexos/gerar-mapa.py"
)


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("gerar_mapa", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(
    monkeypatch: pytest.MonkeyPatch, paths: list[str], *args: str
) -> tuple[int, ModuleType]:
    module = load()
    monkeypatch.setattr(sys, "argv", ["gerar-mapa", *args])
    monkeypatch.setattr(sys, "stdin", io.StringIO("\n".join(paths) + "\n\n"))
    return module.main(), module


def test_override_wins_over_the_rule_that_would_match() -> None:
    module = load()
    compiled = [
        (rid, module.re.compile(rx), dest, act, ph)
        for rid, rx, dest, act, ph in module.RULES
    ]
    assert module.classify("scripts/test_check_refs.py", compiled) == (
        "scripts/test_check_refs.py",
        "converter",
        "F3",
        "C07",
    )
    # replay.test.ts is a removal: it only reverts and reapplies the patch stack
    replay = "claude-home/patches/pi-code/zzzzzzz-subagent-model-effort/replay.test.ts"
    assert module.classify(replay, compiled) == (
        "(sem pilha de patches)",
        "remover",
        "F6",
        "P16",
    )


def test_x01_removes_the_tests_of_code_that_stays_in_import_until_f12() -> None:
    module = load()
    compiled = [
        (rid, module.re.compile(rx), dest, act, ph)
        for rid, rx, dest, act, ph in module.RULES
    ]
    for path in (
        "claude-home/bin/structure/test_structure.py",
        "claude-home/bin/evals/test_plan_ab.py",
        "claude-home/bin/evals/harbor/tests/test_pi_harness_agent.py",
        "claude-home/bin/evals/harbor/tests/test_pi_vanilla_api_agent.py",
    ):
        row = module.classify(path, compiled)
        assert row and row[1:] == ("remover", "F3", "X01")
    # the code itself keeps its conversion rule
    row = module.classify("claude-home/bin/structure/structure.py", compiled)
    assert row and row[3] == "C09"
    assert module.classify("no/such/rule.xyz", compiled) is None


def test_main_prints_the_tsv_and_fails_on_a_path_without_rule(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _ = run(monkeypatch, ["README.md", "no/such/rule.xyz"])
    out = capsys.readouterr()
    assert code == 1
    assert out.out.splitlines() == [
        "origem\tdestino\tacao\tfase\tregra",
        "README.md\tREADME.md\tfundir\tF2\tG01",
    ]
    assert "SEM REGRA: no/such/rule.xyz" in out.err


def test_resumo_counts_per_rule_and_per_phase(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths = ["README.md", "CODE_OF_CONDUCT.md", "SUPPORT.md", "LICENSE"]
    code, _ = run(monkeypatch, paths, "--resumo", "abc1234")
    lines = capsys.readouterr().out.splitlines()
    assert code == 0
    assert lines[0].startswith("<!-- Gerado por gerar-mapa.py")
    assert "abc1234 (4 arquivos)" in lines[0]
    assert (
        "| G03 | 2 | `^(CODE_OF_CONDUCT\\|SUPPORT)\\.md$` | `$1.md` | mover | F2 |"
        in lines
    )
    assert "| F2 | 2 | 0 | 1 | 0 | 1 | 4 |" in lines
    assert lines[-1] == "| **Total** | 2 | 0 | 1 | 0 | 1 | **4** |"
