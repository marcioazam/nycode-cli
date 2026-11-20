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
affects) cat "$STUB_DIR/affects" 2>/dev/null || echo functional ;;
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
check "sem BENCH_CC_CREDENTIALS nem BENCH_API_KEY_FILE falha" bash -c "! env -u BENCH_CC_CREDENTIALS -u BENCH_API_KEY_FILE bash '$here/bench-pr.sh' --poll >/dev/null 2>&1"
reset
prs
BENCH_API_KEY_FILE=/dev/null bash -c "unset BENCH_CC_CREDENTIALS; bash '$here/bench-pr.sh' --poll" >/dev/null 2>&1
check "modo API dispensa BENCH_CC_CREDENTIALS" test "$(runs)" = 1

# 7. non-functional PR: success N/A + comment, no benchmark
reset
prs
printf 'non-functional\n- docs/a.md: docs/tooling\n' >"$T/affects"
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "não funcional: não roda benchmark" test "$(runs)" = 0
check "não funcional: success N/A sem pending" bash -c "[ \"\$(wc -l <'$T/posts')\" = 1 ] && grep -q '^success|N/A: sem mudança funcional' '$T/posts'"
check "não funcional: comentário lista os arquivos" bash -c "grep -q 'pr comment 1 --repo repo-owner/ny-pi --body-file' '$T/comments' && grep -q 'docs/a.md' '$T/state/runs/$SHA/na.md'"
check "não funcional: worktree removido" test -z "$(ls -A "$T/state/wt")"
reset
printf 'garbage\n' >"$T/affects"
bash "$here/bench-pr.sh" --poll >/dev/null 2>&1
check "veredito ilegível: fail closed roda" test "$(runs)" = 1
rm -f "$T/affects"
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

# --- API-key mode in the local arms (s1/s4/s5): key from BENCH_API_KEY_FILE, workspace header, no plan OAuth
A="$here/../arms"
RPY=$(PATH=${PATH#"$T/bin:"} command -v python3) # the global PATH carries a fake python3
mkdir -p "$T/rb" && ln -s "$RPY" "$T/rb/python3"
mkdir -p "$T/ak"
printf 'sk-ant-fake\n' >"$T/ak/key"
: >"$T/ak/empty"
printf '{"claudeAiOauth":{"accessToken":"oauth-fake","expiresAt":99999999999999}}' >"$T/ak/cred.json"
# Fake binary: prints the auth env and, when present, $PI_CODING_AGENT_DIR/models.json (or $HOME/.pi/agent).
cat >"$T/ak/fake" <<'SH'
#!/usr/bin/env bash
env | grep -E '^(ANTHROPIC_|CLAUDE_CODE_OAUTH)' | sort
for f in "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/models.json"; do [ -f "$f" ] && cat "$f"; done
exit 0
SH
chmod +x "$T/ak/fake"
printf '{"providers":{"anthropic":{"baseUrl":"keep","headers":{"x-a":"1"}},"other":{}}}\n' >"$T/ak/models.json"
mkdir -p "$T/ak/stage/.local/bin" "$T/ak/stage/.pi/agent"
cp "$T/ak/fake" "$T/ak/stage/.local/bin/pi"
touch "$T/ak/stage/.ready"
arm() { # arm [VAR=value...]: runs it with the fake binaries and no inherited auth
  local a=$1
  shift
  env -u ANTHROPIC_API_KEY -u ANTHROPIC_OAUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u BENCH_API_KEY_FILE -u BENCH_ANTHROPIC_WORKSPACE_ID \
    PATH="$T/rb:$PATH" BENCH_CC_CREDENTIALS="$T/ak/cred.json" BENCH_CC_BIN="$T/ak/fake" BENCH_CC_VANILLA_DIR="$T/ak/cc" \
    BENCH_PI_BIN="$T/ak/fake" BENCH_PI_VANILLA_DIR="$T/ak/pv" BENCH_STAGE="$T/ak/stage" BENCH_REAL_HOME="$T/ak/rh" \
    "$@" bash "$A/$a" 2>&1
}
cp "$T/ak/models.json" "$T/ak/pv-models.json"
mkdir -p "$T/ak/pv" && cp "$T/ak/models.json" "$T/ak/pv/models.json"
WS=wrkspc_fake
out=$(arm claude-vanilla BENCH_API_KEY_FILE="$T/ak/key" BENCH_ANTHROPIC_WORKSPACE_ID=$WS CLAUDE_CODE_OAUTH_TOKEN=leak)
check "api/cc: chave de API e cabeçalho do workspace" bash -c "grep -qx 'ANTHROPIC_API_KEY=sk-ant-fake' <<<'$out' && grep -qx 'ANTHROPIC_CUSTOM_HEADERS=anthropic-workspace-id: $WS' <<<'$out'"
check "api/cc: sem OAuth" bash -c "! grep -q OAUTH <<<'$out'"
out=$(arm pi-vanilla BENCH_API_KEY_FILE="$T/ak/key" BENCH_ANTHROPIC_WORKSPACE_ID=$WS ANTHROPIC_OAUTH_TOKEN=leak)
check "api/pi-vanilla: chave de API, sem OAuth" bash -c "grep -qx 'ANTHROPIC_API_KEY=sk-ant-fake' <<<'$out' && ! grep -q OAUTH <<<'$out'"
check "api/pi-vanilla: models.json ganha o cabeçalho e preserva o resto" "$RPY" -c "
import json; a=json.load(open('$T/ak/pv/models.json'))['providers']
assert a['anthropic']['headers']=={'x-a':'1','anthropic-workspace-id':'$WS'} and a['anthropic']['baseUrl']=='keep' and 'other' in a"
out=$(arm ny-pi BENCH_API_KEY_FILE="$T/ak/key" BENCH_ANTHROPIC_WORKSPACE_ID=$WS ANTHROPIC_OAUTH_TOKEN=leak)
check "api/ny-pi: chave de API, sem OAuth, cabeçalho no models.json do stage" bash -c "grep -qx 'ANTHROPIC_API_KEY=sk-ant-fake' <<<'$out' && ! grep -q OAUTH <<<'$out' && grep -q '$WS' $T/ak/stage/.pi/agent/models.json"
arm ny-pi BENCH_API_KEY_FILE="$T/ak/key" BENCH_ANTHROPIC_WORKSPACE_ID=$WS >/dev/null
check "api/ny-pi: repetir é idempotente" "$RPY" -c "
import json; h=json.load(open('$T/ak/stage/.pi/agent/models.json'))['providers']['anthropic']['headers']
assert h=={'anthropic-workspace-id':'$WS'}"
out=$(arm pi-vanilla BENCH_API_KEY_FILE="$T/ak/key")
check "api/pi-vanilla: sem workspace não é erro" bash -c "grep -qx 'ANTHROPIC_API_KEY=sk-ant-fake' <<<'$out'"
rm -f "$T/ak/stage/.pi/agent/models.json"
arm ny-pi BENCH_API_KEY_FILE="$T/ak/key" >/dev/null
check "api/ny-pi: sem workspace não cria models.json" test ! -e "$T/ak/stage/.pi/agent/models.json"
for a in claude-vanilla pi-vanilla ny-pi; do
  out=$(arm $a)
  check "sem chave/$a: segue no OAuth do plano" bash -c "grep -q 'OAUTH.*=oauth-fake' <<<'$out' && ! grep -q ANTHROPIC_API_KEY <<<'$out'"
  check "chave vazia/$a: falha com mensagem" bash -c "! o=\$(env BENCH_API_KEY_FILE='$T/ak/empty' bash -c \"BENCH_CC_BIN='$T/ak/fake' BENCH_PI_BIN='$T/ak/fake' BENCH_STAGE='$T/ak/stage' BENCH_CC_VANILLA_DIR='$T/ak/cc' BENCH_PI_VANILLA_DIR='$T/ak/pv' BENCH_REAL_HOME='$T/ak/rh' bash '$A/$a'\" 2>&1) && grep -q 'bench: BENCH_API_KEY_FILE' <<<\"\$o\""
done
check "overlay: models.json do stage não entra no hash" bash -c "! grep -qx 'models.json' '$A/overlay.list'"

# Parallel runs share the ny-pi stage: concurrent merges never expose a half-written models.json to readers.
# shellcheck disable=SC2329 # invoked through check
race() {
  local m=$T/race/models.json i
  mkdir -p "$T/race" && printf '{"providers":{"anthropic":{"baseUrl":"keep"}}}' >"$m"
  for i in $(seq 1 30); do
    (PATH=$T/rb:$PATH BENCH_ANTHROPIC_WORKSPACE_ID=ws$((i % 2)) bash -c ". '$A/oauth-token.sh'; bench_pi_workspace_header '$m'") &
    ("$RPY" -c "import json,sys
for _ in range(300): json.load(open(sys.argv[1]))" "$m" || touch "$T/race/bad") &
  done
  wait
  [ ! -e "$T/race/bad" ] && "$RPY" -c "import json,sys; json.load(open(sys.argv[1]))['providers']['anthropic']['baseUrl']" "$m"
}
check "api/ny-pi: merges paralelos do cabeçalho não corrompem o models.json" race

echo "falhas: $fails"
exit $((fails > 0))
