#!/usr/bin/env bash
# `biome check --write` on a tree (root, apps/p2, apps/p3), the formatting the fork rename carries (08 section 4.3).
# Biome is the caller's: <repository of this script>/node_modules/.bin/biome, the version pinned in its package.json.
# Exit 1 from biome only means diagnostics are left after the formatting was applied, so it is not fatal here.
# Usage: biome.sh ROOT
set -euo pipefail
export LC_ALL=C
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(cd "${1:?usage: biome.sh ROOT}" && pwd)
biome=$(cd "$here/../.." && pwd)/node_modules/.bin/biome
[ -x "$biome" ] || {
  echo "biome.sh: $biome missing; run npm ci --ignore-scripts in the repository that holds this script" >&2
  exit 2
}
log=$(mktemp)
trap 'rm "$log"' EXIT
for d in . apps/p2 apps/p3; do
  (cd "$root/$d" && "$biome" check --write . >"$log" 2>&1 || true)
  tail -2 "$log" | head -1
done
