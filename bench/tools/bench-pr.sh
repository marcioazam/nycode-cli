#!/usr/bin/env bash
# Local poster of the required `bench-pr` commit status (L1: no self-hosted runner).
# usage: bench-pr.sh --poll | --pr N
# Runs the ny-pi PR tier in a throwaway worktree of the PR head, gates it against the main baseline and posts
# pending -> success|failure|error through `bench/run.py post-status`. Fail closed: anything unverifiable is `error`.
set -euo pipefail

# Public repo: no owner literal in the source; the env file names it (RUNBOOK).
REPO=${BENCH_REPO:?set BENCH_REPO=owner/name (~/.config/nycode/bench.env)}
URL=${BENCH_REPO_URL:-https://github.com/$REPO.git}
STATE=${BENCH_STATE:-$HOME/.local/state/bench}
MODEL=${BENCH_MODEL:-claude-sonnet-5-5}
BUDGET=${BENCH_PR_BUDGET:-12}
EXT_BUDGET=${BENCH_PR_EXT_BUDGET:-6}

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

# API-key mode (BENCH_API_KEY_FILE, + BENCH_ANTHROPIC_WORKSPACE_ID): run.py preflights the key; no OAuth file needed.
if [[ -z ${BENCH_API_KEY_FILE:-} && -z ${BENCH_CC_CREDENTIALS:-} ]]; then
  echo "bench-pr: set BENCH_API_KEY_FILE (API-key mode) or BENCH_CC_CREDENTIALS (path of the Claude credentials file); see docs/bench/RUNBOOK.md" >&2
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

  # Declared policy (owner, 2026-11-17): the benchmark runs only for PRs that change the harness's functional behavior.
  # Anything the classifier cannot read counts as functional (fail closed).
  mkdir -p "$out"
  verdict=$(cd "$wt" && python3 bench/run.py affects --base main --head "$sha" 2>/dev/null) || verdict=functional
  if [[ $(head -n1 <<<"$verdict") == non-functional ]]; then
    {
      echo "## bench-pr: N/A"
      echo
      echo "Sem mudança funcional no harness: o benchmark não rodou (política do dono, 2026-11-17). Arquivos:"
      echo
      echo '```'
      tail -n +2 <<<"$verdict"
      echo '```'
    } >"$out/na.md"
    post success "N/A: sem mudança funcional" || {
      cleanup
      return 1
    }
    gh pr comment "$n" --repo "$REPO" --body-file "$out/na.md" >/dev/null || true
    cleanup
    return 0
  fi

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
  (cd "$wt" && python3 bench/run.py run --arm ny-pi --tier pr --model "$MODEL" --budget-usd "$BUDGET" --out "$out") || rc=$?
  if [[ $rc -ne 0 && $rc -ne 5 ]]; then
    post error "run falhou (exit $rc)" || true
    cleanup
    return 0
  fi

  rc=0
  # Sequential gate (RUNBOOK "Gate sequencial"): the run above is look 1 (k1, security k3). When look 1 does not decide,
  # the gate calls this command to complete k3 (+2) and, if still in doubt, +3 on the discordant tasks (or a single failed
  # security rep); each call runs only the tasks and reps the gate names in BENCH_EXTEND_*.
  ext="python3 bench/run.py run --extension --arm ny-pi --tier pr --model '$MODEL' --budget-usd '$EXT_BUDGET' >&2"
  (cd "$wt" && python3 bench/run.py gate --base "$base" --cand "$out" --extend-with-cmd "$ext") >"$out/summary.md" || rc=$?
  case $rc in
  0) state=success desc=PASS ;;
  1) state=failure desc=FAIL ;;
  3) state=failure desc="INCONCLUSIVE após extensão" ;;
  4) state=error desc="NOT_COMPARABLE: re-rodar baseline main" ;;
  5) state=error desc="NOT_VERIFIED: orçamento esgotado" ;;
  *) state=error desc="gate exit $rc" ;;
  esac
  if [[ -f $out/verdict.json ]]; then
    desc="$desc $(jq -r '"n=\(.n) olhar=\(.look // "-")"' "$out/verdict.json" 2>/dev/null || true)"
  fi
  post "$state" "$desc" || true
  # The full summary goes on the PR; the status description stays short and without local paths.
  [[ -s $out/summary.md ]] && { gh pr comment "$n" --repo "$REPO" --body-file "$out/summary.md" >/dev/null || true; }
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
    last=$(gh api "repos/$REPO/commits/$sha/statuses" -q '[.[] | select(.context=="bench-pr")][0] | "\(.state // "") \(.description // "")"')
    # NOT_COMPARABLE and NOT_VERIFIED spent a round and need a person (new baseline, infra): retrying them every
    # poll would spend the budget again each time. Rerun by hand with --pr N. Other errors spent nothing and retry.
    case $last in success* | failure* | "error NOT_"*) continue ;; esac
    # The list was read before earlier PRs of this pass ran: a PR closed meanwhile must not spend quota.
    [[ $(gh pr view "$n" --repo "$REPO" --json state -q .state) == OPEN ]] || continue
  fi
  echo "bench-pr: PR #$n @ ${sha:0:12}"
  run_pr "$n" "$sha" || echo "bench-pr: PR #$n failed to run" >&2
done < <(jq -r --arg o "$owner" '.[] | select(.isCrossRepository == false and .author.login == $o) | "\(.number) \(.headRefOid)"' <<<"$prs")
