#!/usr/bin/env bash
# Test for seam-files.sh: lists the files of active (ativa) seams only, so run-static skips shell lint on them.
# Run: bash scripts/ci/seams/test_seam_files.sh
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/seam-files.sh
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
cd "$tmp"
git init -q .
mkdir -p scripts/fork
cat >scripts/fork/seams.txt <<'LIST'
# comment

K1 | a.ts up.sh | nycode: K1[[:space:]] | a.test.ts | ativa
K2 | pending.sh | nycode: K2[[:space:]] | - | pendente: fase F9
LIST
out=$(bash "$script")
[[ $out == $'a.ts\nup.sh' ]] || {
  echo "FAIL: expected a.ts and up.sh only, got: $out" >&2
  exit 1
}
echo "seam-files OK"
