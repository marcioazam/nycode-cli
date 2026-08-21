#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/metrics/gate.sh"

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

pass="$(mktemp -d "${WORK}/pass.XXXXXX")"
fail="$(mktemp -d "${WORK}/fail.XXXXXX")"
cat >"${pass}/ok.json" <<'JSON'
{"attribution":"Assisted-by","origin":{"human":{"merged_prs":2,"lead_time_hours":10},"agent":{"merged_prs":1,"lead_time_hours":8}}}
JSON
cat >"${fail}/no-split.json" <<'JSON'
{"merged_prs":3,"lead_time_hours":9}
JSON
check 0 "split Assisted-by vs humano passa" "${pass}" "${fail}"

bad_split="$(mktemp -d "${WORK}/bad-split.XXXXXX")"
mkdir -p "${bad_split}"
cat >"${bad_split}/no-split.json" <<'JSON'
{"merged_prs":3}
JSON
check 1 "sem split humano/agente recusa" "${bad_split}" "${fail}"

bad_loc="$(mktemp -d "${WORK}/bad-loc.XXXXXX")"
mkdir -p "${bad_loc}"
cat >"${bad_loc}/loc.json" <<'JSON'
{"origin":{"human":{"loc":12},"agent":{"loc":40}}}
JSON
check 1 "loc como produtividade recusa" "${bad_loc}" "${fail}"

bad_commit="$(mktemp -d "${WORK}/bad-commit.XXXXXX")"
mkdir -p "${bad_commit}"
cat >"${bad_commit}/commits.json" <<'JSON'
{"origin":{"human":{"commits":4},"agent":{"commits":9}}}
JSON
check 1 "commit como produtividade recusa" "${bad_commit}" "${fail}"

check 0 "fixtures versionadas passam" \
  "${ROOT}/scripts/metrics/fixtures/pass" \
  "${ROOT}/scripts/metrics/fixtures/fail"

if ((failed > 0)); then
  printf 'metrics-gate-test: %s ok, %s falhou\n' "${passed}" "${failed}" >&2
  exit 1
fi
printf 'metrics-gate-test: %s ok\n' "${passed}"
