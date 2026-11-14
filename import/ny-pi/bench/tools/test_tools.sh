#!/usr/bin/env bash
# Offline tests for bench-pr.sh and vanilla-retest.sh: fake `gh` and `python3` (bench/run.py) on PATH, local bare origin.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  fails=$((fails + 1))
}
check() { # name, command...
  local name=$1
  shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}

# --- origin with a main baseline and one PR commit
git init -q "$T/w" -b main
(
  cd "$T/w" || exit 1
  git config user.email t@t && git config user.name t
  mkdir -p docs/bench/baseline-main bench
  echo '{}' >docs/bench/baseline-main/runs.jsonl
  echo x >bench/run.py
  git add -A && git commit -qm base
  git checkout -qb pr && echo y >f && git add -A && git commit -qm pr
) >/dev/null
git clone -q --bare "$T/w" "$T/origin.git"
SHA=$(git -C "$T/w" rev-parse pr)

# --- stubs
mkdir "$T/bin"
cat >"$T/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
"api repos/"*"/commits/"*"/statuses"*) cat "$STUB_DIR/status" 2>/dev/null || true ;;
"api repos/"*) echo repo-owner ;;
"pr list"*) cat "$STUB_DIR/prs.json" ;;
"pr view"*) jq '.[0]' "$STUB_DIR/prs.json" ;;
esac
STUB
cat >"$T/bin/python3" <<'STUB'
#!/usr/bin/env bash
echo "$PWD :: $*" >>"$STUB_DIR/calls"
case "$2" in
run) exit "${STUB_RUN_RC:-0}" ;;
gate) echo "## bench-pr"; exit "${STUB_GATE_RC:-0}" ;;
post-status) echo "$*" | sed -n 's/.*--state \([a-z]*\) --description \(.*\)/\1|\2/p' >>"$STUB_DIR/posts" ;;
esac
STUB
chmod +x "$T/bin/gh" "$T/bin/python3"

export STUB_DIR=$T PATH="$T/bin:$PATH" BENCH_REPO=repo-owner/pi-harness BENCH_REPO_URL="$T/origin.git" BENCH_STATE="$T/state" BENCH_CC_CREDENTIALS=/dev/null
unset BENCH_BASELINE_MAIN

prs() { # extra jq-ish entries appended to a single eligible PR
  cat >"$T/prs.json" <<JSON
[
 {"number":1,"headRefOid":"$SHA","author":{"login":"repo-owner"},"isCrossRepository":false},
 {"number":2,"headRefOid":"$SHA","author":{"login":"repo-owner"},"isCrossRepository":true},
 {"number":3,"headRefOid":"$SHA","author":{"login":"stranger"},"isCrossRepository":false}
]
JSON
}
reset() { rm -f "$T/calls" "$T/posts" "$T/status"; }
runs() { if [ -e "$T/calls" ]; then grep -c ' run ' "$T/calls"; else echo 0; fi; }

# 1. eligibility: fork and foreign author ignored (only PR 1 runs)
reset
prs
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "elegibilidade: só o PR do dono, mesmo repo" test "$(runs)" = 1
check "run no worktree do head, braço my-pi tier pr" grep -q "/wt/$SHA :: bench/run.py run --arm my-pi --tier pr --model claude-sonnet-5-5 --budget-usd 12 --out $T/state/runs/$SHA" "$T/calls"
check "gate contra baseline da main" grep -q "gate --base $T/state/base-main/docs/bench/baseline-main --cand $T/state/runs/$SHA" "$T/calls"
check "pending depois success" bash -c "sed -n 1p '$T/posts' | grep -q '^pending|' && sed -n 2p '$T/posts' | grep -q '^success|PASS'"
check "worktree removido" test -z "$(ls -A "$T/state/wt")"

# 2. final status ignored
for s in success failure; do
  reset
  echo "$s" >"$T/status"
  bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
  check "status final $s ignorado" test "$(runs)" = 0
done
reset
echo pending >"$T/status"
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "status pending reprocessa" test "$(runs)" = 1

# 3. gate exit -> state
for pair in 0:success 1:failure 3:failure 4:error 5:error; do
  reset
  STUB_GATE_RC=${pair%%:*} bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
  check "gate exit ${pair%%:*} -> ${pair##*:}" test "$(sed -n 's/^\([a-z]*\)|.*/\1/p' "$T/posts" | tail -1)" = "${pair##*:}"
done
reset
STUB_RUN_RC=7 bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "run falho -> error sem gate" bash -c "! grep -q ' gate ' '$T/calls' && grep -q '^error|run falhou' '$T/posts'"

# 4. fail closed without baseline
reset
BENCH_BASELINE_MAIN="$T/nope" bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "sem baseline: error 'baseline main ausente'" grep -q '^error|baseline main ausente' "$T/posts"
check "sem baseline: não roda" test "$(runs)" = 0

# 5. lock
reset
flock "$T/state/lock" sleep 2 &
sleep 0.5
out=$(bash "$here/bench-pr.sh" --poll 2>&1)
check "lock: segunda execução não roda" bash -c "[ ! -e '$T/calls' ] && grep -q 'in progress' <<<'$out'"
wait

# 6. credentials / vanilla
check "sem BENCH_CC_CREDENTIALS falha" bash -c "! env -u BENCH_CC_CREDENTIALS bash '$here/bench-pr.sh' --poll >/dev/null 2>&1"
check "vanilla-retest sem --budget-usd falha" bash -c "! bash '$here/vanilla-retest.sh' >/dev/null 2>&1"
reset
out=$(bash "$here/vanilla-retest.sh" --budget-usd 10 2>&1)
check "vanilla roda os 2 braços com US\$5 cada" test "$(grep -c -- '--tier vanilla --model claude-sonnet-5-5 --budget-usd 5.00' "$T/calls")" = 2
check "vanilla imprime comando de report" grep -q 'bench/run.py report --runs .* --out docs/bench/BASELINE-VANILLA-' <<<"$out"
check "vanilla não sobrescreve" bash -c "! bash '$here/vanilla-retest.sh' --budget-usd 10 >/dev/null 2>&1"

echo "falhas: $fails"
exit $((fails > 0))
