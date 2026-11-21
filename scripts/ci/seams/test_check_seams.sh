#!/usr/bin/env bash
# Test for check-seams.sh on a throwaway repository: counts, lost marker, missing test, stale pending, --strict.
# Run: bash scripts/ci/seams/test_check_seams.sh
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/check-seams.sh
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
cd "$tmp"
git init -q .
mkdir -p scripts/fork
fail() {
  echo "FAIL: $1" >&2
  exit 1
}
# K1..K14 pending on a file that does not exist, then override single lines.
mklist() { # extra lines replacing K1 and K2
  {
    printf '# comment\n\n%s\n%s\n' "$1" "$2"
    for i in $(seq 3 14); do printf 'K%s | none.ts | nycode: K%s[[:space:]] | - | pendente: fase F9\n' "$i" "$i"; done
  } >scripts/fork/seams.txt
}
run() { bash "$script" "$@" 2>&1; }

echo '// nycode: K1 reason' >a.ts
touch a.test.ts
mklist 'K1 | a.ts | nycode: K1[[:space:]] | a.test.ts | ativa' 'K2 | none.ts | nycode: K2[[:space:]] | - | pendente: fase F9'
out=$(run) || fail "intact list must pass: $out"
[[ $out == *"seams 1/14"* ]] || fail "expected 1/14: $out"
run --strict >/dev/null && fail "--strict must fail with pending seams"

echo '// nothing' >a.ts
out=$(run) && fail "lost marker must fail"
[[ $out == *"K1: marker"* ]] || fail "lost marker message: $out"

echo '// nycode: K10 x' >a.ts # K10 must not satisfy K1
run >/dev/null && fail "K10 marker must not satisfy K1"

echo '// nycode: K1 reason' >a.ts
mklist 'K1 | a.ts | nycode: K1[[:space:]] | missing.test.ts | ativa' 'K2 | none.ts | x | - | pendente: fase F9'
out=$(run) && fail "missing test must fail"
[[ $out == *"K1: test missing.test.ts"* ]] || fail "missing test message: $out"

mklist 'K1 | a.ts | nycode: K1[[:space:]] | a.test.ts | ativa' 'K2 | a.ts | nycode: K1[[:space:]] | - | pendente: fase F9'
out=$(run) && fail "stale pending must fail"
[[ $out == *"K2: listed as"* ]] || fail "stale pending message: $out"

echo "ok"
