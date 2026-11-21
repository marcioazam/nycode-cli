#!/bin/sh
# Called as `impeccable_gate.sh hook` by pi's account settings (SessionStart, PostToolUse Edit|Write, Stop).
# Runs the package hook only in impeccable projects (.impeccable/, PRODUCT.md or DESIGN.md at the root).
# Env override (tests): IMPECCABLE_GATE_LAUNCHER.
launcher=${IMPECCABLE_GATE_LAUNCHER:-$HOME/.pi/agent/claude-home/skills/impeccable/scripts/impeccable}  # optional: needs the impeccable skill
[ -x "$launcher" ] && [ ! -d "$launcher" ] || exit 0
tmp=$(mktemp "${TMPDIR:-/tmp}/impeccable-gate.XXXXXX") || exit 0
trap 'rm -f "$tmp"' EXIT HUP INT TERM
cat > "$tmp"
cwd=$(jq -r '.cwd // empty' < "$tmp" 2>/dev/null)
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd=$PWD
root=$(timeout 2 git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
[ -d "$root/.impeccable" ] || [ -f "$root/PRODUCT.md" ] || [ -f "$root/DESIGN.md" ] || exit 0
"$launcher" hook < "$tmp"
