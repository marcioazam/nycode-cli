#!/usr/bin/env bash
# Test for merge-policy.sh on a throwaway repository: squash is ignored, an upstream merge (with and without a
# resolution commit) passes, a merge of an ordinary branch fails. Run: bash scripts/ci/test_merge_policy.sh
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/merge-policy.sh
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
cd "$tmp"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q -b main .
c() { echo "$1" >"$1" && git add "$1" && git commit -q -m "$1"; }

c base
# upstream/main: two commits after base
git checkout -q -b up && c up1 && c up2
git update-ref refs/remotes/upstream/main up
git checkout -q main

fail() {
  echo "FAIL: $1" >&2
  exit 1
}
run() { BEFORE=$1 AFTER=$(git rev-parse HEAD) bash "$script"; }

# 1. squash (fast-forward / plain commit): no merge commit, passes
start=$(git rev-parse HEAD)
c squashed
run "$start" >/dev/null || fail "squash must be ignored"

# 2a. merge of an upstream sync branch with a conflict-resolution commit on top: passes
start=$(git rev-parse HEAD)
git checkout -q -b sync/upstream-1 && git merge -q --no-edit up && c resolution
git checkout -q main && git merge -q --no-ff --no-edit sync/upstream-1
run "$start" >/dev/null || fail "upstream merge must pass"

# 2b. merge of a tip of upstream/main itself: passes
c more-main
git checkout -q -b up-b up && c up3 && git update-ref refs/remotes/upstream/main up-b
git checkout -q main
start=$(git rev-parse HEAD)
git merge -q --no-ff --no-edit up-b
run "$start" >/dev/null || fail "merge of upstream tip must pass"

# 3. merge of an ordinary branch: fails and names the merge commit
start=$(git rev-parse HEAD)
git checkout -q -b feature && c feat1
git checkout -q main && c main2 && git merge -q --no-ff --no-edit feature
out=$(run "$start") && fail "ordinary merge must fail"
[ "$out" = "$(git rev-parse HEAD)" ] || fail "offending commit not reported: $out"

# 4. earlier merges are outside BEFORE..AFTER: the offending range does not leak back
start=$(git rev-parse HEAD)
c after
run "$start" >/dev/null || fail "merges before BEFORE must not be audited"

# 5. missing upstream ref is a script error (exit 2), not a pass
git update-ref -d refs/remotes/upstream/main
rc=0
run "$start" >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] || fail "missing upstream must exit 2, got $rc"

echo "test_merge_policy: ok"
