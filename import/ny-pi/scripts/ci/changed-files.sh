#!/usr/bin/env bash
# Prints the files added, copied, modified or renamed by this change, one per line.
# Base: $BASE_SHA (PR base, merge-group base or push "before"); else merge-base with
# origin/main; else HEAD~1; else the empty tree. Needs enough history (fetch-depth: 0).
set -euo pipefail
base=${BASE_SHA:-}
case $base in
'' | 0000000000000000000000000000000000000000)
  base=$(git merge-base origin/main HEAD 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git hash-object -t tree /dev/null)
  ;;
esac
git -c core.quotepath=off diff --name-only --diff-filter=ACMR "$base" HEAD
