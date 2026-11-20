#!/usr/bin/env bash
# Builds /tmp/pi-harness-bundle.tgz: the pi harness (~/.pi/agent) + wrapper, rooted at $HOME.
# Never includes credentials; asserts it after building.
set -euo pipefail
OUT=${1:-/tmp/pi-harness-bundle.tgz}
H=$HOME
# A --link install is absolute symlinks into the repo (they would dangle in the container), while npm's
# node_modules/.bin entries are relative links whose scripts require their siblings (copying them breaks).
# rsync --copy-unsafe-links turns only links leaving the tree into files; tar then ships the copy as is.
STAGE=$(mktemp -d)
trap 'rm -r "$STAGE"' EXIT
rsync -a --copy-unsafe-links --relative \
  --exclude='/.pi/agent/sessions' \
  --exclude='/.pi/agent/checkpoints' \
  --exclude='/.pi/agent/plans' \
  --exclude='/.pi/agent/memory' \
  --exclude='/.pi/agent/claude-home/backups' \
  --exclude='/.pi/agent/claude-home/sessions' \
  --exclude='/.pi/agent/claude-home/projects' \
  --exclude='/.pi/agent/claude-home/plugins/claude-hud/pi-transcripts' \
  --exclude='/.pi/agent/claude-home/.credentials.json' \
  --exclude='auth.json*' --exclude='mcp-auth.json*' --exclude='trust.json*' \
  --exclude='*.bak*' --exclude='.env*' --exclude='__pycache__' \
  "$H/./.pi/agent" "$H/./.local/bin/pi" "$STAGE/" || [ $? -eq 24 ] # 24 = a live file vanished while read: tolerated
tar -czf "$OUT" -C "$STAGE" .pi/agent .local/bin/pi

# Assert: nothing excluded or secret-looking is inside (exact credential file names, excluded dirs, key dirs).
bad=$(tar -tzf "$OUT" | grep -E '^\.pi/agent/(sessions|checkpoints|plans|memory)(/|$)|^\.pi/agent/claude-home/(sessions|projects|backups|plugins/claude-hud/pi-transcripts)(/|$)|(^|/)__pycache__(/|$)|(^|/)\.ssh(/|$)|(^|/)(auth\.json|mcp-auth\.json|trust\.json|credentials\.json|\.credentials\.json|secrets\.env|id_rsa|id_ed25519)[^/]*$|\.bak|(^|/)\.env' || true)
if [ -n "$bad" ]; then
  echo "BUNDLE ASSERT FAILED: forbidden paths inside $OUT:" >&2
  printf '%s\n' "$bad" | head -20 >&2
  exit 1
fi
echo "bundle ok: $OUT $(du -h "$OUT" | cut -f1), $(tar -tzf "$OUT" | wc -l) entries; no forbidden paths"
