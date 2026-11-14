# shellcheck shell=bash
# Sourced by the vanilla arms: prints the Claude OAuth access token read at run time from
# BENCH_CC_CREDENTIALS (default ~/.claude/.credentials.json). Nothing is copied or refreshed here;
# refuses when fewer than 30 min remain so a benchmark batch does not die mid-run.
bench_oauth_token() {
  BENCH_CC_CREDENTIALS="${BENCH_CC_CREDENTIALS:-$HOME/.claude/.credentials.json}" python3 - <<'PY'
import json, os, sys, time
o = json.load(open(os.environ["BENCH_CC_CREDENTIALS"]))["claudeAiOauth"]
if o["expiresAt"] / 1000 - time.time() < 1800:
    sys.exit("bench: OAuth token expires in <30 min; open Claude Code with that account to refresh it")
print(o["accessToken"])
PY
}
