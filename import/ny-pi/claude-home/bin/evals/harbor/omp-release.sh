#!/usr/bin/env bash
# Fetches the pinned Oh My Pi release binaries (glibc and musl, x86-64) and checks them against the release's
# SHA256SUMS.txt; idempotent. Output: $BENCH_STAGE_ROOT/omp/release (default ~/.cache/bench/omp/release).
set -euo pipefail
version="${OMP_VERSION:-18.20.0}"
dir="${BENCH_STAGE_ROOT:-$HOME/.cache/bench}/omp/release"
base="https://github.com/can1357/oh-my-pi/releases/download/v$version"
mkdir -p "$dir"
cd "$dir"
for a in omp-linux-x64 omp-linux-musl-x64 SHA256SUMS.txt; do
  if [ ! -s "$a" ]; then curl -fsSL --retry 3 -o "$a.part" "$base/$a" && mv "$a.part" "$a"; fi
done
grep -E " (omp-linux-x64|omp-linux-musl-x64)$" SHA256SUMS.txt | sha256sum --quiet -c -
chmod +x omp-linux-x64 omp-linux-musl-x64
[ "$(./omp-linux-x64 --version)" = "omp/$version" ]
echo "$dir"
