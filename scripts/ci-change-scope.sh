#!/usr/bin/env bash
# Decide se um gate caro observa uma mudanca. O workflow usa este contrato para
# manter o job presente, mas pular a medicao quando ela nao acrescenta sinal.

set -euo pipefail

scope_needs_run() { # scope_needs_run <escopo>, caminhos via stdin
	local scope="$1" path
	while IFS= read -r path; do
		case "${scope}:${path}" in
		perf:crates/* | perf:Cargo.toml | perf:Cargo.lock | perf:scripts/perf-gate.sh | perf:scripts/perf-gate-test.sh)
			return 0
			;;
		parity:crates/* | parity:Cargo.toml | parity:Cargo.lock | parity:scripts/parity-* | parity:tests/*)
			return 0
			;;
		docker:Dockerfile | docker:.dockerignore | docker:Cargo.toml | docker:Cargo.lock | docker:crates/* | docker:scripts/artifact/* | docker:scripts/artifact-vex.txt)
			return 0
			;;
		dependency-age:Cargo.lock)
			return 0
			;;
		rust:crates/* | rust:Cargo.toml | rust:Cargo.lock)
			return 0
			;;
		supply-chain:Cargo.toml | supply-chain:Cargo.lock)
			return 0
			;;
		layout:crates/* | layout:Cargo.toml | layout:Cargo.lock | layout:scripts/* | layout:.githooks/* | layout:.github/* | layout:test_map)
			return 0
			;;
		default-build:crates/* | default-build:Cargo.toml | default-build:Cargo.lock)
			return 0
			;;
		esac
	done
	return 1
}

main() {
	if (($# != 3)); then
		echo "uso: scripts/ci-change-scope.sh <base> <head> <escopo>" >&2
		exit 2
	fi

	local base="$1" head="$2" scope="$3"
	git diff --name-only "${base}" "${head}" | scope_needs_run "${scope}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi
