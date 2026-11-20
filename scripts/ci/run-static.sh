#!/usr/bin/env bash
# ci-static gate. Whole-repo checks: skill lint, refs, core-scope, oracles, python tests, diff coverage.
# Changed-files-only checks (legacy never blocks): ruff, mypy --strict, shellcheck, shfmt, markdownlint,
# structure limits. TypeScript is checked by `npm run check` (the root Biome config), not here.
# Every step runs; the exit code is non-zero if any failed.
# Modes: (none) = full gate; "mutation" = informational mutmut run on changed .py files.
# Env: BASE_SHA (see changed-files.sh), RUNNER_TEMP, CI.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
ROOT=$PWD
CIDIR=scripts/ci
TMP=${RUNNER_TEMP:-$(mktemp -d)}
export PATH="$HOME/.local/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
fails=()

step() { # name cmd...
  local name=$1 rc=0
  shift
  echo "::group::$name"
  "$@" || rc=$?
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then echo "ok   $name"; else
    echo "::error title=ci-static::$name failed (exit $rc)"
    fails+=("$name")
  fi
}

# import/ (history imported from ny-pi, removed in F12) and node_modules never take part in a lint.
mapfile -t CHANGED < <(bash "$CIDIR/changed-files.sh" | grep -vE '^import/|(^|/)node_modules/' || true)
echo "changed files: ${#CHANGED[@]} (base ${BASE_SHA:-auto})"

pick() { # ERE over paths -> existing changed files
  local f
  for f in "${CHANGED[@]}"; do
    [ -f "$f" ] && [[ $f =~ $1 ]] && printf '%s\n' "$f"
  done
}
pick_shell() {
  local f
  for f in "${CHANGED[@]}"; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    if [[ $f =~ \.(sh|bash)$ ]] || head -c 64 "$f" 2>/dev/null | grep -qE '^#!.*[/ ](ba)?sh([[:space:]]|$)'; then printf '%s\n' "$f"; fi
  done
}
# Benchmark task fixtures (repo/ stubs, hidden/ tests, oracle/ solutions) are agent inputs run in throwaway
# dirs and validated by bench/suites/check_oracles.py (no-op fails, oracle passes): no lint, typing, structure
# limit, coverage or mutation applies to them. The loose files of bench/suites follow the normal rules.
FIXTURE_RE='^bench/suites/[^/]+/[^/]+/(repo|hidden|oracle)/'
CHANGED_FILTERED=()
for f in "${CHANGED[@]}"; do [[ $f =~ $FIXTURE_RE ]] || CHANGED_FILTERED+=("$f"); done
CHANGED=("${CHANGED_FILTERED[@]}")
mapfile -t PY < <(pick '\.py$')
mapfile -t SH < <(pick_shell)
mapfile -t MD < <(pick '\.md$')

each() { # cmd... -- files...: run cmd once with all files, skip when none
  local args=() files=()
  while [ "$1" != -- ]; do
    args+=("$1")
    shift
  done
  shift
  files=("$@")
  [ "${#files[@]}" -gt 0 ] || {
    echo "(no changed files)"
    return 0
  }
  "${args[@]}" "${files[@]}"
}

mypy_changed() {
  local f rc=0
  [ "${#PY[@]}" -gt 0 ] || {
    echo "(no changed .py)"
    return 0
  }
  for f in "${PY[@]}"; do
    MYPYPATH=$(dirname "$f") mypy --strict --explicit-package-bases --follow-imports=silent \
      --cache-dir="$TMP/mypy" "$f" || rc=1
  done
  return $rc
}

pytest_cov() {
  # source=. + include_namespace_packages: unimported files count as 0% (no per-file exemption);
  # patch=subprocess measures hooks the tests run as child processes (guard.py), merged by combine
  printf '[run]\nrelative_files = True\nsource = .\npatch = subprocess\n[report]\ninclude_namespace_packages = True\nomit =\n  */node_modules/*\n  */.git/*\n  import/*\n  bench/suites/*/*/repo/*\n  bench/suites/*/*/hidden/*\n  bench/suites/*/*/oracle/*\n' >"$TMP/coveragerc"
  export COVERAGE_FILE="$TMP/.coverage"
  # Python test roots; the ones the migration has not created yet (hooks and harness tools: F8, bench: F3 bench lane)
  # are skipped until they exist, never dropped from the list.
  local roots=() d
  for d in scripts packages/coding-agent/resources/hooks scripts/harness bench; do
    [ -d "$d" ] && roots+=("$d")
  done
  COVERAGE_RCFILE="$TMP/coveragerc" coverage run -m pytest "${roots[@]}" -q -p no:cacheprovider &&
    COVERAGE_RCFILE="$TMP/coveragerc" coverage combine -q &&
    COVERAGE_RCFILE="$TMP/coveragerc" coverage xml -o "$TMP/coverage.xml"
}

diff_cover() {
  local base=${BASE_SHA:-}
  case $base in '' | 0000000000000000000000000000000000000000) base=$(git merge-base origin/main HEAD 2>/dev/null || git rev-parse HEAD~1) ;; esac
  diff-cover "$TMP/coverage.xml" --compare-branch="$base" --fail-under 80 \
    --exclude 'import/*' 'bench/suites/*/*/repo/*' 'bench/suites/*/*/hidden/*' 'bench/suites/*/*/oracle/*'
}

# bench/ comes from its own migration lane: the oracle check runs as soon as the directory exists.
bench_oracles() {
  [ -f bench/suites/check_oracles.py ] || {
    echo "(bench/suites/check_oracles.py not present yet)"
    return 0
  }
  python3 bench/suites/check_oracles.py
}

structure_changed() { printf '%s\n' "${CHANGED[@]}" | python3 "$CIDIR/lint/structure_changed.py" --root "$ROOT"; }

markdownlint() {
  local dir="$TMP/mdlint"
  mkdir -p "$dir"
  cp "$CIDIR/markdownlint/package.json" "$CIDIR/markdownlint/package-lock.json" "$dir/" || return 1
  (cd "$dir" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null) || return 1
  "$dir/node_modules/.bin/markdownlint-cli2" --config "$CIDIR/markdownlint.jsonc" "$@"
}

mutation() {
  local baseline="$CIDIR/mutmut-baseline.json" f stem dir t scratch score killed total base
  for f in "${PY[@]}"; do
    stem=$(basename "$f" .py)
    case $stem in test_* | *_test | conftest) continue ;; esac
    dir=$(dirname "$f")
    t=
    for c in "$dir/test_$stem.py" "$dir/${stem}_test.py" "$dir/tests/test_$stem.py"; do [ -f "$c" ] && t=$c && break; done
    [ -n "$t" ] || {
      echo "mutation: $f has no sibling test; skipped"
      continue
    }
    scratch=$(mktemp -d)
    git ls-files -z | tar --null -T - -cf - | tar -xf - -C "$scratch"
    printf '[mutmut]\nsource_paths=%s\nonly_mutate=%s\npytest_add_cli_args_test_selection=%s\n' "$dir" "$f" "$t" >"$scratch/setup.cfg"
    (
      cd "$scratch" && timeout 900 mutmut run >"$scratch/run.log" 2>&1
      mutmut export-cicd-stats >/dev/null 2>&1
    ) || true
    if [ ! -f "$scratch/mutants/mutmut-cicd-stats.json" ] || grep -q 'Stopping early' "$scratch/run.log"; then
      # mutmut 3 keys mutants by module path; tests that import a flat script dir via sys.path
      # (most of this repo) record other keys, so no score exists: say so, never report 0 or pass.
      echo "::warning title=mutation::$f not measured (mutmut could not map tests to mutants)"
      grep -m3 -E 'Stopping early|Recorded keys|Expected keys' "$scratch/run.log" || tail -3 "$scratch/run.log"
      if [ -n "$(jq -r --arg f "$f" '.[$f] // empty' "$baseline" 2>/dev/null || true)" ]; then fails+=("mutation:$f(not measured)"); fi
      continue
    fi
    killed=$(jq .killed "$scratch/mutants/mutmut-cicd-stats.json")
    total=$(jq .total "$scratch/mutants/mutmut-cicd-stats.json")
    [ "$total" -gt 0 ] || {
      echo "mutation: $f has 0 mutants"
      continue
    }
    score=$(awk -v k="$killed" -v t="$total" 'BEGIN{printf "%.4f", k/t}')
    base=$(jq -r --arg f "$f" '.[$f] // empty' "$baseline" 2>/dev/null || true)
    if [ -z "$base" ]; then
      echo "mutation: $f score=$score ($killed/$total) no baseline recorded: informational"
    elif awk -v s="$score" -v b="$base" 'BEGIN{exit !(s+0 < b+0)}'; then
      echo "::error title=mutation::$f score $score < baseline $base"
      fails+=("mutation:$f")
    else
      echo "mutation: $f score=$score >= baseline $base"
    fi
  done
}

if [ "${1:-}" = mutation ]; then
  mutation
  [ "${#fails[@]}" -eq 0 ]
  exit
fi

# The linter's self-test runs first: a broken checker must not vouch for the repo.
python3 -m pytest "$CIDIR" -q -p no:cacheprovider || {
  echo "::error title=ci-static::scripts/ci self-test failed"
  exit 1
}

# The skills directory arrives with F8: --allow-missing passes only while it does not exist yet.
step "skill-lint" python3 "$CIDIR/lint/skill_lint.py" --allow-missing packages/coding-agent/resources/skills
step "ruff check (changed)" each ruff check --isolated --no-cache -- "${PY[@]}"
step "ruff format (changed)" each ruff format --isolated --check --no-cache -- "${PY[@]}"
step "mypy --strict (changed)" mypy_changed
# -x: follow `# shellcheck source=` directives, so a changed script that sources an unchanged one is still checked.
step "shellcheck (changed)" each shellcheck -x -- "${SH[@]}"
step "shfmt -d (changed)" each shfmt -i 2 -d -- "${SH[@]}"
step "markdownlint (changed)" each markdownlint -- "${MD[@]}"
step "structure (changed)" structure_changed
step "check-refs" python3 scripts/check-refs.py
step "core-scope" python3 scripts/ci/lint/core_scope.py
step "bench oracles (no-op fails, oracle passes)" bench_oracles
step "pytest + coverage" pytest_cov
step "diff-cover >= 80" diff_cover

if [ "${#fails[@]}" -gt 0 ]; then
  echo "ci-static FAILED: ${fails[*]}"
  exit 1
fi
echo "ci-static OK"
