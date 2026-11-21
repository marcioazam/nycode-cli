"""Arms `nycode` (09 §2.2) and `ny-pi-pi160` (D-25): definition, dry-run, stage lookup and the arm scripts. No
network, no spend: the stage is pre-built (`.ready`) and the binary is a fake."""

import json
import shutil
import subprocess
from pathlib import Path

from bench import run as rb
from bench.tests.helpers import BENCH, CF, MP, RA, script

NODE = shutil.which("node") or "/usr/bin/node"  # the arm writes mcp.json with node

FAKE_BIN = """
echo "HOME=$HOME"
echo "NYCODE_CODING_AGENT_DIR=$NYCODE_CODING_AGENT_DIR"
echo "NYCODE_SKIP_VERSION_CHECK=${NYCODE_SKIP_VERSION_CHECK:-}"
env | grep -E '^(ANTHROPIC_|CLAUDE_CODE_OAUTH)' | sort
for a in "$@"; do echo "ARG:$a"; done
"""


def arms() -> dict[str, dict[str, object]]:
    return rb.load_toml(BENCH / "arms.toml")


def test_nycode_arm_definition() -> None:
    a = arms()["nycode"]
    assert a["runner"] == "run_pi.py" and a["bin"] == "arms/nycode"
    assert a["stage_prefix"] == "bench-nycode"
    assert (BENCH / "arms/nycode").stat().st_mode & 0o111


def test_pi160_arm_is_the_ny_pi_bin_on_pi_1_6_0() -> None:
    a, base = arms()["ny-pi-pi160"], arms()["ny-pi"]
    assert a["bin"] == base["bin"] and a["runner"] == base["runner"]
    assert a["version"] == "1.6.0"
    assert a["env"] == {"BENCH_PI_VERSION": "1.6.0"}
    assert (
        a["stage_prefix"] == "bench-nypi160"
    )  # never shares a stage with the 1.5.2 arm


def test_dry_run_nycode_smoke_and_pi160_pr(monkeypatch: MP, capsys: CF) -> None:
    for k in ("BENCH_PI_VERSION", "BENCH_STAGE_PREFIX"):
        monkeypatch.setenv(k, "restored-by-monkeypatch")
    assert rb.main(RA("nycode", "--dry-run", tier="smoke", budget="12")) == 0
    out = capsys.readouterr().out
    assert "arm=nycode tier=pr" in out and "nothing was executed" in out
    assert rb.main(RA("ny-pi-pi160", "--dry-run", tier="pr", budget="12")) == 0
    out = capsys.readouterr().out
    assert "arm=ny-pi-pi160 tier=pr" in out and "nothing was executed" in out
    # the arm's env table reaches the arm script and its children
    import os

    assert os.environ["BENCH_PI_VERSION"] == "1.6.0"
    assert os.environ["BENCH_STAGE_PREFIX"] == "bench-nypi160"


def test_arm_meta_reads_overlay_sha_of_the_nycode_stage(
    tmp_path: Path, monkeypatch: MP
) -> None:
    for name, sha in (
        ("bench-nycode-abc123def456", "n1"),
        ("bench-nypi-abc123def456-dirty", "p1"),
    ):
        d = tmp_path / name
        d.mkdir()
        (d / ".overlay-sha").write_text(sha + "\n")
        (d / ".ready").touch()
    monkeypatch.setenv("BENCH_STAGE_ROOT", str(tmp_path))
    monkeypatch.delenv("BENCH_STAGE", raising=False)
    monkeypatch.setattr("bench.run.subprocess.run", lambda *a, **k: subprocess.CompletedProcess(a, 0, "abc123def456\n", ""))  # fmt: skip
    meta = rb.arm_meta("nycode", arms(), "pi", Path("/x/bin"), "m", 1.0)
    assert meta["overlay_sha"] == "n1"
    assert (
        rb.arm_meta("ny-pi", arms(), "pi", Path("/x/bin"), "m", 1.0)["overlay_sha"]
        == "p1"
    )


def run_arm(tmp: Path, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    stage = tmp / "stage"
    stage.mkdir(exist_ok=True)
    (stage / ".ready").touch()
    creds = tmp / "cred.json"
    creds.write_text(
        '{"claudeAiOauth":{"accessToken":"oauth-fake","expiresAt":99999999999999}}'
    )
    key = tmp / "key"
    key.write_text("sk-ant-fake\n")
    fake = script(tmp / "fake", FAKE_BIN)
    base = {
        "PATH": f"/usr/bin:/bin:{Path(NODE).parent}",
        "BENCH_STAGE": str(stage),
        "BENCH_NYCODE_BIN": str(fake),
        "BENCH_CC_CREDENTIALS": str(creds),
        "BENCH_REAL_HOME": str(tmp / "rh"),
        "BENCH_KEY": str(key),
    }
    return subprocess.run(
        ["bash", str(BENCH / "arms/nycode"), *args],
        env={**base, **env}, capture_output=True, text=True, check=False,
    )  # fmt: skip


def test_arm_runs_the_binary_in_a_throwaway_home(tmp_path: Path) -> None:
    p = run_arm(tmp_path, "-p", "hello")
    stage = tmp_path / "stage"
    assert p.returncode == 0, p.stderr
    assert f"HOME={stage}" in p.stdout
    assert f"NYCODE_CODING_AGENT_DIR={stage}/.nycode/agent" in p.stdout
    assert "NYCODE_SKIP_VERSION_CHECK=1" in p.stdout
    assert "ANTHROPIC_OAUTH_TOKEN=oauth-fake" in p.stdout
    assert "ARG:-p" in p.stdout and "ARG:hello" in p.stdout


def test_arm_drops_flags_only_pi_code_understood(tmp_path: Path) -> None:
    p = run_arm(
        tmp_path, "--settings", "s.json", "--mcp-config=m.json", "--strict-mcp-config",
        "--setting-sources", "user", "--add-dir", "d", "-p", "hi",
    )  # fmt: skip
    args = [ln for ln in p.stdout.splitlines() if ln.startswith("ARG:")]
    assert args == ["ARG:-p", "ARG:hi"], p.stderr


def test_arm_api_key_mode(tmp_path: Path) -> None:
    p = run_arm(
        tmp_path, "x", BENCH_API_KEY_FILE=str(tmp_path / "key"), BENCH_ANTHROPIC_WORKSPACE_ID="wrk_1",
        ANTHROPIC_OAUTH_TOKEN="leak",
    )  # fmt: skip
    assert "ANTHROPIC_API_KEY=sk-ant-fake" in p.stdout and "OAUTH" not in p.stdout
    models = (tmp_path / "stage/.nycode/agent/models.json").read_text()
    assert "wrk_1" in models


def test_arm_writes_a_secret_free_disabled_mcp_json(tmp_path: Path) -> None:
    """The stage gets the repo example with every server disabled: nothing starts, nothing reaches the network."""
    assert run_arm(tmp_path, "-p", "x", ANTHROPIC_API_KEY="leak").returncode == 0
    written = (tmp_path / "stage/.nycode/agent/mcp.json").read_text()
    example = json.loads(
        (BENCH.parent / "packages/coding-agent/examples/config/mcp.json").read_text()
    )
    servers = json.loads(written)["mcpServers"]
    assert servers.keys() == example["mcpServers"].keys() and servers
    assert all(s["enabled"] is False for s in servers.values())
    assert "leak" not in written
    (tmp_path / "stage/.nycode/agent/mcp.json").write_text(
        "{}"
    )  # an existing file is kept
    run_arm(tmp_path, "-p", "x")
    assert (tmp_path / "stage/.nycode/agent/mcp.json").read_text() == "{}"


def test_arm_builds_with_the_ci_commands() -> None:
    text = (BENCH / "arms/nycode").read_text()
    assert "npm ci --ignore-scripts" in text and "npm run build" in text
    assert "packages/coding-agent/dist/bundle/cli.js" in text
    assert "install.sh" not in text and "PI_CODING_AGENT_DIR" not in text.replace("NYCODE_CODING_AGENT_DIR", "")  # fmt: skip
    assert "bench-nycode-" in text


def test_pi160_stage_needs_a_pi_1_6_0_install(tmp_path: Path) -> None:
    """The 1.5.2 install of ~/.pi must never stand in for 1.6.0 (the arm would measure the wrong base)."""
    rh = tmp_path / "rh/.pi/agent/install"
    rh.mkdir(parents=True)
    (rh / "current-version").write_text("1.5.2\n")
    src = fake_nypi_tree(tmp_path)
    p = subprocess.run(
        ["bash", str(BENCH / "arms/ny-pi")],
        env={
            "PATH": "/usr/bin:/bin", "BENCH_PI_VERSION": "1.6.0", "BENCH_STAGE": str(tmp_path / "stage"),
            "BENCH_NYPI_SRC": str(src),
            "BENCH_REAL_HOME": str(tmp_path / "rh"), "BENCH_CC_CREDENTIALS": "/dev/null",
        },
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert p.returncode == 2 and "pi 1.6.0" in p.stderr and "1.5.2" in p.stderr
    assert not (tmp_path / "stage/.ready").exists()


def fake_nypi_tree(tmp: Path) -> Path:
    """An external ny-pi tree reduced to what the arm checks before it builds: install.sh and bin/pi."""
    src = tmp / "nypi-src"
    (src / "bin").mkdir(parents=True)
    (src / "install.sh").write_text("#!/bin/sh\n")
    (src / "bin/pi").write_text("#!/bin/sh\n")
    return src


def test_ny_pi_arm_needs_a_tree_with_bin_pi(tmp_path: Path) -> None:
    """import/ny-pi has no bin/pi since F5: the arm says so and names BENCH_NYPI_SRC instead of exiting 127 later."""
    (tmp_path / "bare").mkdir()
    for extra in ({}, {"BENCH_NYPI_SRC": str(tmp_path / "bare")}):
        p = subprocess.run(
            ["bash", str(BENCH / "arms/ny-pi")],
            env={"PATH": "/usr/bin:/bin", "BENCH_STAGE": str(tmp_path / "stage"), "BENCH_REAL_HOME": str(tmp_path), "BENCH_CC_CREDENTIALS": "/dev/null", **extra},
            capture_output=True, text=True, check=False,
        )  # fmt: skip
        assert p.returncode == 2 and "BENCH_NYPI_SRC" in p.stderr
    assert not (tmp_path / "stage").exists()


def test_ny_pi_arm_builds_its_stage_from_bench_nypi_src(tmp_path: Path) -> None:
    """With BENCH_NYPI_SRC the arm uses that tree's install.sh and npm/ (a fake tree records the call)."""
    src = fake_nypi_tree(tmp_path)
    (src / "npm").mkdir()
    (src / "npm/package.json").write_text("{}")
    (src / "npm/package-lock.json").write_text("{}")
    (src / "install.sh").write_text('#!/bin/sh\necho "$0" >"$HOME/installed-from"\nmkdir -p "$HOME/.local/bin"\nprintf "#!/bin/sh\\necho PI\\n" >"$HOME/.local/bin/pi"\nchmod +x "$HOME/.local/bin/pi"\n')  # fmt: skip
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    script(fakebin / "npm", "exit 0")
    rh = tmp_path / "rh"
    (rh / ".pi/agent/install").mkdir(parents=True)
    (rh / ".pi/agent/bin").mkdir()
    creds = tmp_path / "cred.json"
    creds.write_text(
        '{"claudeAiOauth":{"accessToken":"oauth-fake","expiresAt":99999999999999}}'
    )
    p = subprocess.run(
        ["bash", str(BENCH / "arms/ny-pi")],
        env={
            "PATH": f"{fakebin}:/usr/bin:/bin", "BENCH_NYPI_SRC": str(src), "BENCH_STAGE": str(tmp_path / "stage"),
            "BENCH_REAL_HOME": str(rh), "BENCH_CC_CREDENTIALS": str(creds), "BENCH_OVERLAY_DIR": str(tmp_path),
        },
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert p.returncode == 0, p.stderr
    assert (tmp_path / "stage/installed-from").read_text().strip() == str(
        src / "install.sh"
    )
    assert (tmp_path / "stage/.ready").exists()


def test_ny_pi_arm_runs_a_built_stage_without_the_tree(tmp_path: Path) -> None:
    """BENCH_NYPI_SRC is needed to build the stage only; a stage marked .ready runs with the default tree."""
    stage = tmp_path / "stage"
    (stage / ".local/bin").mkdir(parents=True)
    script(stage / ".local/bin/pi", 'echo "ran:$*"')
    (stage / ".ready").touch()
    creds = tmp_path / "cred.json"
    creds.write_text(
        '{"claudeAiOauth":{"accessToken":"oauth-fake","expiresAt":99999999999999}}'
    )
    p = subprocess.run(
        ["bash", str(BENCH / "arms/ny-pi"), "-p", "x"],
        env={"PATH": "/usr/bin:/bin", "BENCH_STAGE": str(stage), "BENCH_REAL_HOME": str(tmp_path), "BENCH_CC_CREDENTIALS": str(creds)},
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert p.returncode == 0 and p.stdout.strip() == "ran:-p x", p.stderr
