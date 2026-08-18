#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/contract/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

check() {
  local want="$1" desc="$2"
  shift 2
  local output status=0
  output="$(bash "${GATE}" "$@" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

box="$(mktemp -d "${WORK}/ok.XXXXXX")"
mkdir -p "${box}/pass" "${box}/fail"
cp "${ROOT}/contracts/cli/"*.schema.json "${box}/"
cat >"${box}/pass/event-text-extra.json" <<'JSON'
{"type":"text","text":"oi","trace_id":"opt"}
JSON
cat >"${box}/pass/argv-extra.json" <<'JSON'
{"bin":"nycode","prompt":"oi","trace_id":"opt"}
JSON
cat >"${box}/fail/event-missing-type.json" <<'JSON'
{"text":"oi"}
JSON
cat >"${box}/fail/argv-missing-bin.json" <<'JSON'
{"prompt":"oi"}
JSON
check 0 "campo opcional extra passa" "${box}" "${box}/pass" "${box}/fail"

bad="$(mktemp -d "${WORK}/bad.XXXXXX")"
mkdir -p "${bad}/pass" "${bad}/fail"
cp "${ROOT}/contracts/cli/"*.schema.json "${bad}/"
cat >"${bad}/pass/event-missing-type.json" <<'JSON'
{"text":"oi"}
JSON
check 1 "campo required ausente recusa" "${bad}" "${bad}/pass" "${bad}/fail"
check 0 "fixtures versionadas passam" "${ROOT}/contracts/cli"

if ((failed > 0)); then
  printf 'contract-gate-test: %s ok, %s falhou\n' "${passed}" "${failed}" >&2
  exit 1
fi
printf 'contract-gate-test: %s ok\n' "${passed}"
