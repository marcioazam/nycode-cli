#!/usr/bin/env bash
# On-demand retest of the vanilla arms (AC9). usage: vanilla-retest.sh --budget-usd B [--arms cc-vanilla,pi-vanilla]
# Results land in $STATE/vanilla/<date>; an existing baseline is never overwritten.
set -euo pipefail

# Public repo: no owner literal in the source; the env file names it (RUNBOOK).
REPO=${BENCH_REPO:?set BENCH_REPO=owner/name (~/.config/ny-pi/bench.env)}
URL=${BENCH_REPO_URL:-https://github.com/$REPO.git}
STATE=${BENCH_STATE:-$HOME/.local/state/bench}
MODEL=${BENCH_MODEL:-claude-sonnet-5-5}
budget="" arms=cc-vanilla,pi-vanilla

while [[ $# -gt 0 ]]; do
  case "$1" in
  --budget-usd)
    budget=${2:-}
    shift 2
    ;;
  --arms)
    arms=${2:-}
    shift 2
    ;;
  *)
    echo "usage: vanilla-retest.sh --budget-usd B [--arms cc-vanilla,pi-vanilla]" >&2
    exit 2
    ;;
  esac
done
if [[ ! $budget =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "vanilla-retest: --budget-usd B is required (explicit spend ceiling, AC9)" >&2
  exit 2
fi
if [[ -z ${BENCH_CC_CREDENTIALS:-} ]]; then
  echo "vanilla-retest: BENCH_CC_CREDENTIALS is not set (see docs/bench/RUNBOOK.md)" >&2
  exit 2
fi

mkdir -p "$STATE/wt" "$STATE/vanilla"
exec 9>"$STATE/lock"
if ! flock -n 9; then
  echo "vanilla-retest: another bench run is in progress (lock $STATE/lock); skipping"
  exit 0
fi

date=$(date +%Y%m%d)
out=$STATE/vanilla/$date
if [[ -e $out ]]; then
  echo "vanilla-retest: $out already exists; not overwriting" >&2
  exit 2
fi
mkdir -p "$out"
if [[ ! -d $STATE/repo ]]; then git clone --quiet --bare "$URL" "$STATE/repo"; fi
git -C "$STATE/repo" fetch --quiet --prune origin '+refs/heads/main:refs/heads/main'
sha=$(git -C "$STATE/repo" rev-parse main)
wt=$STATE/wt/vanilla-$sha
git -C "$STATE/repo" worktree add --quiet --detach "$wt" "$sha"
trap 'git -C "$STATE/repo" worktree remove --force "$wt" || true' EXIT

name=BASELINE-VANILLA-$date.md
if git -C "$STATE/repo" cat-file -e "main:docs/bench/$name" 2>/dev/null; then name=BASELINE-VANILLA-$date-$(date +%H%M).md; fi

IFS=, read -ra list <<<"$arms"
per=$(awk -v b="$budget" -v n="${#list[@]}" 'BEGIN { printf "%.2f", b / n }')
for arm in "${list[@]}"; do
  (cd "$wt" && python3 bench/run.py run --arm "$arm" --tier vanilla --model "$MODEL" --budget-usd "$per" --out "$out/$arm")
done
echo "vanilla-retest: results in $out (ceiling $budget USD, $per per arm)"
echo "Report (on a branch off main, then open a PR):"
echo "  python3 bench/run.py report --runs $out/* --out docs/bench/$name"
