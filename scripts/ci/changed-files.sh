#!/usr/bin/env bash
# Prints the files added, copied, modified or renamed by this change, one per line.
# Base: $BASE_SHA (PR base, merge-group base or push "before"); else merge-base with
# origin/main; else HEAD~1; else the empty tree. Needs enough history (fetch-depth: 0).
# Upstream sync (08): when the change brings a rename image R (a commit with an `Upstream-Commit:` trailer), a file
# whose content is exactly R's is upstream content as published, not a fork change, and is left out. Rule 2 of 08
# section 7 forbids reformatting upstream files, and "legacy never blocks" (run-static.sh) covers it. A file the fork
# changed differs from R and stays in the list.
set -euo pipefail
base=${BASE_SHA:-}
case $base in
'' | 0000000000000000000000000000000000000000)
  base=$(git merge-base origin/main HEAD 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git hash-object -t tree /dev/null)
  ;;
esac
files=$(git -c core.quotepath=off diff --name-only --diff-filter=ACMR "$base" HEAD)
image=$(git log -1 --format=%H --grep='^Upstream-Commit: ' "$base..HEAD")
[ -n "$image" ] || {
  [ -z "$files" ] || printf '%s\n' "$files"
  exit 0
}
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ "$(git rev-parse -q --verify "$image:$f" || true)" = "$(git rev-parse "HEAD:$f")" ] || printf '%s\n' "$f"
done <<<"$files"
