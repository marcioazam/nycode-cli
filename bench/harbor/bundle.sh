#!/usr/bin/env bash
# Builds the nycode Harbor bundle (09 §2.2): the build of THIS checkout plus the owner layer of the arm stage, rooted
# at the container home (/opt/nycode-home). Usage: HOME=<stage> bundle.sh [OUT]; OUT defaults to
# /tmp/nycode-harness-bundle.tgz. The checkout must already be built (arms/nycode does `npm ci` + `npm run build`).
# Never includes credentials: only the files of overlay-nycode.list are copied from the stage, and the result is asserted.
#   .nycode/agent/              owner layer (settings.json, AGENTS.md)
#   .local/lib/nycode/          packages/coding-agent runtime: package.json, dist/bundle, theme/assets/export-html,
#                               docs, examples, README, CHANGELOG
#   .local/lib/nycode/node_modules/{jiti,@silvia-odwyer/photon-node}
#                               the only runtime packages build-coding-agent-bundle.mjs leaves external
set -euo pipefail
here=$(dirname "$(readlink -f "$0")")
repo=${NYCODE_REPO:-$(cd "$here/../.." && pwd)}
OUT=${1:-/tmp/nycode-harness-bundle.tgz}
pkg=$repo/packages/coding-agent
# shellcheck source=bench/arms/overlay-sha.sh
. "$here/../arms/overlay-sha.sh"

[ -f "$pkg/dist/bundle/cli.js" ] || {
  echo "bundle: $pkg/dist/bundle/cli.js missing; run 'npm run build' in $repo" >&2
  exit 1
}
[ -d "$HOME/.nycode/agent" ] || {
  echo "bundle: owner layer missing: $HOME/.nycode/agent (HOME must be the arm stage)" >&2
  exit 1
}
for m in jiti @silvia-odwyer/photon-node; do
  [ -d "$repo/node_modules/$m" ] || {
    echo "bundle: $repo/node_modules/$m missing; run 'npm ci --ignore-scripts'" >&2
    exit 1
  }
done

STAGE=$(mktemp -d)
trap 'rm -r "$STAGE"' EXIT
lib=$STAGE/.local/lib/nycode
mkdir -p "$STAGE/.nycode/agent" "$lib/dist/modes/interactive" "$lib/dist/core" "$lib/node_modules/@silvia-odwyer"
overlay_copy "$HOME/.nycode/agent" "$STAGE/.nycode/agent" "$here/../arms/overlay-nycode.list"
cp -a "$pkg/package.json" "$pkg/README.md" "$pkg/CHANGELOG.md" "$pkg/docs" "$pkg/examples" "$lib/"
cp -a "$pkg/dist/bundle" "$lib/dist/bundle"
cp -a "$pkg/dist/modes/interactive/theme" "$pkg/dist/modes/interactive/assets" "$lib/dist/modes/interactive/"
cp -a "$pkg/dist/core/export-html" "$lib/dist/core/export-html"
cp -a "$repo/node_modules/jiti" "$lib/node_modules/jiti"
cp -a "$repo/node_modules/@silvia-odwyer/photon-node" "$lib/node_modules/@silvia-odwyer/photon-node"
tar --sort=name -czf "$OUT" -C "$STAGE" .nycode/agent .local/lib/nycode

# Assert: no credential-looking path inside, and the launcher is there.
list=$(tar -tzf "$OUT")
bad=$(printf '%s\n' "$list" | grep -E '(^|/)(auth\.json|models\.json|mcp-auth\.json|trust\.json|credentials\.json|\.credentials\.json|secrets\.env|id_rsa|id_ed25519)[^/]*$|(^|/)\.ssh(/|$)|(^|/)\.env|\.bak|(^|/)(sessions|__pycache__)(/|$)' || true)
if [ -n "$bad" ]; then
  echo "BUNDLE ASSERT FAILED: forbidden paths inside $OUT:" >&2
  printf '%s\n' "$bad" | head -20 >&2
  exit 1
fi
printf '%s\n' "$list" | grep -qx '\.local/lib/nycode/dist/bundle/cli\.js' || {
  echo "BUNDLE ASSERT FAILED: dist/bundle/cli.js not in $OUT" >&2
  exit 1
}
echo "bundle ok: $OUT $(du -h "$OUT" | cut -f1), $(printf '%s\n' "$list" | wc -l) entries; no forbidden paths"
