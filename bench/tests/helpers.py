"""Shared fakes and builders for the bench orchestrator tests."""

import json
import stat
from pathlib import Path
from typing import Any

import pytest

MP = pytest.MonkeyPatch
CF = pytest.CaptureFixture[str]


def RA(arm: str, *extra: str, tier: str = "pr", budget: str = "1") -> list[str]:
    head = f"run --arm {arm} --tier {tier} --model m --budget-usd {budget}"
    return [*head.split(), *extra]


BENCH = Path(__file__).resolve().parent.parent


def script(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


CC_ARM = """
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
case "${FAKE_MODE:-edit}" in
  edit) echo changed > out.txt ;;
  sleep) sleep 5 ;;
esac
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Task"}]}}'
echo '{"type":"result","total_cost_usd":0.4,"result":"'"${FAKE_FINAL:-done}"'","is_error":false}'
"""

PI_ARM = """
[ "$1" = "--version" ] && { echo "fakepi 1.0"; exit 0; }
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"toolCall","name":"subagent"}],"usage":{"cost":{"total":0.01}}}}'
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Which file do you mean?"}],"usage":{"cost":{"total":0.02}}}}'
"""


def make_case(root: Path, cid: str, **kw: Any) -> dict[str, Any]:
    d = root / cid
    (d / "repo").mkdir(parents=True)
    (d / "repo" / "a.txt").write_text("x")
    (d / "hidden").mkdir()
    (d / "hidden" / "hidden.txt").write_text("h")
    case = {
        "id": cid, "suite": "plan", "kind": "outcome", "prompt": "do it", "timeout_s": 3,
        "budget_usd": 1.0, "split": "dev", "security": False,
        "test_cmd": "test -f hidden/hidden.txt && test -f out.txt", "ask_terms": ["file"],
    } | kw  # fmt: skip
    (d / "case.json").write_text(json.dumps(case))
    return case | {"_dir": str(d)}


def s1_line(
    cid: str, rep: int, passed: bool, suite: str = "quality", delegated: bool = False
) -> str:
    return json.dumps(
        {
            "case_id": cid, "suite": suite, "rep": rep, "wall_s": 9.9, "split": "heldout",
            "score": {"passed": passed, "delegated": delegated},
            "trace": {"result": {"cost_usd": 0.05}},
        }
    )  # fmt: skip
