"""bench/harbor/bundle.sh on a fake checkout and a fake arm stage: what the tarball holds, and what stops it."""

import subprocess
import tarfile
from pathlib import Path

from bench.tests.helpers import BENCH

BUNDLE_SH = BENCH / "harbor/bundle.sh"


def _fixture(tmp: Path) -> tuple[Path, Path]:
    """(repo, stage): a built checkout and a stage whose agent dir also holds files that must never ship."""
    pkg = tmp / "repo/packages/coding-agent"
    for d in (
        "dist/bundle/chunks",
        "dist/modes/interactive/theme",
        "dist/modes/interactive/assets",
        "dist/core/export-html",
        "dist/cli.js.map.d",  # tsc output that the bundle does not need
        "docs",
        "examples",
    ):
        (pkg / d).mkdir(parents=True)
    (pkg / "dist/bundle/cli.js").write_text("#!/usr/bin/env node\n")
    (pkg / "dist/bundle/chunks/a.js").write_text("a")
    (pkg / "dist/modes/interactive/theme/dark.json").write_text("{}")
    (pkg / "dist/modes/interactive/assets/x.png").write_text("p")
    (pkg / "dist/core/export-html/template.html").write_text("<html>")
    for f in (
        "package.json",
        "README.md",
        "CHANGELOG.md",
        "docs/a.md",
        "examples/e.ts",
    ):
        (pkg / f).write_text("x")
    for m in ("jiti", "@silvia-odwyer/photon-node", "chalk"):
        (tmp / "repo/node_modules" / m).mkdir(parents=True)
        (tmp / "repo/node_modules" / m / "package.json").write_text("{}")
    agent = tmp / "stage/.nycode/agent"
    (agent / "sessions").mkdir(parents=True)
    for f in (
        "settings.json",
        "AGENTS.md",
        "auth.json",
        "models.json",
        "sessions/s.jsonl",
        ".env",
    ):
        (agent / f).write_text("secret-ish")
    return tmp / "repo", tmp / "stage"


def _bundle(repo: Path, stage: Path, out: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(BUNDLE_SH), str(out)],
        env={"PATH": "/usr/bin:/bin", "HOME": str(stage), "NYCODE_REPO": str(repo)},
        capture_output=True, text=True, check=False,
    )  # fmt: skip


def test_bundle_holds_the_build_runtime_and_only_the_owner_layer(
    tmp_path: Path,
) -> None:
    repo, stage = _fixture(tmp_path)
    out = tmp_path / "b.tgz"
    r = _bundle(repo, stage, out)
    assert r.returncode == 0, r.stderr
    with tarfile.open(out) as t:
        names = set(t.getnames())
    assert {".nycode/agent/settings.json", ".nycode/agent/AGENTS.md"} <= names
    assert {
        ".local/lib/nycode/package.json",
        ".local/lib/nycode/dist/bundle/cli.js",
        ".local/lib/nycode/dist/bundle/chunks/a.js",
        ".local/lib/nycode/dist/modes/interactive/theme/dark.json",
        ".local/lib/nycode/dist/modes/interactive/assets/x.png",
        ".local/lib/nycode/dist/core/export-html/template.html",
        ".local/lib/nycode/docs/a.md",
        ".local/lib/nycode/node_modules/jiti/package.json",
        ".local/lib/nycode/node_modules/@silvia-odwyer/photon-node/package.json",
    } <= names
    # nothing else from the stage (credentials, sessions, dotenv) and no unrelated runtime package
    assert not [
        n
        for n in names
        if "auth.json" in n or "models.json" in n or "sessions" in n or ".env" in n
    ]
    assert not [
        n
        for n in names
        if "node_modules/chalk" in n or n.startswith(".local/lib/nycode/dist/cli")
    ]
    assert "bundle ok" in r.stdout


def test_bundle_refuses_an_unbuilt_checkout(tmp_path: Path) -> None:
    repo, stage = _fixture(tmp_path)
    (repo / "packages/coding-agent/dist/bundle/cli.js").unlink()
    r = _bundle(repo, stage, tmp_path / "b.tgz")
    assert r.returncode == 1 and "npm run build" in r.stderr
    assert not (tmp_path / "b.tgz").exists()


def test_bundle_refuses_missing_runtime_package_and_stage(tmp_path: Path) -> None:
    repo, stage = _fixture(tmp_path)
    (repo / "node_modules/jiti/package.json").unlink()
    (repo / "node_modules/jiti").rmdir()
    r = _bundle(repo, stage, tmp_path / "b.tgz")
    assert r.returncode == 1 and "jiti missing" in r.stderr
    repo2, _ = _fixture(tmp_path / "two")
    r = _bundle(repo2, tmp_path / "no-stage", tmp_path / "c.tgz")
    assert r.returncode == 1 and "owner layer missing" in r.stderr


def test_bundle_asserts_no_credential_path_even_inside_copied_trees(
    tmp_path: Path,
) -> None:
    repo, stage = _fixture(tmp_path)
    (repo / "packages/coding-agent/docs/auth.json").write_text("{}")
    out = tmp_path / "b.tgz"
    r = _bundle(repo, stage, out)
    assert r.returncode == 1 and "BUNDLE ASSERT FAILED" in r.stderr
    assert "auth.json" in r.stderr
