#!/usr/bin/env bash
# Reproduction test (08 section 10.1, item 5): P applied to the upstream side of the fork base must give the tree
# of the rename commit, apart from what the fork added by hand in that commit (NOTICE, docs/fork/).
# Nothing else is excluded: package-lock.json and install-lock/ are compared too. Exit 0 = reproduced; exit 1 = the
# measured difference is printed (M = content differs, D = only P has the path, A = only the rename commit has it).
# --with-biome also runs `biome check --write` (root, apps/p2, apps/p3) from the caller's node_modules
# (`npm ci --ignore-scripts` first): the rename commit was formatted with it and P (all.sh) does not do that.
# Slow part: `git worktree add` of the whole tree plus the lock regeneration (about 10 s). Not part of the CI.
# Usage: test_reproduction.sh [--rename SHA (default f523ebd25)] [--upstream SHA (default <rename>^^2)] [--with-biome]
set -euo pipefail
export LC_ALL=C
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
cd "$repo"
rename=f523ebd25 upstream='' biome=0
while [ $# -gt 0 ]; do
  case $1 in
  --rename) rename=${2:?} && shift ;;
  --upstream) upstream=${2:?} && shift ;;
  --with-biome) biome=1 ;;
  *)
    echo "usage: test_reproduction.sh [--rename SHA] [--upstream SHA] [--with-biome]" >&2
    exit 2
    ;;
  esac
  shift
done
rename=$(git rev-parse --verify "$rename^{commit}")
[ -n "$upstream" ] || upstream=$rename^^2
upstream=$(git rev-parse --verify "$upstream^{commit}")

tmp=$(mktemp -d)
wt=$tmp/wt
trap 'git worktree remove --force "$wt" 2>/dev/null || true; git worktree prune; rm -r "$tmp"' EXIT
start=$SECONDS
git worktree add --detach -q "$wt" "$upstream"
bash "$here/all.sh" "$wt" >/dev/null
if [ "$biome" = 1 ]; then
  bin=$repo/node_modules/@biomejs/biome/bin/biome
  [ -f "$bin" ] || {
    echo "test_reproduction: $bin missing (run npm ci --ignore-scripts)" >&2
    exit 2
  }
  for d in . apps/p2 apps/p3; do (cd "$wt/$d" && node "$bin" check --write . >/dev/null 2>&1 || true); done
fi
git -C "$wt" add -A
tree=$(git -C "$wt" write-tree)
git diff --no-renames --name-status "$tree" "$rename" >"$tmp/diff.txt"

echo "upstream $upstream  rename $rename  biome=$biome  elapsed=$((SECONDS - start))s"
for s in M D A; do echo "$s: $(grep -c "^$s	" "$tmp/diff.txt" || true)"; done
locks=$(grep -cE '	(package-lock.json|packages/coding-agent/install-lock/)' "$tmp/diff.txt" || true)
echo "lock files that differ: $locks"
bad=$(grep -vE '^A	(NOTICE|docs/fork/)' "$tmp/diff.txt" || true)
if [ -z "$bad" ]; then
  echo "reproduced (hand-added: $(grep -c '^A	' "$tmp/diff.txt" || true) files under NOTICE, docs/fork/)"
  exit 0
fi
echo "NOT reproduced: $(printf '%s\n' "$bad" | wc -l) paths differ; first 20:"
printf '%s\n' "$bad" | head -20
exit 1
