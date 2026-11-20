#!/usr/bin/env bash
# Applies claude-home/patches/pi-code/*.patch in glob order (as bin/pi does) on pristine pi-code 1.7.0,
# then reverses them in reverse order (the wrapper's "stack applied" test). A patch out of order or made over
# another stack (e.g. the local unpublished UI patches) fails here.
# PI_CODE_TARBALL=<file> skips the npm download (offline).
set -euo pipefail

want_sha1=8ba1f814773da6897f6708c62c7c517cee2baf4e
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

tarball=${PI_CODE_TARBALL:-}
if [ -z "$tarball" ]; then
  (cd "$tmp" && npm pack pi-code@1.7.0 --silent >/dev/null)
  tarball=$(ls "$tmp"/*.tgz)
fi
got=$(sha1sum "$tarball" | cut -d' ' -f1)
if [ "$got" != "$want_sha1" ]; then
  echo "patch-stack: FAIL tarball sha1 $got != $want_sha1"
  exit 1
fi
tar -xzf "$tarball" -C "$tmp"
ext=$tmp/package/extensions

patches=("$root"/claude-home/patches/pi-code/*.patch)
for p in "${patches[@]}"; do
  if ! patch -d "$ext" -p1 -N -s -f --no-backup-if-mismatch <"$p" >/dev/null; then
    echo "patch-stack: FAIL $(basename "$p") (apply)"
    exit 1
  fi
done
for ((i = ${#patches[@]} - 1; i >= 0; i--)); do
  if ! patch -d "$ext" -p1 -R -N -s -f --no-backup-if-mismatch <"${patches[i]}" >/dev/null; then
    echo "patch-stack: FAIL $(basename "${patches[i]}") (reverse)"
    exit 1
  fi
done
echo "patch-stack: ok ${#patches[@]} patches"
