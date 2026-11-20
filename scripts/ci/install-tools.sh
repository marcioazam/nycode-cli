#!/usr/bin/env bash
# Installs pinned release binaries into ${TOOLS_BIN:-$HOME/.local/bin}, verifying a sha256
# recorded here (GitHub release asset digests, 2026-11-13). Usage: install-tools.sh NAME...
# Names: actionlint gitleaks trufflehog osv-scanner shellcheck shfmt biome rg
set -euo pipefail
BIN=${TOOLS_BIN:-$HOME/.local/bin}
mkdir -p "$BIN"
GH=https://github.com

# name|version|url|sha256|kind (tgz: tar.gz, txz: tar.xz, raw: plain binary)|member in archive
spec() {
  case $1 in
  actionlint) echo "1.7.12|$GH/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz|8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8|tgz|actionlint" ;;
  gitleaks) echo "8.30.1|$GH/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz|551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb|tgz|gitleaks" ;;
  trufflehog) echo "3.99.9|$GH/trufflesecurity/trufflehog/releases/download/v3.99.9/trufflehog_3.99.9_linux_amd64.tar.gz|12050095c8063bf4d34f9f6cbce6ba9fa8d0deea9d503d0570364feba093658e|tgz|trufflehog" ;;
  osv-scanner) echo "2.7.1|$GH/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64|fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8|raw|osv-scanner" ;;
  shellcheck) echo "0.11.0|$GH/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz|8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198|txz|shellcheck-v0.11.0/shellcheck" ;;
  shfmt) echo "3.14.1|$GH/mvdan/sh/releases/download/v3.14.1/shfmt_v3.14.1_linux_amd64|76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf|raw|shfmt" ;;
  biome) echo "2.6.7|$GH/biomejs/biome/releases/download/%40biomejs/biome%402.6.7/biome-linux-x64|d924b8407471748465121f0a2dc1a0bc277038b0b89142e77583e3ce0dda3746|raw|biome" ;;
  rg) echo "15.2.0|$GH/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz|33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c|tgz|ripgrep-15.2.0-x86_64-unknown-linux-musl/rg" ;;
  *) return 1 ;;
  esac
}

install_one() {
  local name=$1 line version url sha kind member tmp
  line=$(spec "$name") || {
    echo "install-tools: unknown tool $name" >&2
    return 2
  }
  IFS='|' read -r version url sha kind member <<<"$line"
  tmp=$(mktemp -d)
  curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 -o "$tmp/asset" "$url"
  if [ "$(sha256sum "$tmp/asset" | cut -d' ' -f1)" != "$sha" ]; then
    echo "install-tools: sha256 mismatch for $name $version" >&2
    return 1
  fi
  case $kind in
  tgz) tar -xzf "$tmp/asset" -C "$tmp" "$member" ;;
  txz) tar -xJf "$tmp/asset" -C "$tmp" "$member" ;;
  raw) mv "$tmp/asset" "$tmp/$member" ;;
  esac
  install -m 0755 "$tmp/$member" "$BIN/$name"
  rm -r "$tmp"
  echo "install-tools: $name $version -> $BIN/$name"
}

[ $# -gt 0 ] || {
  echo "usage: $0 NAME..." >&2
  exit 2
}
for t in "$@"; do install_one "$t"; done
