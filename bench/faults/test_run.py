"""Runner with a fake ``pi`` arm: a shell script that talks to the fake server like a harness would."""

import json
from pathlib import Path

import classify as cl
import injector as inj
import pytest
import run

MP = pytest.MonkeyPatch


def test_run_process_ok_and_timeout(tmp_path: Path) -> None:
    rc, out, _, hung = run.run_process(["echo", "hi"], tmp_path, {}, 10)
    assert (rc, out.strip(), hung) == (0, "hi", False)
    rc, _, _, hung = run.run_process(["sleep", "30"], tmp_path, {}, 0.3)
    assert (rc, hung) == (None, True)


def fake_arm(tmp: Path, mp: MP, script: str) -> None:
    arm = tmp / "fakearm"
    arm.write_text(f"#!/usr/bin/env bash\n{script}\n", encoding="utf-8")
    arm.chmod(0o755)
    mp.setattr(run.check, "ARMS_DIR", tmp)
    mp.setattr(run, "ARMS", ("fakearm", *run.ARMS))
    mp.setattr(
        run,
        "arm_command",
        lambda arm_, sc, port, scratch, env: ([str(arm), sc, str(port)], dict(env)),
    )


CLIENT = r"""python3 - "$1" "$2" <<'PY'
import json, sys, urllib.request, urllib.error
case, port = sys.argv[1], sys.argv[2]
body = {"model": "m", "stream": True, "tools": [{"name": "read"}],
        "messages": [{"role": "user", "content": "contract-case:" + case}]}
req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/messages", json.dumps(body).encode())
try:
    data = urllib.request.urlopen(req).read().decode()
    pass
except urllib.error.HTTPError as e:
    data = ""
PY"""


def test_run_one_silent_failure_is_masked(tmp_path: Path, monkeypatch: MP) -> None:
    fake_arm(tmp_path, monkeypatch, CLIENT + "\nexit 0")
    out = run.run_one("fakearm", "overloaded", 20, {})
    assert (out.status, out.rc, out.requests, out.masked) == (cl.SILENT, 0, 1, True)


def test_run_one_ok_and_failed(tmp_path: Path, monkeypatch: MP) -> None:
    fake_arm(tmp_path, monkeypatch, f"echo {inj.FINAL}")
    assert run.run_one("fakearm", "unknown-tool", 20, {}).success
    fake_arm(tmp_path, monkeypatch, "exit 3")
    out = run.run_one("fakearm", "unknown-tool", 20, {})
    assert (out.status, out.rc) == (cl.FAILED, 3)


def test_run_one_hung(tmp_path: Path, monkeypatch: MP) -> None:
    fake_arm(tmp_path, monkeypatch, "sleep 30")
    assert run.run_one("fakearm", "overloaded", 0.5, {}).status == cl.HUNG


def test_run_one_env_error(monkeypatch: MP) -> None:
    def boom(*_: object) -> None:
        raise run.check.EnvError("sem stage")

    monkeypatch.setattr(run, "arm_command", boom)
    out = run.run_one("ny-pi", "overloaded", 5, {})
    assert out.status == cl.FAILED and "sem stage" in out.note


def test_arm_command_claude_and_vanilla(tmp_path: Path) -> None:
    cmd, env = run.arm_command(
        "claude-vanilla", "rate-limit", 123, tmp_path, {"ANTHROPIC_API_KEY": "k"}
    )
    assert cmd[1] == "-p" and "contract-case:rate-limit" in cmd[2]
    assert (
        env["ANTHROPIC_BASE_URL"] == "http://127.0.0.1:123"
        and "ANTHROPIC_API_KEY" not in env
    )
    cmd, env = run.arm_command("pi-vanilla", "overloaded", 77, tmp_path, {})
    models = json.loads((Path(env["BENCH_PI_VANILLA_DIR"]) / "models.json").read_text())
    assert models["providers"]["anthropic"]["baseUrl"].endswith(":77")


def test_arm_command_ny_pi_builds_stage(tmp_path: Path, monkeypatch: MP) -> None:
    agent = tmp_path / "stage" / ".pi" / "agent"
    agent.mkdir(parents=True)
    monkeypatch.setattr(run.check, "prepare_stage", lambda arm, stage, env: agent)
    cmd, _ = run.arm_command("ny-pi", "overloaded", 5, tmp_path, {})
    assert "--no-session" in cmd and (agent / "models.json").is_file()


def test_main_table_json_and_bad_args(
    tmp_path: Path, monkeypatch: MP, capsys: pytest.CaptureFixture[str]
) -> None:
    fake_arm(tmp_path, monkeypatch, f"echo {inj.FINAL}")
    out_file = tmp_path / "o.json"
    assert (
        run.main(
            ["--arms", "fakearm", "--scenarios", "overloaded", "--json", str(out_file)]
        )
        == 0
    )
    assert "| fakearm | overloaded | ok |" in capsys.readouterr().out
    assert json.loads(out_file.read_text())[0]["success"] is True
    assert run.main(["--arms", "nope"]) == 2
    assert run.main(["--scenarios", "nope"]) == 2
