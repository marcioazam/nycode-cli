#!/usr/bin/env bash
# Tests for install.sh in throwaway HOMEs.
#   (a) tampered manifest commit / wrong pi-code pin -> non-zero, nothing installed (AC4)
#   (b) --link dry-run, --apply, --restore -> tree byte-identical (AC5)
#   (c) PI_HARNESS_E2E_NET=1: full install, wrapper prints 1.5.2 and --help exits 0 (AC3)
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALL=$REPO/install.sh
fails=0
ok()   { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails+1)); }
WORK=$(mktemp -d)
trap 'rm -r "$WORK" </dev/null 2>/dev/null || true' EXIT
newhome() { mkdir -p "$WORK/$1"; printf '%s' "$WORK/$1"; }

# (a1) a divergent third-party commit aborts before anything is written
H=$(newhome a1)
sed '0,/"commit": "ef8ca48f/s//"commit": "0f8ca48f/' "$REPO/third-party.json" > "$H/manifest.json"
cmp -s "$H/manifest.json" "$REPO/third-party.json" && fail "a1 fixture not altered"
if HOME=$H PI_HARNESS_MANIFEST=$H/manifest.json bash "$INSTALL" >"$H/out" 2>&1; then fail "a1 install succeeded with tampered commit"
else ok "a1 tampered commit exits non-zero"; fi
grep -q 'ponytail' "$H/out" && ok "a1 error names the component" || fail "a1 error output: $(tail -n 2 "$H/out")"
[ ! -e "$H/.pi/agent/vendor/ponytail" ] && [ ! -e "$H/.pi" ] && ok "a1 nothing created under HOME/.pi" || fail "a1 dest created"

# (a2) pi-code pin other than 1.7.0 aborts (offline, repo copy with edited npm/)
H=$(newhome a2); R=$H/repo; mkdir -p "$R/scripts" "$R/npm"
cp "$INSTALL" "$R/"; cp "$REPO/scripts/install-lib.sh" "$R/scripts/"; cp "$REPO/third-party.json" "$R/"
sed 's/"pi-code": "1.7.0"/"pi-code": "1.7.1"/' "$REPO/npm/package.json" > "$R/npm/package.json"; cp "$REPO/npm/package-lock.json" "$R/npm/"
if HOME=$H bash "$R/install.sh" >"$H/out" 2>&1; then fail "a2 install succeeded with pi-code 1.7.1"
else grep -q 'expected 1.7.0' "$H/out" && ok "a2 wrong pi-code pin exits non-zero" || fail "a2 wrong failure: $(tail -n 2 "$H/out")"; fi
[ ! -e "$H/.pi" ] && ok "a2 nothing created" || fail "a2 created ~/.pi"

# (b) link / restore on a seeded tree
H=$(newhome b); A=$H/.pi/agent
mkdir -p "$A/claude-home/skills/tdd" "$A/claude-home/hooks" "$H/.local/bin" "$H/other"
echo 'personal wrapper' > "$H/.local/bin/pi"; chmod 755 "$H/.local/bin/pi"
echo 'personal contract' > "$A/claude-home/CLAUDE.md"
echo 'personal tdd' > "$A/claude-home/skills/tdd/SKILL.md"
echo 'target elsewhere' > "$H/other/guard.py"; ln -s "$H/other/guard.py" "$A/claude-home/hooks/guard.py"
echo '{"fake":"credential"}' > "$A/auth.json"; echo 'mine' > "$A/settings.json"
snap() { (cd "$H" && find . -path ./.pi-backup -prune -o \( -type f -printf 'f %p %m ' -exec sha256sum {} \; -o -type l -printf 'l %p -> %l\n' -o -type d -printf 'd %p\n' \) | sort); }
snap > "$WORK/b.before"
HOME=$H bash "$INSTALL" --link > "$WORK/b.dry" 2>&1
snap > "$WORK/b.afterdry"
cmp -s "$WORK/b.before" "$WORK/b.afterdry" && ok "b dry-run changes nothing" || fail "b dry-run modified HOME"
grep -q "^replace.*/.local/bin/pi$" "$WORK/b.dry" && grep -q '^replace.*claude-home/CLAUDE.md$' "$WORK/b.dry" && grep -q '^link' "$WORK/b.dry" \
  && ok "b dry-run reports replace and link" || fail "b dry-run output"
# extension npm ci would write ~/.npm into the temp HOME and need the registry; skipped here
HOME=$H PI_HARNESS_SKIP_EXT_DEPS=1 bash "$INSTALL" --link --apply >"$WORK/b.apply" 2>&1 || { fail "b --apply failed"; tail -n 5 "$WORK/b.apply"; }
[ "$(readlink "$H/.local/bin/pi")" = "$REPO/bin/pi" ] && [ -L "$A/claude-home/CLAUDE.md" ] && ok "b links created" || fail "b links missing"
[ "$(cat "$A/auth.json")" = '{"fake":"credential"}' ] && [ "$(cat "$A/settings.json")" = mine ] && ok "b auth.json and existing settings.json untouched" || fail "b protected files changed"
[ -f "$A/local.env" ] && [ "$(stat -c %a "$A/local.env")" = 600 ] && ok "b local.env template 0600" || fail "b local.env template"
BK=$(ls -d "$H"/.pi-backup/*/ | head -n 1)
[ -f "${BK}link-manifest.tsv" ] && [ "$(cat "${BK}replaced/.local/bin/pi")" = 'personal wrapper' ] && ok "b originals backed up before linking" || fail "b backup layout"
[ "$(stat -c %a "$H/.pi-backup")" = 700 ] && [ "$(stat -c %a "$BK")" = 700 ] && ok "b backup dirs 0700" || fail "b backup modes"
HOME=$H bash "$INSTALL" --link >"$WORK/b.dry2" 2>&1
grep -q '^link\|^replace' "$WORK/b.dry2" && fail "b second dry-run still wants changes" || ok "b second dry-run all skip(same)"
HOME=$H bash "$INSTALL" --restore >"$WORK/b.restore" 2>&1 || { fail "b --restore failed"; tail -n 5 "$WORK/b.restore"; }
snap > "$WORK/b.after"
diff "$WORK/b.before" "$WORK/b.after" >"$WORK/b.diff" && ok "b restore is byte-identical (sha256, modes, links, dirs)" || { fail "b restore differs"; head -n 10 "$WORK/b.diff"; }

# (c) full install over the network
if [ "${PI_HARNESS_E2E_NET:-0}" = 1 ]; then
  H=$(newhome c); start=$SECONDS
  HOME=$H bash "$INSTALL" >"$H/install.log" 2>&1 && HOME=$H bash "$INSTALL" --link --apply >"$H/link.log" 2>&1 || { fail "c install/link failed"; tail -n 8 "$H/install.log" "$H/link.log"; }
  v=$(HOME=$H "$H/.local/bin/pi" --version 2>"$H/v.err" | tail -n 1) || true
  [ "$v" = 1.5.2 ] && ok "c pi --version = 1.5.2" || fail "c pi --version printed '$v' ($(head -c 200 "$H/v.err"))"
  HOME=$H "$H/.local/bin/pi" --help >/dev/null 2>&1 && ok "c pi --help exit 0" || fail "c pi --help"
  [ "$(jq -r .version "$H/.pi/agent/npm/node_modules/pi-code/package.json")" = 1.7.0 ] && ok "c pi-code 1.7.0" || fail "c pi-code version"
  [ -f "$H/.pi/agent/vendor/ponytail/LICENSE" ] && [ -f "$H/.pi/agent/claude-home/vendor/ralph-loop/scripts/pi-ralph-start.sh" ] && ok "c third-party staged and patched" || fail "c third-party"
  echo "c elapsed $((SECONDS-start))s"
else
  echo "skip (c): set PI_HARNESS_E2E_NET=1"
fi
[ "$fails" -eq 0 ] && echo "ALL OK" || { echo "$fails FAILED"; exit 1; }
