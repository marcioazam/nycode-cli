#!/usr/bin/env bash
# merge-policy (D-07): audit the merge commits that a push to main added (BEFORE..AFTER).
# Squash merges create no merge commit, so they are ignored. A merge commit is accepted only when every parent
# after the first brings at least one commit of upstream/main that the first parent lacks.
# Choice (07 section 8, open point): the literal rule "second parent is an ancestor of upstream/main" rejects a
# sync/upstream-* branch that carries a conflict-resolution commit, and the branch name is not visible on a push.
# So the test is on content: some merge-base of the parent with upstream/main is not an ancestor of the first parent.
# Prints each offending merge commit and exits 1; exits 2 on a usage or git error.
# Env: BEFORE (all zeros or empty = audit AFTER's whole history), AFTER (default HEAD), UPSTREAM_REF (default upstream/main).
set -uo pipefail

after=${AFTER:-HEAD}
before=${BEFORE:-}
upstream=${UPSTREAM_REF:-upstream/main}
zeros=0000000000000000000000000000000000000000

git rev-parse --verify --quiet "$upstream^{commit}" >/dev/null || {
  echo "merge-policy: $upstream not found" >&2
  exit 2
}
range=$after
case $before in '' | "$zeros") ;; *) range="$before..$after" ;; esac
merges=$(git rev-list --merges "$range") || exit 2

# True when parent $2 contains an upstream commit that parent $1 does not.
brings_upstream() {
  local b
  for b in $(git merge-base --all "$2" "$upstream"); do
    git merge-base --is-ancestor "$b" "$1" || return 0
  done
  return 1
}

bad=0
for m in $merges; do
  # shellcheck disable=SC2046 # parents are 40-hex words
  set -- $(git rev-list --parents -n 1 "$m")
  shift 2 # drop the commit itself and its first parent
  first=$(git rev-parse "$m^1")
  for p in "$@"; do
    brings_upstream "$first" "$p" || {
      echo "$m"
      bad=1
      break
    }
  done
done
exit "$bad"
