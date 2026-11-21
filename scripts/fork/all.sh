#!/usr/bin/env bash
# P: applies the rename pipeline to a clean git tree of upstream (earendil-works/pi), in place.
# Order: remove the Earendil workflows, rename.py, post.sh, post2.sh, regenerate the locks (package-lock.json and
# packages/coding-agent/install-lock/). The tree it produces is the "image" of the upstream commit (08 section 4.3).
# The old /tmp version also ran `npm ci` and `npm run build` afterwards; neither changes a tracked file.
# Usage: all.sh ROOT
set -euo pipefail
export LC_ALL=C
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=${1:?usage: all.sh ROOT}
cd "$root"
[ -z "$(git status --porcelain)" ] || {
  echo "all.sh: $root is not a clean tree" >&2
  exit 2
}
log=$(mktemp -d)
trap 'rm -r "$log"' EXIT

git rm -q -r .github/workflows/{approve-contributor,build-binaries,env-daemons,env,issue-analysis,issue-gate,issue-triage-labels,nix,p2-cloud-bundle,p2-mac-nightly,pr-gate,preview-packages,publish-model-catalog,remove-labels-on-close}.yml
# rename.py output goes to a file: a pipe into `head` would kill it with SIGPIPE before the git mv loop.
python3 "$here/rename.py" . >"$log/rename.log"
head -1 "$log/rename.log"
bash "$here/post.sh" .
# post2.sh repeats the last two seds of post.sh (idempotent); it has no `cd`.
bash "$here/post2.sh"
npm install --package-lock-only --ignore-scripts >"$log/lock.log" 2>&1 || {
  tail -20 "$log/lock.log" >&2
  exit 1
}
node scripts/generate-coding-agent-install-lock.mjs
