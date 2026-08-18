#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/parser-invariants/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

check() {
  local want="$1" desc="$2"
  shift 2
  local output status=0
  output="$("$@" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

box="$(mktemp -d "${WORK}/box.XXXXXX")"
mkdir -p "${box}/src"
printf 'fn parse(_: &str) {}\n' >"${box}/src/parse.rs"
printf 'src/parse.rs\n' >"${box}/registry.txt"

check 1 "parser no diff sem proptest recusa" \
  env PARSER_INVARIANTS_ROOT="${box}" \
  PARSER_INVARIANTS_REGISTRY="${box}/registry.txt" \
  PARSER_INVARIANTS_CHANGED=$'src/parse.rs\n' \
  bash "${GATE}"

printf 'proptest! { fn t(s in ".*") { let _ = s; } }\n' >"${box}/src/parse.rs"
check 0 "parser no diff com proptest passa" \
  env PARSER_INVARIANTS_ROOT="${box}" \
  PARSER_INVARIANTS_REGISTRY="${box}/registry.txt" \
  PARSER_INVARIANTS_CHANGED=$'src/parse.rs\n' \
  bash "${GATE}"

printf 'fn parse(_: &str) {}\n' >"${box}/src/parse.rs"
printf 'proptest! { fn t(s in ".*") { let _ = s; } }\n' >"${box}/src/parse_test.rs"
check 0 "proptest no teste irmao passa" \
  env PARSER_INVARIANTS_ROOT="${box}" \
  PARSER_INVARIANTS_REGISTRY="${box}/registry.txt" \
  PARSER_INVARIANTS_CHANGED=$'src/parse.rs\n' \
  bash "${GATE}"

check 0 "arquivo fora do registro nao taxa" \
  env PARSER_INVARIANTS_ROOT="${box}" \
  PARSER_INVARIANTS_REGISTRY="${box}/registry.txt" \
  PARSER_INVARIANTS_CHANGED=$'src/other.rs\n' \
  bash "${GATE}"

check 0 "registro versionado nao taxa o workspace fora do diff" \
  env PARSER_INVARIANTS_CHANGED=$'docs/INDEX.md\n' \
  bash "${GATE}"

if ((failed > 0)); then
  printf 'parser-invariants-gate-test: %s ok, %s falhou\n' "${passed}" "${failed}" >&2
  exit 1
fi
printf 'parser-invariants-gate-test: %s ok\n' "${passed}"
