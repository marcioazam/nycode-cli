#!/usr/bin/env bash
# Local CI: the remote gates (ci-static, ci-security, instruction-budget) on this machine, with the same
# scripts, pinned binaries and hashed Python packages, in a throwaway HOME. The benchmark gate is not
# here: bench/tools/bench-pr.sh already runs it locally.
# Usage: local.sh [--mutation] [--post]
#   --post publishes each gate as a commit status on HEAD (fallback when the remote CI cannot run). It
#   needs a clean tree and HEAD already pushed, so the status describes exactly the published commit.
# Env: CI_LOCAL_CACHE (default ~/.cache/ny-pi-ci: tools and venv, installed once), BASE_SHA (default
#      origin/main), CI_LOCAL_MAX_S (default 900: the whole run fails when it takes longer).
# Exit: 0 all green, 1 a gate failed, 124 time limit.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
cache=${CI_LOCAL_CACHE:-$HOME/.cache/ny-pi-ci}
max=${CI_LOCAL_MAX_S:-900}
base=${BASE_SHA:-origin/main}
export TOOLS_BIN=$cache/bin
mkdir -p "$cache"

need=()
for t in actionlint gitleaks trufflehog osv-scanner shellcheck shfmt biome rg; do
  [[ -x $TOOLS_BIN/$t ]] || need+=("$t")
done
if ((${#need[@]})); then bash scripts/ci/install-tools.sh "${need[@]}"; fi
venv=$cache/venv-$(sha256sum scripts/ci/requirements-ci.txt | cut -c1-16)
if [[ ! -x $venv/bin/python ]]; then
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet --require-hashes --no-deps -r scripts/ci/requirements-ci.txt
fi

mutation="" post=""
for arg in "$@"; do
  case $arg in
  --mutation) mutation=1 ;;
  --post) post=1 ;;
  *)
    echo "local-ci: unknown option $arg" >&2
    exit 2
    ;;
  esac
done
sha=$(git rev-parse HEAD)
if [[ -n $post ]]; then
  if [[ -n $(git status --porcelain) ]]; then
    echo "local-ci: --post needs a clean tree" >&2
    exit 2
  fi
  if [[ -z $(git branch -r --contains "$sha") ]]; then
    echo "local-ci: --post needs HEAD pushed" >&2
    exit 2
  fi
  repo=${BENCH_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
fi
publish() { # name state seconds
  [[ -n $post ]] || return 0
  gh api "repos/$repo/statuses/$sha" -f state="$2" -f context="$1" -f description="local-ci: $2 in ${3}s" >/dev/null
}

tmp=$(mktemp -d -p "$cache")
trap 'rm -r "$tmp"' EXIT
failed=()
gate() { # name cmd...
  local name=$1 start=$SECONDS left=$((max - SECONDS)) rc=0
  shift
  mkdir -p "$tmp/$name/home" "$tmp/$name/rt"
  if ((left <= 0)); then
    echo "local-ci: time limit of ${max}s reached before $name" >&2
    exit 124
  fi
  timeout "$left" env -u PI_BYPASS_PERMISSIONS CI=true BASE_SHA="$base" RUNNER_TEMP="$tmp/$name/rt" \
    HOME="$tmp/$name/home" LEAKS_LOG_OPTS=HEAD PATH="$TOOLS_BIN:$venv/bin:$PATH" "$@" >"$tmp/$name/log" 2>&1 || rc=$?
  if ((rc == 0)); then
    echo "ok    $name ($((SECONDS - start))s)"
    publish "$name" success $((SECONDS - start))
    return
  fi
  echo "FAIL  $name (exit $rc, $((SECONDS - start))s)"
  tail -n 40 "$tmp/$name/log"
  publish "$name" failure $((SECONDS - start))
  if ((rc == 124)); then exit 124; fi
  failed+=("$name")
}

gate ci-static bash scripts/ci/run-static.sh
gate ci-security bash scripts/ci/run-security.sh
gate instruction-budget python3 scripts/ci/instruction_budget.py check
if [[ -n $mutation ]]; then gate ci-mutation bash scripts/ci/run-static.sh mutation; fi

echo "local-ci: ${SECONDS}s of ${max}s"
if ((${#failed[@]})); then
  echo "local-ci FAILED: ${failed[*]}" >&2
  exit 1
fi
echo "local-ci OK"
