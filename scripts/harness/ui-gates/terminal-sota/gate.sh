#!/usr/bin/env bash
# Terminal-sota gate (u1..u4: prompt keys, /diff, sticky prompt, dev commands, tokyo-night). Read-only outside mktemp.
# Exits 0 only if all pass. Converted from ny-pi's claude-home/bin/tests/terminal-sota/gate.sh (12 checks). Map in
# ../README.md. Gone:
#  5 HUD colors: claude-hud is the owner's external dependency, not part of the product; F8 ports its tests.
#  7 check-agents, 10 check-instructions, 8 pi_harness_check, 9 harness-audit pytest: harness checks of the owner's
#    install; check-agents/check-instructions move with F8 (R15), the audit ones stay with the owner.
#  11 skill cua-driver: owner's skill in ~/.cua-driver, not a product command.
#  12 ~/.agents/skills empty: a property of the owner's machine.
# Needs: npm ci, npm run build, @vitest/coverage-v8, jq, rg.
set -u
ROOT=$(git rev-parse --show-toplevel) || exit 2
HERE=$ROOT/scripts/harness/ui-gates
W=$(mktemp -d)
trap 'find "$W" -delete 2>/dev/null' EXIT
FAIL=0
# shellcheck source=scripts/harness/ui-gates/lib.sh
. "$HERE/lib.sh"
unset NYCODE_SUBAGENT NYCODE_SUBAGENT_DEPTH
H=test/harness/extensions

r=$(vcov ui $H/ui/a11y.test.ts $H/ui/btw.test.ts $H/ui/diff.test.ts $H/ui/editor.test.ts $H/ui/history.test.ts \
  $H/ui/terminal.test.ts)
chk "1 ui (U1+U2) + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov dev-commands $H/dev-commands/copy-code.test.ts $H/dev-commands/keybindings.test.ts)
chk "2 dev-commands (U4) + cobertura>=80" "${r%%|*}" "${r#*|}"
r=$(vcov sticky-prompt $H/sticky-prompt/sticky.test.ts)
chk "3 sticky-prompt (U3) + cobertura>=80" "${r%%|*}" "${r#*|}"

TH=$CA/src/modes/interactive/theme
# 4: theme (tokyo-night.json and mono.json live beside the core themes, D-37) valid in the core schema with the official tokyonight.nvim colors (core loader, the one nycode runs).
cat >"$W/theme.mts" <<MJS
import { loadThemeFromPath, setThemeJsonValidator } from "$CA/src/modes/interactive/theme/theme.ts";
import { validateThemeJson } from "$CA/src/modes/interactive/theme/theme-schema.ts";
setThemeJsonValidator(validateThemeJson);
loadThemeFromPath("$TH/mono.json", "truecolor");
const t = loadThemeFromPath("$TH/tokyo-night.json", "truecolor");
const want = { syntaxKeyword: "157;124;216", syntaxOperator: "137;221;255", mdLink: "26;188;156", mdListBullet: "137;221;255", mdCode: "158;206;106" };
const bad = Object.entries(want).filter(([k, rgb]) => !t.getFgAnsi(k as never).includes(rgb)).map(([k]) => k);
console.log(bad.length ? "divergem: " + bad.join(" ") : "ok " + Object.keys(want).join(","));
process.exit(bad.length ? 1 : 0);
MJS
if [ -f "$TH/tokyo-night.json" ] && [ -f "$TH/mono.json" ]; then
  node "$W/theme.mts" >"$W/theme.out" 2>&1
  chk "4 tema tokyo-night (esquema + cores oficiais)" $? "$(tail -3 "$W/theme.out" | tr '\n' ' ')"
else
  chk "4 tema tokyo-night (esquema + cores oficiais)" 1 "esperado: falta F7 ui, tokyo-night.json ou mono.json ausente em src/modes/interactive/theme"
fi

f=$(structure)
chk "6 structure_changed.py" $? "$(echo "$f" | tail -3 | tr '\n' ' ')"

# 11: the binary loads the new commands (rpc, no model).
if [ ! -f "$CLI" ]; then
  chk "11 RPC get_commands (copy-code, keybindings, diff)" 1 "build ausente: npm run build"
else
  rpc_commands
  got=$(rg '"type":"response"' "$W/rpc.out" | head -1 | jq -r '.data.commands[] | select(.name | test("^(copy-code|keybindings|diff)$")) | .name' 2>/dev/null | sort | tr '\n' ' ')
  [ "$(echo "$got" | wc -w)" = 3 ]
  chk "11 RPC get_commands (copy-code, keybindings, diff)" $? "achou=[$got] (esperado: falta F7 ui enquanto faltarem)"
fi
echo "GATE_EXIT=$FAIL"
exit $FAIL
