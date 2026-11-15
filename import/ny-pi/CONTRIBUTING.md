# Contributing

- Only files listed in `publish.list` (column 2) plus the meta files allowed in `.githooks/pre-commit`
  (scripts, docs, install files, `npm/`, `patches/third-party/`, examples) can be committed.
  Enable the hook once: `git config core.hooksPath .githooks`.
- Never commit secrets, personal identifiers, sessions, `auth*.json`, `mcp.json`, `local.env`.
  `scripts/check-leaks.sh` (gitleaks, trufflehog, local identifier list) must exit 0.
- References from shipped files must resolve or be marked `(optional)`: `python3 scripts/check-refs.py`.
- Third-party components are never vendored: add or update an entry in `third-party.json` with a full
  commit SHA (or npm integrity), the license and its sha256, and `required` only when a shipped file needs it.
  Local changes to a component are a patch in `patches/third-party/<name>.patch` (`-p1`, applied fail closed).
- Installer changes: `bash scripts/test_install.sh` (offline cases) and `PI_HARNESS_E2E_NET=1 bash scripts/test_install.sh`.
- First-party code files stay under 800 lines, at most 7 code files per directory.
- Bumping pi or pi-code means updating the pins in `scripts/install-lib.sh`, `npm/`, `bin/pi` and re-verifying the patches.
- Claims in the README and in pull request descriptions follow the honesty rule of the README ("How to read this
  README"): every number points to a measurement in this repository with its sample size and interval; a loss is
  written next to the win it offsets; an interval that crosses zero is "not shown", never a win; what was not
  measured is called unmeasured; a newer measurement replaces the old number. A change that makes ny-pi worse
  somewhere updates "Where ny-pi wins and where it loses" in the same pull request.
