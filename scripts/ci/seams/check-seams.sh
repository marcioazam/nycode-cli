#!/usr/bin/env bash
# Checks the nycode seams listed in scripts/fork/seams.txt (08 section 4): every active (ativa) seam keeps its
# `nycode: K<n>` marker in its files and its test exists; a pending seam has no marker yet. Prints "seams N/14".
# Exit 1 when an active seam lost its marker or test, or a pending (pendente) one already has the marker. --strict also exits 1
# unless all 14 are ativa and have a test (the acceptance criterion of 08 section 10.1, item 4).
# Usage: check-seams.sh [--strict]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
list=scripts/fork/seams.txt
strict=0
[ "${1:-}" = --strict ] && strict=1

ok=0 total=0 bad=0
pending=() untested=()
while IFS= read -r line; do
  case $line in '' | '#'*) continue ;; esac
  IFS=$'\t' read -r id files pattern test state <<<"${line// | /$'\t'}"
  total=$((total + 1))
  found=1
  for f in $files; do
    [ -e "$f" ] && grep -rEq -- "$pattern" "$f" || found=0
  done
  case $state in
  ativa)
    if [ "$found" = 0 ]; then
      echo "$id: marker /$pattern/ missing in: $files" >&2
      bad=1
    elif [ "$test" = - ]; then
      untested+=("$id")
      ok=$((ok + 1))
    elif [ ! -f "$test" ]; then
      echo "$id: test $test does not exist" >&2
      bad=1
    else
      ok=$((ok + 1))
    fi
    ;;
  pendente:*)
    # A pending seam must not match: a marker that already landed means this list is stale.
    anywhere=0
    for f in $files; do [ -e "$f" ] && grep -rEq -- "$pattern" "$f" && anywhere=1; done
    if [ "$anywhere" = 1 ]; then
      echo "$id: listed as '$state' but the marker is in the code; mark it ativa in $list" >&2
      bad=1
    fi
    pending+=("$id (${state#pendente: })")
    ;;
  *)
    echo "$id: unknown state '$state'" >&2
    bad=1
    ;;
  esac
done <"$list"

echo "seams $ok/$total"
[ "${#pending[@]}" -eq 0 ] || printf 'pendente: %s\n' "${pending[@]}"
[ "${#untested[@]}" -eq 0 ] || echo "no test yet: ${untested[*]}"
[ "$total" -eq 14 ] || {
  echo "$list must list exactly 14 seams (found $total)" >&2
  bad=1
}
if [ "$strict" = 1 ] && { [ "$ok" -ne 14 ] || [ "${#untested[@]}" -gt 0 ]; }; then bad=1; fi
exit "$bad"
