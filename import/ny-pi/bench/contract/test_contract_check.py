"""Tests of the check CLI against a fake ``pi`` arm written in shell (no real pi, no network)."""

import json
from pathlib import Path
from typing import Any

import check
import contract_rules as cr
import pytest
import speed
from fake_api import Hit

MP = pytest.MonkeyPatch

# A stand-in for bench/arms/ny-pi: builds a stage from FAKE_TEMPLATE on --version and, for -p, talks to the
# baseUrl of the stage's models.json like pi does (one tool call per turn, tool_result sent back).
FAKE_ARM = r"""#!/usr/bin/env bash
set -euo pipefail
if [ "${FAKE_BUILD_FAILS:-}" = 1 ]; then echo "npm error offline" >&2; exit 7; fi
[ "${FAKE_NO_STAGE:-}" = 1 ] && exit 0
agent="$BENCH_STAGE/.pi/agent"
if [ "$1" = --version ]; then
  mkdir -p "$agent" && cp -r "$FAKE_TEMPLATE/." "$agent/" && echo 0.0.0
  exit 0
fi
[ "${FAKE_SILENT:-}" = 1 ] && exit 0
exec python3 - "$agent" "$@" <<'PY'
import json, os, pathlib, sys, urllib.request
agent, args = sys.argv[1], sys.argv[2:]
base = json.load(open(f"{agent}/models.json"))["providers"]["anthropic"]["baseUrl"]
fixed, plan = os.environ.get("FAKE_FIXED") == "1", "--plan" in args
names = ["Read", "plan_mode_complete"] if plan else ["Read", "Bash", "Edit", "Write", "todo", "subagent"]
if not fixed:
    names += ["Write"] if plan else ["plan_mode_complete", "question"]
schema = {"type": "object", "properties": {}, "required": []}
tools = [{"name": n, "description": n, "input_schema": schema} for n in names]
system = "pi\n<available_skills>\n<skill>\n</skill>\n</available_skills>\n<subagents>\n- A: a\n</subagents>"
messages = [{"role": "user", "content": [{"type": "text", "text": args[-1]}]}]

def execute(name, data):
    if name not in [n.lower() for n in names]:
        return "Tool not found", True
    if name == "read":
        return pathlib.Path(data["path"]).read_text(), False
    if name == "write":
        pathlib.Path(data["path"]).write_text(data["content"])
        return "Successfully wrote", False
    if name == "edit":
        path = pathlib.Path(data["path"])
        for e in data["edits"]:
            path.write_text(path.read_text().replace(e["oldText"], e["newText"]))
        return "Successfully replaced", False
    if name == "question":
        return "Error: UI not available (running in non-interactive mode)", False
    if name == "plan_mode_complete":
        return "Not in plan mode; tool ignored.", False
    return {"bash": "ok\n", "todo": "No todos"}[name], False

for _ in range(4):
    body = {"model": "fake", "stream": True, "system": system, "tools": tools, "messages": messages}
    request = urllib.request.Request(base + "/v1/messages", data=json.dumps(body).encode())
    stream = urllib.request.urlopen(request, timeout=20).read().decode()
    events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith("data: ")]
    block = next(e for e in events if e["type"] == "content_block_start")["content_block"]
    if block["type"] != "tool_use":
        break
    data = json.loads(next(e for e in events if e["type"] == "content_block_delta")["delta"]["partial_json"])
    out, err = execute(block["name"].lower(), data)
    result = {"type": "tool_result", "tool_use_id": block["id"], "content": out, "is_error": err}
    messages += [{"role": "assistant", "content": [{**block, "input": data}]}, {"role": "user", "content": [result]}]
PY
"""


@pytest.fixture
def arms(tmp_path: Path, monkeypatch: MP) -> Path:
    """A fake arms directory with arm ``fake`` and a stage template whose static cases all pass."""
    folder = tmp_path / "arms"
    folder.mkdir()
    arm = folder / "fake"
    arm.write_text(FAKE_ARM)
    arm.chmod(0o755)
    template = tmp_path / "template"
    files = {
        "extensions/a/index.ts": "pi.registerCommand('goal', {})\npi.registerCommand('plan', {})\n",
        "extensions/node_modules/dep/x.ts": "ignored",
        "claude-home/commands/subagents.md": "---\ndescription: d\n---\n",
        "claude-home/skills/s/SKILL.md": "---\nname: s\ndescription: skill s\n---\n",
        "claude-home/agents/A.md": "---\nname: A\ndescription: agent A\n---\n",
        "mcp.json": json.dumps(
            {"mcpServers": {"local": {"command": "python3", "env": {"K": "segredo"}}}}
        ),
    }
    for rel, text in files.items():
        (template / rel).parent.mkdir(parents=True, exist_ok=True)
        (template / rel).write_text(text)
    monkeypatch.setattr(check, "ARMS_DIR", folder)
    monkeypatch.setenv("FAKE_TEMPLATE", str(template))
    monkeypatch.delenv("BENCH_STAGE", raising=False)
    for name in ("FAKE_FIXED", "FAKE_SILENT", "FAKE_BUILD_FAILS", "FAKE_NO_STAGE"):
        monkeypatch.delenv(name, raising=False)
    return template


def run(tmp_path: Path, *extra: str) -> tuple[int, dict[str, Any], dict[str, str]]:
    out = tmp_path / "out.json"
    code = check.main(["--arm", "fake", "--json", str(out), *extra])
    report: dict[str, Any] = json.loads(out.read_text()) if out.exists() else {}
    return code, report, {c["name"]: c["status"] for c in report.get("cases", [])}


@pytest.mark.usefixtures("arms")
def test_known_defects_fail_the_contract(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, report, status = run(tmp_path)
    assert code == 1
    assert report["exit"] == 1
    failed = {name for name, value in status.items() if value == cr.FAIL}
    assert failed == {
        "regras/plan_mode_complete-ausente",
        "regras/question-ausente",
        "regras/sem-erro-de-interface:plan_mode_complete",
        "regras/sem-erro-de-interface:question",
        "plano/sem-escrita",
    }
    assert status["regras/sem-erro-de-interface:subagent"] == cr.SKIP
    assert [status[f"basicas/{t}"] for t in check.BASIC_TOOLS] == [cr.OK] * 5
    inventory = report["inventory"]
    assert (
        inventory["tools_count"],
        inventory["skills_listed"],
        inventory["agents_listed"],
    ) == (8, 1, 1)
    assert inventory["skills"] == {"files": 1, "description_chars": 7}
    assert set(inventory["system_sections"]) == {
        "available_skills",
        "subagents",
        cr.LOOSE,
    }
    printed = capsys.readouterr().out
    assert "falha   regras/question-ausente" in printed
    assert "segredo" not in printed + json.dumps(report)


@pytest.mark.usefixtures("arms")
def test_fixed_harness_passes(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.setenv("FAKE_FIXED", "1")
    code, report, status = run(tmp_path)
    assert (code, report["summary"][cr.FAIL]) == (0, 0)
    assert status["plano/plan_mode_complete-presente"] == cr.OK
    assert status["plano/sem-escrita"] == cr.OK
    assert status["comandos/subagents"] == cr.OK
    assert status["mcp/local"] == cr.OK


def test_static_group_needs_no_pi_run_and_reports_stage_gaps(
    arms: Path, tmp_path: Path, monkeypatch: MP
) -> None:
    monkeypatch.setenv("FAKE_SILENT", "1")
    (arms / "mcp.json").write_text("{quebrado")
    code, _, status = run(tmp_path, "--only", "mcp")
    assert (code, status) == (1, {"mcp/declarados": cr.FAIL})
    (arms / "mcp.json").unlink()
    (arms / "claude-home" / "agents" / "A.md").unlink()
    (arms / "claude-home" / "agents").rmdir()
    assert run(tmp_path, "--only", "mcp")[2] == {"mcp/declarados": cr.SKIP}
    assert run(tmp_path, "--only", "skills")[2]["skills/agente-frontmatter"] == cr.FAIL
    own = tmp_path / "meu" / "stage"
    own.parent.mkdir()
    monkeypatch.setenv("BENCH_STAGE", str(own))
    assert run(tmp_path, "--only", "comandos")[0] == 0
    assert (own / ".pi" / "agent" / "mcp.json").exists() is False
    assert (own / ".pi" / "agent" / "extensions").is_dir()


@pytest.mark.parametrize(
    ("variable", "arm", "reason"),
    [
        ("FAKE_BUILD_FAILS", "fake", "npm error offline"),
        ("FAKE_NO_STAGE", "fake", "não montou"),
        ("FAKE_SILENT", "fake", "pi não enviou pedido"),
        ("FAKE_SILENT", "ausente", "braço inexistente"),
    ],
)
@pytest.mark.usefixtures("arms")
def test_environment_problems_exit_2_with_reason(
    variable: str,
    arm: str,
    reason: str,
    monkeypatch: MP,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv(variable, "1")
    assert check.main(["--arm", arm]) == 2
    assert reason in capsys.readouterr().err


@pytest.mark.usefixtures("arms")
def test_shared_stage_is_refused(
    tmp_path: Path, monkeypatch: MP, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("BENCH_STAGE", str(tmp_path / "bench-nypi-abc"))
    assert check.main(["--arm", "fake"]) == 2
    assert "compartilhado" in capsys.readouterr().err
    assert not (tmp_path / "bench-nypi-abc").exists()


def test_clean_env_drops_session_variables(tmp_path: Path) -> None:
    environ = {
        "PATH": "/bin",
        "PI_CODE_SUBAGENT": "1",
        "CLAUDE_CONFIG_DIR": "/x",
        "ANTHROPIC_BASE_URL": "u",
        "BENCH_REPO": "x/y",
    }
    assert check.clean_env(environ, tmp_path) == {
        "PATH": "/bin",
        "BENCH_REPO": "x/y",
        "BENCH_STAGE": str(tmp_path),
        "PI_OFFLINE": "1",
    }


def test_arm_that_cannot_execute_or_times_out(tmp_path: Path, monkeypatch: MP) -> None:
    arm = tmp_path / "arm"
    arm.write_text("not executable")
    with pytest.raises(check.EnvError, match="PermissionError"):
        check.prepare_stage(arm, tmp_path / "stage", {})
    arm.write_text("#!/bin/sh\nsleep 5\n")
    arm.chmod(0o755)
    monkeypatch.setattr(check, "PI_TIMEOUT_S", 0.2)
    from fake_api import FakeApi

    with FakeApi({}) as api:
        session = check.Session(
            arm, {"PATH": "/usr/bin:/bin"}, api, {}, tmp_path / "work"
        )
        assert session.run("lento") == ([], "tempo esgotado (0.2s)")


# Fake arm for speed.py: --version makes the stage; -p sleeps BOOT, then runs the 3-turn script against the
# stage's models.json with GAP seconds of "tool time" per tool turn, and logs "NAME STAGE TMPDIR".
FAKE_SPEED_ARM = r"""#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = --version ]; then mkdir -p "$BENCH_STAGE/.pi/agent" && echo 0.0.0; exit 0; fi
echo "@NAME@ $BENCH_STAGE $TMPDIR" >> "$FAKE_LOG"
[ "@NAME@" = broken ] && exit 3
exec python3 - "$BENCH_STAGE/.pi/agent" "$@" <<'PY'
import json, sys, time, urllib.request
agent, args = sys.argv[1], sys.argv[2:]
base = json.load(open(f"{agent}/models.json"))["providers"]["anthropic"]["baseUrl"]
time.sleep(@BOOT@)
messages = [{"role": "user", "content": [{"type": "text", "text": args[-1]}]}]
for _ in range(3):
    body = {"model": "fake", "stream": True, "messages": messages}
    stream = urllib.request.urlopen(urllib.request.Request(base + "/v1/messages", data=json.dumps(body).encode())).read().decode()
    events = [json.loads(l[6:]) for l in stream.splitlines() if l.startswith("data: ")]
    block = next(e for e in events if e["type"] == "content_block_start")["content_block"]
    if block["type"] != "tool_use":
        break
    time.sleep(@GAP@)
    result = {"type": "tool_result", "tool_use_id": block["id"], "content": "ok"}
    messages += [{"role": "assistant", "content": [block]}, {"role": "user", "content": [result]}]
PY
"""


@pytest.fixture
def speed_arms(tmp_path: Path, monkeypatch: MP) -> Path:
    """Arms ``slow`` (boot 0.3 s, 0.1 s per tool turn), ``fast`` and ``broken``; returns the invocation log."""
    folder = tmp_path / "arms"
    folder.mkdir()
    for name, boot, gap in (("slow", 0.3, 0.1), ("fast", 0.0, 0.0), ("broken", 0, 0)):
        arm = folder / name
        arm.write_text(
            FAKE_SPEED_ARM.replace("@NAME@", name)
            .replace("@BOOT@", str(boot))
            .replace("@GAP@", str(gap))
        )
        arm.chmod(0o755)
    log = tmp_path / "log.txt"
    monkeypatch.setattr(check, "ARMS_DIR", folder)
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.delenv("BENCH_STAGE", raising=False)
    return log


def hit(seq: int, arrived: float, done: float, size: int = 400) -> Hit:
    return Hit(seq, "speed", seq, size, arrived, done)


def test_metrics_from_known_timestamps() -> None:
    hits = [hit(0, 10.5, 10.6), hit(1, 11.0, 11.1), hit(2, 11.7, 11.8)]
    got = speed.metrics(10.0, hits, 12.0)
    assert got == pytest.approx(
        {
            "boot_s": 0.5,
            "turn_gap_s": 0.5,  # median of 11.0-10.6 and 11.7-11.1
            "exit_s": 0.2,
            "total_s": 2.0,
            "first_request_bytes": 400,
            "first_request_tokens_est": 100,
        }
    )
    with pytest.raises(check.EnvError, match="pedidos"):
        speed.metrics(10.0, hits[:1], 12.0)


def test_metrics_use_routed_hits_only() -> None:
    aux = Hit(0, "", 0, 9999, 10.1, 10.2)
    got = speed.metrics(
        10.0, [aux, hit(1, 10.5, 10.6), hit(2, 11.0, 11.1), hit(3, 11.7, 11.8)], 12.0
    )
    assert got["boot_s"] == pytest.approx(0.5)
    assert got["first_request_bytes"] == 400


def test_metrics_reject_unfinished_hit() -> None:
    hits = [hit(0, 10.5, 10.6), hit(1, 11.0, 11.1), hit(2, 11.7, 0.0)]
    with pytest.raises(check.EnvError, match="fim de resposta"):
        speed.metrics(10.0, hits, 12.0)


def test_stats_and_paired_ratio() -> None:
    assert speed.median([3.0, 1.0, 2.0]) == 2.0
    assert speed.median([1.0, 2.0, 3.0, 10.0]) == 2.5
    assert speed.p90([float(n) for n in range(1, 11)]) == 9.0
    assert speed.paired_ratio([2.0, 4.0, 9.0], [1.0, 2.0, 3.0]) == 2.0


def test_schedule_interleaves_arms() -> None:
    assert speed.schedule(["a", "b"], 2) == [("a", 0), ("b", 0), ("a", 1), ("b", 1)]


@pytest.mark.usefixtures("speed_arms")
def test_missing_arm_and_failing_pi_exit_2(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert speed.main(["--arms", "slow,nope", "--reps", "1"]) == 2
    assert "braço inexistente: nope" in capsys.readouterr().err
    assert speed.main(["--arms", "broken", "--reps", "1"]) == 2
    assert "falhou" in capsys.readouterr().err


def test_hot_run_interleaves_and_pairs(
    tmp_path: Path, speed_arms: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "speed.json"
    assert speed.main(["--arms", "slow,fast", "--reps", "2", "--json", str(out)]) == 0
    lines = [line.split() for line in speed_arms.read_text().splitlines()]
    # one unreported warm-up round, then the reported reps, always alternating
    assert [line[0] for line in lines] == ["slow", "fast"] * 3
    assert len({line[1] for line in lines if line[0] == "slow"}) == 1  # hot: same stage
    report = json.loads(out.read_text())
    assert len(report["runs"]["slow"]) == len(report["runs"]["fast"]) == 2
    slow, fast = report["summary"]["slow"], report["summary"]["fast"]
    assert slow["boot_s"]["median"] > fast["boot_s"]["median"] + 0.2
    assert slow["turn_gap_s"]["median"] > fast["turn_gap_s"]["median"] + 0.05
    assert report["ratio"]["fast"]["boot_s"] > 1.5
    assert "boot_s" in capsys.readouterr().out


def test_cold_uses_fresh_stage_and_cache_per_run(
    tmp_path: Path, speed_arms: Path
) -> None:
    assert speed.main(["--arms", "fast", "--reps", "2", "--cold"]) == 0
    lines = [line.split() for line in speed_arms.read_text().splitlines()]
    assert len(lines) == 2  # no warm-up when cold
    assert lines[0][1] != lines[1][1]
    assert lines[0][2] != lines[1][2]
    assert not Path(lines[0][1]).exists()
