#!/usr/bin/env bash
# Nightly full tier of my-pi on the current origin/main in a throwaway worktree.
# Never updates the baseline: it prints the command that prepares the baseline-update PR.
set -euo pipefail

# Public repo: no owner literal in the source; the env file names it (RUNBOOK).
REPO=${BENCH_REPO:?set BENCH_REPO=owner/name (~/.config/pi-harness/bench.env)}
URL=${BENCH_REPO_URL:-https://github.com/$REPO.git}
STATE=${BENCH_STATE:-$HOME/.local/state/bench}
MODEL=${BENCH_MODEL:-claude-sonnet-5-5}
BUDGET=${BENCH_NIGHTLY_BUDGET:-30}

if [[ -z ${BENCH_CC_CREDENTIALS:-} ]]; then
  echo "bench-nightly: BENCH_CC_CREDENTIALS is not set (see docs/bench/RUNBOOK.md)" >&2
  exit 2
fi

mkdir -p "$STATE/wt" "$STATE/nightly"
exec 9>"$STATE/lock"
if ! flock -n 9; then
  echo "bench-nightly: another bench run is in progress (lock $STATE/lock); skipping"
  exit 0
fi

if [[ ! -d $STATE/repo ]]; then git clone --quiet --bare "$URL" "$STATE/repo"; fi
git -C "$STATE/repo" fetch --quiet --prune origin '+refs/heads/main:refs/heads/main'
sha=$(git -C "$STATE/repo" rev-parse main)
out=$STATE/nightly/$(date +%Y-%m-%d)
wt=$STATE/wt/nightly-$sha
rm -rf "$out"
mkdir -p "$out"
git -C "$STATE/repo" worktree add --quiet --detach "$wt" "$sha"
trap 'git -C "$STATE/repo" worktree remove --force "$wt" || true' EXIT

rc=0
(cd "$wt" && python3 bench/run.py run --arm my-pi --tier full --model "$MODEL" --budget-usd "$BUDGET" --out "$out") || rc=$?
echo "bench-nightly: main ${sha:0:12} -> $out (exit $rc)"
if [[ $rc -eq 0 ]]; then
  echo "Baseline NOT updated. To propose it, on a branch off main:"
  echo "  rm -rf docs/bench/baseline-main && cp -r $out docs/bench/baseline-main && git add docs/bench/baseline-main"
  echo "and open a PR (review the verdict first)."
fi
exit "$rc"
