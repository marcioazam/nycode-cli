"""bundle.sh: links out of the bundle (a --link install points into the repo) become files; links inside it stay."""

import subprocess
import tarfile
from pathlib import Path

BUNDLE_SH = (
    Path(__file__).resolve().parents[2] / "claude-home/bin/evals/harbor/bundle.sh"
)


def test_bundle_dereferences_linked_install(tmp_path: Path) -> None:
    src = tmp_path / "repo"
    (src / "extensions").mkdir(parents=True)
    (src / "extensions/a.ts").write_text("x")
    (src / "pi").write_text("#!/bin/sh\n")
    home = tmp_path / "home"
    (home / ".pi/agent/extensions").mkdir(parents=True)
    (home / ".local/bin").mkdir(parents=True)
    (home / ".pi/agent/extensions/a.ts").symlink_to(src / "extensions/a.ts")
    (home / ".local/bin/pi").symlink_to(src / "pi")
    # npm's .bin entries are relative links whose script requires siblings: they must stay links.
    nm = home / ".pi/agent/node_modules"
    (nm / "pkg/dist").mkdir(parents=True)
    (nm / "pkg/dist/cli.js").write_text("require('./lib')")
    (nm / ".bin").mkdir()
    (nm / ".bin/pkg").symlink_to("../pkg/dist/cli.js")
    out = tmp_path / "b.tgz"
    subprocess.run(
        ["bash", str(BUNDLE_SH), str(out)],
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        check=True,
        capture_output=True,
    )
    with tarfile.open(out) as t:
        links = {m.name: m.linkname for m in t if m.issym()}
        names = t.getnames()
    assert ".local/bin/pi" in names and ".pi/agent/extensions/a.ts" in names
    assert links == {".pi/agent/node_modules/.bin/pkg": "../pkg/dist/cli.js"}
