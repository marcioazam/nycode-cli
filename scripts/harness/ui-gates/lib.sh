#!/usr/bin/env bash
# Shared helpers of the ui gates (sourced, never run). Read-only outside the mktemp dir $W.
# Needs: ROOT (repo root), W (scratch dir), FAIL (counter the caller owns).
CA=$ROOT/packages/coding-agent
CLI=$CA/dist/bundle/cli.js

# shellcheck disable=SC2034 # FAIL is read by the sourcing gate
chk() {
  local name=$1 ec=$2 info=$3
  if [ "$ec" = 0 ]; then
    echo "PASS $name: $info"
  else
    echo "FAIL $name (exit $ec): $info"
    FAIL=1
  fi
}

# vcov <extension dir> <vitest test path>...: runs the vitest files (paths relative to packages/coding-agent) with
# v8 coverage on src/extensions/<dir>/ and requires every file there at >= 80% lines. Prints "ec|summary".
vcov() {
  local x=$1 miss="" t out ec low n ok
  shift
  for t in "$@"; do [ -e "$CA/$t" ] || miss="$miss $t"; done
  if [ -n "$miss" ]; then
    echo "1|esperado: falta F7 ui, arquivos ausentes:$miss"
    return
  fi
  if [ ! -d "$ROOT/node_modules/@vitest/coverage-v8" ]; then
    echo "1|@vitest/coverage-v8 nao instalado (devDependency ausente)"
    return
  fi
  out=$W/cov-$x
  (cd "$CA" && env -u OPENROUTER_API_KEY timeout 600 npx vitest --run --coverage --coverage.provider=v8 \
    --coverage.reporter=json-summary --coverage.reportsDirectory="$out" \
    --coverage.include="src/extensions/$x/**" "$@" >"$W/v.log" 2>&1)
  ec=$?
  n=$(jq '[keys[] | select(. != "total")] | length' "$out/coverage-summary.json" 2>/dev/null || echo 0)
  low=$(jq '[to_entries[] | select(.key != "total" and .value.lines.pct < 80)] | length' "$out/coverage-summary.json" 2>/dev/null || echo 1)
  ok=1
  [ "$ec" = 0 ] && [ "$n" -gt 0 ] && [ "$low" = 0 ] && ok=0
  echo "$ok|$(rg '^ +Tests ' "$W/v.log" | tr -s ' ') arquivos=$n abaixo80=$low $(tail -3 "$W/v.log" | tr '\n' ' ' | cut -c1-200)"
}

# structure: size and file-count limits on the files nycode owns (same checker CI runs on changed files).
structure() {
  local res=resources
  (cd "$ROOT" && git ls-files packages/coding-agent/src/extensions packages/coding-agent/test/harness \
    "packages/coding-agent/$res" scripts/harness | python3 scripts/ci/lint/structure_changed.py --root "$ROOT" 2>&1)
}

# rpc_commands: asks the repo binary (isolated HOME and agent dir, offline, no model) for get_commands.
rpc_commands() {
  mkdir -p "$W/home" "$W/agent"
  (cd "$W" && {
    sleep 4
    echo '{"id":"q1","type":"get_commands"}'
    sleep 10
  } |
    HOME=$W/home NYCODE_CODING_AGENT_DIR=$W/agent NYCODE_OFFLINE=1 timeout 60 node "$CLI" --mode rpc --no-session >"$W/rpc.out" 2>"$W/rpc.err")
}
