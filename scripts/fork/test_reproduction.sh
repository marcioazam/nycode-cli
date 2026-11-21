#!/usr/bin/env bash
# Reproduction test (08 section 10.1, item 5): P (all.sh, biome included) applied to the upstream side of the fork
# base must give the tree of the rename commit, apart from what the fork added by hand in that commit (NOTICE,
# docs/fork/). The one normalization: the rename commit says `marcioazam/nycode-cli` where P now emits
# `marcioazam/nycode` (the repository was renamed in #195, after that commit; the rule is in rename.py and post*.sh),
# so that string is rewritten in the rename commit's text files, biome.sh re-flows the lines that got shorter, and the
# affected lines are counted. Nothing else is
# excluded: package-lock.json and install-lock/ are compared too. Exit 0 = reproduced; exit 1 = the measured
# difference is printed (M = content differs, D = only P has the path, A = only the rename commit has it).
# Needs `npm ci --ignore-scripts` (the caller's biome). About 20 s. Not part of the CI.
# Usage: test_reproduction.sh [--rename SHA (default f523ebd25)] [--upstream SHA (default <rename>^^2)]
set -euo pipefail
export LC_ALL=C
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
cd "$repo"
rename=f523ebd25 upstream=''
while [ $# -gt 0 ]; do
  case $1 in
  --rename) rename=${2:?} && shift ;;
  --upstream) upstream=${2:?} && shift ;;
  *)
    echo "usage: test_reproduction.sh [--rename SHA] [--upstream SHA]" >&2
    exit 2
    ;;
  esac
  shift
done
rename=$(git rev-parse --verify "$rename^{commit}")
[ -n "$upstream" ] || upstream=$rename^^2
upstream=$(git rev-parse --verify "$upstream^{commit}")

tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/p" 2>/dev/null || true; git worktree remove --force "$tmp/r" 2>/dev/null || true; git worktree prune; rm -r "$tmp"' EXIT
start=$SECONDS
git worktree add --detach -q "$tmp/p" "$upstream"
git worktree add --detach -q "$tmp/r" "$rename"
bash "$here/all.sh" "$tmp/p" >/dev/null
git -C "$tmp/p" add -A
ptree=$(git -C "$tmp/p" write-tree)

old='marcioazam/nycode-cli'
lines=$(git -C "$tmp/r" grep -I -h -- "$old" | wc -l)
(cd "$tmp/r" && git grep -I -l -z -- "$old" | xargs -0 -r sed -i "s#$old#marcioazam/nycode#g")
bash "$here/biome.sh" "$tmp/r" >/dev/null # the shorter URL can fit lines that were wrapped
git -C "$tmp/r" add -A
rtree=$(git -C "$tmp/r" write-tree)
git diff --no-renames --name-status "$ptree" "$rtree" >"$tmp/diff.txt"

echo "upstream $upstream  rename $rename  elapsed=$((SECONDS - start))s"
echo "normalized $old -> marcioazam/nycode on the rename side: $lines lines"
for s in M D A; do echo "$s: $(grep -c "^$s	" "$tmp/diff.txt" || true)"; done
echo "lock files that differ: $(grep -cE '	(package-lock.json|packages/coding-agent/install-lock/)' "$tmp/diff.txt" || true)"
bad=$(grep -vE '^A	(NOTICE|docs/fork/)' "$tmp/diff.txt" || true)
if [ -z "$bad" ]; then
  echo "reproduced (hand-added: $(grep -c '^A	' "$tmp/diff.txt" || true) files under NOTICE, docs/fork/)"
  exit 0
fi
echo "NOT reproduced: $(printf '%s\n' "$bad" | wc -l) paths differ; first 20:"
printf '%s\n' "$bad" | head -20
exit 1
