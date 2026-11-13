#!/usr/bin/env bash
# ci-security gate: SHA-pin and permissions policy, actionlint, zizmor, secret scans (gitleaks +
# trufflehog via scripts/check-leaks.sh, plus trufflehog --only-verified over the history),
# semgrep (--error) and osv-scanner (HIGH/CRITICAL = 0). Every step runs; non-zero if any failed.
# The personal-identifier list used locally by check-leaks.sh is not in the repo: CI points
# PI_HARNESS_IDENTIFIERS at an empty file (that scan only runs on the maintainer's machine).
# Usage: run-security.sh [--selftest]   Env: RUNNER_TEMP, BASE_SHA.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
TMP=${RUNNER_TEMP:-$(mktemp -d)}
export PATH="$HOME/.local/bin:$PATH"
WF=${WORKFLOW_DIR:-.github}
fails=()

step() { # name cmd...
  local name=$1 rc=0
  shift
  echo "::group::$name"
  "$@" || rc=$?
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then echo "ok   $name"; else
    echo "::error title=ci-security::$name failed (exit $rc)"
    fails+=("$name")
  fi
}

# Every `uses:` must be a local action or owner/repo[/path]@<40 hex>; docker:// needs @sha256:.
check_pins() { # dir
  local bad
  bad=$(grep -rnE '^[[:space:]-]*uses:[[:space:]]*' "$1" --include='*.yml' --include='*.yaml' 2>/dev/null |
    grep -vE 'uses:[[:space:]]*"?\./' |
    grep -vE 'uses:[[:space:]]*"?[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+@[0-9a-f]{40}"?([[:space:]]|$)' |
    grep -vE 'uses:[[:space:]]*"?docker://[^[:space:]]+@sha256:[0-9a-f]{64}"?([[:space:]]|$)' || true)
  if [ -n "$bad" ]; then
    echo "actions not pinned to a full commit SHA:"
    echo "$bad"
    return 1
  fi
}

# Workflows must declare top-level `permissions: {}` and never use pull_request_target.
check_workflow_policy() { # dir
  local f rc=0
  for f in "$1"/workflows/*.yml "$1"/workflows/*.yaml; do
    [ -f "$f" ] || continue
    grep -qE '^permissions:[[:space:]]*\{\}[[:space:]]*$' "$f" || {
      echo "$f: missing top-level 'permissions: {}'"
      rc=1
    }
    if grep -qE '^[[:space:]]*(pull_request_target|workflow_run)[[:space:]]*:' "$f"; then
      echo "$f: pull_request_target/workflow_run are forbidden"
      rc=1
    fi
  done
  return $rc
}

policy() { check_pins "$WF" && check_workflow_policy "$WF"; }

selftest() {
  local d="$TMP/pins-selftest" rc=0
  mkdir -p "$d/workflows"
  printf 'permissions: {}\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n' >"$d/workflows/bad.yml"
  check_pins "$d" >/dev/null && {
    echo "selftest: unpinned action not detected"
    rc=1
  }
  printf 'permissions: {}\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n      - uses: ./local\n' >"$d/workflows/bad.yml"
  check_pins "$d" >/dev/null || {
    echo "selftest: pinned action rejected"
    rc=1
  }
  printf 'jobs: {}\n' >"$d/workflows/bad.yml"
  check_workflow_policy "$d" >/dev/null && {
    echo "selftest: missing permissions not detected"
    rc=1
  }
  printf 'permissions: {}\non:\n  pull_request_target:\n' >"$d/workflows/bad.yml"
  check_workflow_policy "$d" >/dev/null && {
    echo "selftest: pull_request_target not detected"
    rc=1
  }
  rm -r "$d"
  [ $rc -eq 0 ] && echo "selftest: ok"
  return $rc
}

leaks() {
  : >"$TMP/identifiers"
  export PI_HARNESS_IDENTIFIERS="$TMP/identifiers"
  bash scripts/check-leaks.sh --selftest && bash scripts/check-leaks.sh --tree && bash scripts/check-leaks.sh --history
}

trufflehog_history() {
  trufflehog git "file://$PWD" --only-verified --fail --no-update --no-color \
    --exclude-paths=<(printf '%s\n' 'scripts/fixtures/leak/' 'atualizador/scripts/tests/test_core\.py$')
}

# p/bash does not exist in the registry (404): shell is covered by p/default, p/command-injection.
# Pre-existing findings (13 on 2026-11-13, listed in the task record) do not block: with BASE_SHA
# semgrep reports only findings introduced since that commit; without it the whole tree is scanned.
semgrep_scan() {
  local base=${BASE_SHA:-} args=()
  case $base in '' | 0000000000000000000000000000000000000000) ;; *) args=(--baseline-commit "$base") ;; esac
  SEMGREP_SEND_METRICS=off semgrep scan --error --metrics=off --disable-version-check --quiet \
    --config p/default --config p/python --config p/typescript --config p/command-injection --config p/github-actions \
    --exclude scripts/fixtures/leak "${args[@]}" .
}

# osv-scanner has no severity threshold flag: fail on any group with CVSS >= 7 (HIGH/CRITICAL) or
# no score at all (unknown is not assumed safe). Exceptions live in scripts/ci/osv-scanner.toml with owner+expiry.
osv_scan() {
  local out="$TMP/osv.json" rc=0
  osv-scanner scan source --config scripts/ci/osv-scanner.toml --recursive --format json --output-file "$out" . || rc=$?
  # exit 128 = no packages found (never silent: the repo has npm lockfiles); 1 = vulnerabilities found
  [ "$rc" -le 1 ] || {
    echo "osv-scanner error (exit $rc)"
    return 1
  }
  [ -s "$out" ] || {
    echo "osv-scanner produced no report"
    return 1
  }
  local n
  n=$(jq '[.results[]?.packages[]?.groups[]? | select(((.max_severity // "") | tonumber? // 10) >= 7)] | length' "$out")
  echo "osv-scanner: ${n} HIGH/CRITICAL/unscored group(s)"
  [ "$n" -eq 0 ]
}

if [ "${1:-}" = --selftest ]; then
  selftest
  exit
fi

step "pins/permissions selftest" selftest
step "SHA pins + permissions + no pull_request_target" policy
step "actionlint" actionlint -color
step "zizmor (>= medium)" zizmor --offline --min-severity medium --config .github/zizmor.yml "$WF/workflows"
step "gitleaks + trufflehog (check-leaks)" leaks
step "trufflehog history --only-verified" trufflehog_history
step "semgrep --error" semgrep_scan
step "osv-scanner" osv_scan

if [ "${#fails[@]}" -gt 0 ]; then
  echo "ci-security FAILED: ${fails[*]}"
  exit 1
fi
echo "ci-security OK"
