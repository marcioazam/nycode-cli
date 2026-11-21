#!/usr/bin/env bash
# Builds the image commit R of an upstream commit (08 section 4.3): tree = P(U), parents R_prev and U, trailers
# Upstream-Commit and Rename-Pipeline. P is all.sh (workflows, rename.py, post*.sh, locks, biome), run in a temporary
# worktree: the caller's working tree and index are not touched (biome comes from the caller's node_modules). Only
# the branch --branch is created, locally.
# Deterministic: LC_ALL=C, fixed identity, dates copied from U (no clock in the tree or the commit).
# Usage: image.sh --upstream U --prev R_prev --branch NAME
set -euo pipefail
export LC_ALL=C TZ=UTC
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

usage() {
  echo "usage: image.sh --upstream <U> --prev <R_prev> --branch <name>" >&2
  exit 2
}
upstream='' prev='' branch=''
while [ $# -gt 0 ]; do
  case $1 in
  --upstream) upstream=${2:-} ;;
  --prev) prev=${2:-} ;;
  --branch) branch=${2:-} ;;
  *) usage ;;
  esac
  shift 2 || usage
done
[ -n "$upstream" ] && [ -n "$prev" ] && [ -n "$branch" ] || usage

U=$(git rev-parse --verify --quiet "$upstream^{commit}") || {
  echo "image.sh: $upstream is not a commit" >&2
  exit 2
}
PREV=$(git rev-parse --verify --quiet "$prev^{commit}") || {
  echo "image.sh: $prev is not a commit" >&2
  exit 2
}
git check-ref-format "refs/heads/$branch" || {
  echo "image.sh: invalid branch name $branch" >&2
  exit 2
}
existing=$(git rev-parse --verify --quiet "refs/heads/$branch" || true)

# Pipeline hash: every input of P (all.sh, biome.sh, post*.sh, rename.py, C-locale order) plus the pinned biome
# version, so any change to the workflow list, the biome scope or the biome pin changes the trailer.
biome_version=$("$here/../../node_modules/.bin/biome" --version) || {
  echo "image.sh: biome not found in $here/../../node_modules (run npm ci --ignore-scripts)" >&2
  exit 2
}
pipeline=$(cd "$here" && {
  cat all.sh biome.sh post*.sh rename.py
  printf '%s\n' "$biome_version"
} | sha256sum | cut -d' ' -f1)

tmp=$(mktemp -d)
wt=$tmp/wt
cleanup() {
  git worktree remove --force "$wt" 2>/dev/null || true
  git worktree prune
  rm -r "$tmp"
}
trap cleanup EXIT

git worktree add --detach -q "$wt" "$U"
bash "$here/all.sh" "$wt" >&2
git -C "$wt" add -A
tree=$(git -C "$wt" write-tree)

# Dates come from U, identity is fixed: the same inputs give the same R.
date=$(git log -1 --format=%cI "$U")
export GIT_AUTHOR_NAME=nycode-sync GIT_AUTHOR_EMAIL=sync@nycode.invalid GIT_AUTHOR_DATE=$date
export GIT_COMMITTER_NAME=nycode-sync GIT_COMMITTER_EMAIL=sync@nycode.invalid GIT_COMMITTER_DATE=$date
R=$(printf 'chore(sync): rename image of upstream %s\n\nUpstream-Commit: %s\nRename-Pipeline: %s\n' \
  "$(git rev-parse --short=12 "$U")" "$U" "$pipeline" | git commit-tree "$tree" -p "$PREV" -p "$U")

if [ -n "$existing" ] && [ "$existing" != "$R" ]; then
  echo "image.sh: branch $branch exists at $existing, the new image is $R" >&2
  exit 1
fi
[ -n "$existing" ] || git branch -q "$branch" "$R"
echo "$R"
