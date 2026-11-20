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
- ny-pi ships a general coding core ([`docs/specs/0005-core-scope.md`](docs/specs/0005-core-scope.md)). A skill,
  agent, extension, hook, command or plugin is `core` only when it serves coding in any language, project type and
  domain, works with the shipped tools and the model provider alone (no specific MCP, SaaS, account or personal
  setup), is not a personal preference, and passed the cost × benefit rule against Claude Code and plain pi.
  Terminal-only pieces are `ui`; everything else is `optional` (kept out of the model's context by default) or does
  not enter the repository (narrow domains such as marketing, visual design or one cloud). Every shipped piece is
  listed with its class in that spec: `python3 scripts/ci/lint/core_scope.py` must exit 0.
- Text for the model follows [`docs/specs/0006-instruction-format.md`](docs/specs/0006-instruction-format.md):
  Markdown for instructions and skills, an XML tag around pasted material (documents, logs, examples, inputs) with long
  material before the task, JSON only where code parses it, and no format migration without the gate.
- First-party code files stay under 800 lines, at most 7 code files per directory.
- Bumping pi or pi-code means updating the pins in `scripts/install-lib.sh`, `npm/`, `bin/pi` and re-verifying the patches.
- Claims in the README and in pull request descriptions follow the honesty rule of the README ("How to read this
  README"): every number points to a measurement in this repository with its sample size and interval; a loss is
  written next to the win it offsets; an interval that crosses zero is "not shown", never a win; what was not
  measured is called unmeasured; a newer measurement replaces the old number. A change that makes ny-pi worse
  somewhere updates "Where ny-pi wins and where it loses" in the same pull request.
