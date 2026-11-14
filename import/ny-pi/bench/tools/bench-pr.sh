#!/usr/bin/env bash
# Local poster of the required `bench-pr` commit status (L1: no self-hosted runner).
# usage: bench-pr.sh --poll | --pr N
# Runs the my-pi PR tier in a throwaway worktree of the PR head, gates it against the main baseline and posts
# pending -> success|failure|error through `bench/run.py post-status`. Fail closed: anything unverifiable is `error`.
set -euo pipefail

# Public repo: no owner literal in the source; the env file names it (RUNBOOK).
REPO=${BENCH_REPO:?set BENCH_REPO=owner/name (~/.config/pi-harness/bench.env)}
URL=${BENCH_REPO_URL:-https://github.com/$REPO.git}
STATE=${BENCH_STATE:-$HOME/.local/state/bench}
MODEL=${BENCH_MODEL:-claude-sonnet-5-5}
BUDGET=${BENCH_PR_BUDGET:-12}

mode=${1:-}
pr_arg=${2:-}
case "$mode" in
--poll) ;;
--pr) [[ $pr_arg =~ ^[0-9]+$ ]] || {
  echo "bench-pr: --pr needs a number" >&2
  exit 2
} ;;
*)
  echo "usage: bench-pr.sh --poll | --pr N" >&2
  exit 2
  ;;
esac

if [[ -z ${BENCH_CC_CREDENTIALS:-} ]]; then
  echo "bench-pr: BENCH_CC_CREDENTIALS is not set (path of the Claude credentials file; see docs/bench/RUNBOOK.md)" >&2
  exit 2
fi

mkdir -p "$STATE/wt" "$STATE/runs"
exec 9>"$STATE/lock"
if ! flock -n 9; then
  echo "bench-pr: another bench run is in progress (lock $STATE/lock); skipping"
  exit 0
fi

sync_repo() {
  if [[ ! -d $STATE/repo ]]; then git clone --quiet --bare "$URL" "$STATE/repo"; fi
  git -C "$STATE/repo" fetch --quiet --prune origin '+refs/heads/main:refs/heads/main'
}

baseline_dir() {
  if [[ -n ${BENCH_BASELINE_MAIN:-} ]]; then
    echo "$BENCH_BASELINE_MAIN"
    return
  fi
  local d=$STATE/base-main
  rm -rf "$d"
  mkdir -p "$d"
  git -C "$STATE/repo" archive --format=tar main -- docs/bench/baseline-main 2>/dev/null | tar -x -C "$d" || true
  echo "$d/docs/bench/baseline-main"
}

# $1 pr number, $2 head sha
run_pr() {
  local n=$1 sha=$2 wt=$STATE/wt/$2 out=$STATE/runs/$2 base rc=0 state desc
  git -C "$STATE/repo" fetch --quiet origin "$sha"
  git -C "$STATE/repo" worktree add --quiet --detach "$wt" "$sha"
  post() { (cd "$wt" && python3 bench/run.py post-status --pr "$n" --state "$1" --description "$2"); }
  cleanup() { git -C "$STATE/repo" worktree remove --force "$wt" || true; }

  post pending "bench-pr em execução" || {
    cleanup
    return 1
  }
  base=$(baseline_dir)
  if [[ -z $(ls -A "$base" 2>/dev/null) ]]; then
    post error "baseline main ausente" || true
    cleanup
    return 0
  fi

  rm -rf "$out"
  mkdir -p "$out"
  (cd "$wt" && python3 bench/run.py run --arm my-pi --tier pr --model "$MODEL" --budget-usd "$BUDGET" --out "$out") || rc=$?
  if [[ $rc -ne 0 && $rc -ne 5 ]]; then
    post error "run falhou (exit $rc)" || true
    cleanup
    return 0
  fi

  rc=0
  (cd "$wt" && python3 bench/run.py gate --base "$base" --cand "$out") >"$out/summary.md" || rc=$?
  case $rc in
  0) state=success desc=PASS ;;
  1) state=failure desc=FAIL ;;
  3) state=failure desc="INCONCLUSIVE após extensão" ;;
  4) state=error desc="NOT_COMPARABLE: re-rodar baseline main" ;;
  5) state=error desc="NOT_VERIFIED: orçamento esgotado" ;;
  *) state=error desc="gate exit $rc" ;;
  esac
  if [[ -f $out/verdict.json ]]; then
    desc="$desc $(jq -r '"n=\(.n)"' "$out/verdict.json" 2>/dev/null || true)"
  fi
  post "$state" "$desc (detalhe: $out/summary.md)" || true
  cleanup
}

owner=$(gh api "repos/$REPO" -q .owner.login)
sync_repo

if [[ $mode == --pr ]]; then
  prs=$(gh pr view "$pr_arg" --repo "$REPO" --json number,headRefOid,author,isCrossRepository | jq -c '[.]')
else
  prs=$(gh pr list --repo "$REPO" --state open --json number,headRefOid,author,isCrossRepository)
fi

while read -r n sha; do
  [[ -n $n ]] || continue
  if [[ $mode == --poll ]]; then
    last=$(gh api "repos/$REPO/commits/$sha/statuses" -q '[.[] | select(.context=="bench-pr")][0].state // empty')
    if [[ $last == success || $last == failure ]]; then continue; fi
  fi
  echo "bench-pr: PR #$n @ ${sha:0:12}"
  run_pr "$n" "$sha" || echo "bench-pr: PR #$n failed to run" >&2
done < <(jq -r --arg o "$owner" '.[] | select(.isCrossRepository == false and .author.login == $o) | "\(.number) \(.headRefOid)"' <<<"$prs")
