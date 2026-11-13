#!/usr/bin/env bash
# run.sh <pi-harness|claude-code> <job-name> [harbor args...]   (no set -x: the token must never be echoed)
set -euo pipefail
arm=${1:?arm: pi-harness|pi-vanilla|claude-code}; job=${2:?job name}; shift 2
here=$(cd "$(dirname "$0")" && pwd)
creds=$HOME/.claude-2/.credentials.json
token=$(/usr/bin/jq -er .claudeAiOauth.accessToken "$creds")
case "$arm" in
  pi-harness)
    "$here/bundle.sh" >/dev/null
    export ANTHROPIC_OAUTH_TOKEN=$token
    export PYTHONPATH="$here${PYTHONPATH:+:$PYTHONPATH}"
    agent=(-a pi_harness_agent:PiHarnessAgent) ;;
  pi-vanilla)  # Harbor's built-in pi from npm, no harness: separates harness effects from pi itself
    export ANTHROPIC_OAUTH_TOKEN=$token
    agent=(-a pi --ak version=1.5.2) ;;
  claude-code)
    export CLAUDE_CODE_OAUTH_TOKEN=$token CLAUDE_FORCE_OAUTH=1
    agent=(-a claude-code) ;;
  *) echo "unknown arm: $arm" >&2; exit 2 ;;
esac
unset token
mkdir -p $HOME/.local/state/harbor-jobs
exec uvx --from harbor harbor run -d terminal-bench@2.0 -m anthropic/claude-opus-5-5 \
  "${agent[@]}" --job-name "$job" -o $HOME/.local/state/harbor-jobs "$@"
