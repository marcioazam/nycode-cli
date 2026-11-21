#!/usr/bin/env bash
# Final gate of the ui task (proof that nycode looks like ny-pi). Read-only outside mktemp. Exits 0 only if all pass.
# Converted from the ny-pi gate (claude-home/bin/tests/pi-ui-final-gate.sh, 14 checks). Map in README.md. Gone:
#  4 hud: claude-hud is the owner's external dependency; its tests move with F8 (R13/R14).
#  6 hooks, 6 dispatch: python hook tests move with F8 (R10) and run in run-static's pytest.
#  7 bash -n wrapper: bin/pi is absorbed by the core (K01); check 13 runs the built binary instead.
#  9 check-instructions: moves with F8 (R15).
#  10-12 patch stack: the code is now source in this repo (F5/F6); the proof is git itself.
# Needs: npm ci, npm run build, @vitest/coverage-v8, jq, rg.
set -u
ROOT=$(git rev-parse --show-toplevel) || exit 2
HERE=$ROOT/scripts/harness/ui-gates
W=$(mktemp -d)
trap 'find "$W" -delete 2>/dev/null' EXIT
FAIL=0
# shellcheck source=scripts/harness/ui-gates/lib.sh
. "$HERE/lib.sh"
unset NYCODE_SUBAGENT

# 14: the gate must not touch the tree; compared before and after.
B=$(cd "$ROOT" && git status --porcelain | sha256sum | cut -c1-16)
echo "arvore antes: $B"

H=test/harness
r=$(vcov ui $H/extensions/ui/a11y.test.ts $H/extensions/ui/btw.test.ts $H/extensions/ui/diff.test.ts \
  $H/extensions/ui/editor.test.ts $H/extensions/ui/history.test.ts $H/extensions/ui/terminal.test.ts \
  $H/extensions/ui/index.test.ts)
chk "1 ui tests + cobertura>=80" "${r%%|*}" "${r#*|}"

r=$(vcov ui-visual $H/extensions/ui-visual/header.test.ts $H/extensions/ui-visual/icons.test.ts \
  $H/extensions/ui-visual/index.test.ts $H/extensions/ui-visual/tools.test.ts $H/extensions/ui-visual/working.test.ts)
chk "1b ui-visual tests + cobertura>=80" "${r%%|*}" "${r#*|}"

# 2: the three pi-code patches of the task (rewind-tree, todo-collapse, notify-focus) are core extensions now.
r=$(vcov git-checkpoint $H/git-checkpoint/git-checkpoint.test.ts)
chk "2 git-checkpoint (rewind-tree) + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov todo $H/todo/todo-collapse.test.ts $H/extensions/todo/stale-reminder.test.ts)
chk "2 todo (todo-collapse) + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov notify $H/notify/notify-focus.test.ts $H/extensions/notify/index.test.ts)
chk "2 notify (notify-focus) + cobertura>=80" "${r%%|*}" "${r#*|}"

# 3: every harness test of the package (was: every pi-code test).
(cd "$CA" && env -u OPENROUTER_API_KEY timeout 900 npx vitest --run $H >"$W/all.log" 2>&1)
chk "3 vitest test/harness (todos)" $? "$(rg '^ +(Test Files|Tests) ' "$W/all.log" | tr -s ' ' | tr '\n' ' ')"

r=$(vcov sound-notify $H/extensions/sound-notify/index.test.ts)
chk "5 som + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov syntax-check $H/extensions/syntax-check/index.test.ts)
chk "5 syntax-check + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov docs-pointer $H/extensions/docs-pointer/index.test.ts)
chk "5 docs-pointer + cobertura>=80" "${r%%|*}" "${r#*|}"

f=$(structure)
chk "8 structure_changed.py" $? "$(echo "$f" | tail -3 | tr '\n' ' ')"

# 13: the repo binary starts without a warning (no model: the rpc handshake stands in for `-p`).
ec=0
if [ ! -f "$CLI" ]; then
  ec=1
  info="build ausente: npm run build"
else
  rpc_commands
  rg -q '"type":"response".*"success":true' "$W/rpc.out" || ec=1
  [ ! -s "$W/rpc.err" ] || ec=1
  info="resposta=$(rg -c '"type":"response"' "$W/rpc.out") stderr=[$(head -c 200 "$W/rpc.err")]"
fi
chk "13 nycode sem aviso (rpc get_commands)" $ec "$info"

D=$(cd "$ROOT" && git status --porcelain | sha256sum | cut -c1-16)
[ "$B" = "$D" ]
chk "14 arvore inalterada durante o gate" $? "antes=$B depois=$D"
echo "GATE_EXIT=$FAIL"
exit $FAIL
