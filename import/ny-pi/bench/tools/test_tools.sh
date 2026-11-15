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
"pr view"*"--json state"*) cat "$STUB_DIR/prstate" 2>/dev/null || echo OPEN ;;
"pr view"*) jq '.[0]' "$STUB_DIR/prs.json" ;;
"pr comment"*) echo "$*" >>"$STUB_DIR/comments" ;;
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

export STUB_DIR=$T PATH="$T/bin:$PATH" BENCH_REPO=repo-owner/ny-pi BENCH_REPO_URL="$T/origin.git" BENCH_STATE="$T/state" BENCH_CC_CREDENTIALS=/dev/null
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
reset() { rm -f "$T/calls" "$T/posts" "$T/status" "$T/prstate" "$T/comments"; }
runs() { if [ -e "$T/calls" ]; then grep -c ':: bench/run.py run ' "$T/calls"; else echo 0; fi; }

# 1. eligibility: fork and foreign author ignored (only PR 1 runs)
reset
prs
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "elegibilidade: só o PR do dono, mesmo repo" test "$(runs)" = 1
check "run no worktree do head, braço ny-pi tier pr" grep -q "/wt/$SHA :: bench/run.py run --arm ny-pi --tier pr --model claude-sonnet-5-5 --budget-usd 12 --out $T/state/runs/$SHA" "$T/calls"
check "gate contra baseline da main" grep -q "gate --base $T/state/base-main/docs/bench/baseline-main --cand $T/state/runs/$SHA" "$T/calls"
check "pending depois success" bash -c "sed -n 1p '$T/posts' | grep -q '^pending|' && sed -n 2p '$T/posts' | grep -q '^success|PASS'"
check "worktree removido" test -z "$(ls -A "$T/state/wt")"
check "resumo vai como comentário do PR" grep -q "pr comment 1 --repo repo-owner/ny-pi --body-file $T/state/runs/$SHA/summary.md" "$T/comments"
check "descrição do status sem caminho local" bash -c "! grep -q / '$T/posts'"

# 1b. a PR closed after the list was read is skipped
reset
echo CLOSED >"$T/prstate"
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "PR fechado durante a passada não roda" test "$(runs)" = 0

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
# an error that spent a round (NOT_COMPARABLE, NOT_VERIFIED) waits for a person; a cheap one retries
for d in "NOT_VERIFIED: orçamento esgotado" "NOT_COMPARABLE: re-rodar baseline main"; do
  reset
  echo "error $d" >"$T/status"
  bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
  check "error '${d%%:*}' não reroda sozinho" test "$(runs)" = 0
done
reset
echo "error run falhou (exit 2)" >"$T/status"
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "error sem gasto reprocessa" test "$(runs)" = 1

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

# --- overlay hash: a listed path that is absent (last entry included) is skipped, not a failure
mkdir -p "$T/ov" && echo a >"$T/ov/settings.json"
printf '# c\nsettings.json\nmissing/config.json\n' >"$T/ov.list"
printf 'settings.json\n' >"$T/ov2.list"
sha() { bash -c "set -euo pipefail; . '$here/../arms/overlay-sha.sh'; overlay_sha '$T/ov' '$1'"; }
check "overlay: caminho ausente no fim da lista não derruba" sha "$T/ov.list" >/dev/null
check "overlay: caminho ausente não muda o hash" test "$(sha "$T/ov.list")" = "$(sha "$T/ov2.list")"

# --- overlay hash does not follow the caller's locale (en_US sorts a before B, C sorts B before a)
mkdir -p "$T/loc" && echo 1 >"$T/loc/B.txt" && echo 2 >"$T/loc/a.txt"
printf 'B.txt\na.txt\n' >"$T/loc.list"
lsha() { LC_ALL=$1 bash -c ". '$here/../arms/overlay-sha.sh'; overlay_sha '$T/loc' '$T/loc.list'" 2>/dev/null; }
check "overlay: hash igual em C e en_US.UTF-8" test "$(lsha C)" = "$(lsha en_US.UTF-8)"
check "overlay: hash fixo para conteúdo fixo" test "$(lsha en_US.UTF-8)" = 85e7eb513cb87bce

# --- frozen overlay: same hash as the source, and an edit to the source afterwards does not reach the copy
frz() { bash -c "set -euo pipefail; . '$here/../arms/overlay-sha.sh'; overlay_freeze '$T/ov' '$T/frozen' '$T/ov.list'"; }
h=$(frz)
check "overlay congelado: mesmo hash da origem" test "$h" = "$(sha "$T/ov.list")"
echo b >"$T/ov/settings.json"
check "overlay congelado: edição na origem não muda a cópia" test "$(bash -c ". '$here/../arms/overlay-sha.sh'; overlay_sha '$T/frozen' '$T/ov.list'")" = "$h"
check "overlay congelado: não sobrescreve cópia existente" bash -c "! (. '$here/../arms/overlay-sha.sh'; overlay_freeze '$T/ov' '$T/frozen' '$T/ov.list') 2>/dev/null"

# --- overlay copy onto an existing stage (rebuild after a failed build): same paths, same hash, no dir/dir
mkdir -p "$T/ov/vendor/pkg" && echo x >"$T/ov/vendor/pkg/f"
printf 'settings.json\nvendor/pkg\n' >"$T/ov3.list"
cpy() { bash -c "set -euo pipefail; . '$here/../arms/overlay-sha.sh'; overlay_copy '$T/ov' '$T/stage' '$T/ov3.list'; overlay_sha '$T/stage' '$T/ov3.list'"; }
h=$(cpy)
check "overlay: cópia repetida mantém o hash" test -n "$h" -a "$(cpy)" = "$h"
check "overlay: cópia repetida não aninha diretório" test ! -e "$T/stage/vendor/pkg/pkg"

echo "falhas: $fails"
exit $((fails > 0))
