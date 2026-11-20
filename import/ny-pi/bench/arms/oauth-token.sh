# shellcheck shell=bash
# Sourced by the arms. Two auth modes:
# - API-key mode (BENCH_API_KEY_FILE set): bench_api_key prints the key from that file and
#   bench_pi_workspace_header adds BENCH_ANTHROPIC_WORKSPACE_ID to a pi models.json; the arm never touches
#   the plan's OAuth.
# - Plan mode: bench_oauth_token prints the Claude OAuth access token read at run time from
#   BENCH_CC_CREDENTIALS (default ~/.claude/.credentials.json). Nothing is copied or refreshed here;
#   refuses when fewer than 30 min remain so a benchmark batch does not die mid-run.
bench_oauth_token() {
  BENCH_CC_CREDENTIALS="${BENCH_CC_CREDENTIALS:-$HOME/.claude/.credentials.json}" python3 - <<'PY'
import json, os, sys, time
o = json.load(open(os.environ["BENCH_CC_CREDENTIALS"]))["claudeAiOauth"]
if o["expiresAt"] / 1000 - time.time() < 1800:
    sys.exit("bench: OAuth token expires in <30 min; open Claude Code with that account to refresh it")
print(o["accessToken"])
PY
}

# Prints the API key held in $BENCH_API_KEY_FILE; refuses an unreadable or empty file.
bench_api_key() {
  local key
  key=$(tr -d '[:space:]' <"$BENCH_API_KEY_FILE" 2>/dev/null) || key=
  [ -n "$key" ] || {
    echo "bench: BENCH_API_KEY_FILE is unreadable or empty" >&2
    return 1
  }
  printf '%s\n' "$key"
}

# Merges $BENCH_ANTHROPIC_WORKSPACE_ID into providers.anthropic.headers of the pi models.json $1,
# keeping the rest of the file. No-op without a workspace id.
bench_pi_workspace_header() {
  [ -n "${BENCH_ANTHROPIC_WORKSPACE_ID:-}" ] || return 0
  mkdir -p "$(dirname "$1")"
  python3 - "$1" <<'PY'
import json, os, sys
p = sys.argv[1]
ws = os.environ["BENCH_ANTHROPIC_WORKSPACE_ID"]
d = json.load(open(p)) if os.path.exists(p) else {}
h = d.setdefault("providers", {}).setdefault("anthropic", {}).setdefault("headers", {})
if h.get("anthropic-workspace-id") != ws:
    # Parallel runs share the stage: write a temp file and rename, so no reader sees a half-written file.
    h["anthropic-workspace-id"] = ws
    t = f"{p}.{os.getpid()}.tmp"
    json.dump(d, open(t, "w"), indent=2)
    os.replace(t, p)
PY
}
