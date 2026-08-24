#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

source "${ROOT}/scripts/ci-change-scope.sh"

assert_scope() { # assert_scope <esperado> <escopo> <caminhos>
	local expected="$1" scope="$2" paths="$3" actual
	if scope_needs_run "${scope}" <<<"${paths}"; then
		actual=true
	else
		actual=false
	fi
	if [[ "${actual}" != "${expected}" ]]; then
		echo "ci-change-scope-test: ${scope} esperava ${expected}; recebeu ${actual}." >&2
		exit 1
	fi
}

assert_scope true perf $'crates/nycode-agent/src/lib.rs\nREADME.md'
assert_scope true parity $'crates/nycode-cli/src/main.rs'
assert_scope true docker $'Dockerfile'
assert_scope true dependency-age $'Cargo.lock'
assert_scope true rust $'crates/nycode-agent/src/lib.rs'
assert_scope true supply-chain $'Cargo.toml'
assert_scope true layout $'.githooks/pre-push'
assert_scope true layout $'.github/workflows/ci.yml'
assert_scope true default-build $'crates/nycode-auth/src/subscription.rs'
assert_scope false perf $'README.md\ndocs/RUNBOOK.md'
assert_scope false parity $'docs/architecture/decisions/0041.md'
assert_scope false docker $'.github/workflows/ci.yml'
assert_scope false dependency-age $'Cargo.toml'
assert_scope false rust $'docs/RUNBOOK.md'
assert_scope false supply-chain $'crates/nycode-agent/src/lib.rs'
assert_scope false layout $'docs/RUNBOOK.md'
assert_scope false default-build $'docs/architecture/decisions/0042.md'

echo "ci-change-scope-test: todos os escopos passaram."
