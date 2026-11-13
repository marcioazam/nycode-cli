#!/usr/bin/env bash
# Leak scanner: gitleaks + trufflehog + personal identifiers.
# Modes: --tree (default) | --staged FILES... | --history | --selftest
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
TH_VERSION=3.99.9
TH_SHA256=12050095c8063bf4d34f9f6cbce6ba9fa8d0deea9d503d0570364feba093658e
TH_URL=https://github.com/trufflesecurity/trufflehog/releases/download/v$TH_VERSION
export PATH="$HOME/.local/bin:$PATH"
CFG="$ROOT/.gitleaks.toml"
IDFILE=${PI_HARNESS_IDENTIFIERS:-$HOME/.config/pi-harness/identifiers}
# Path regexes trufflehog must skip (it has no allowlist): fixtures and the known fake AWS key test.
TH_EXCL=$(mktemp)
trap 'rm -rf "$TH_EXCL" "${TMPD:-}"' EXIT
printf '%s\n' 'scripts/fixtures/leak/' 'atualizador/scripts/tests/test_core\.py$' '(^|/)\.git/' >"$TH_EXCL"

install_trufflehog() {
  command -v trufflehog >/dev/null 2>&1 && return 0
  [ "$(uname -s)-$(uname -m)" = Linux-x86_64 ] || return 1
  local t
  t=$(mktemp -d)
  mkdir -p "$HOME/.local/bin"
  if curl -sfL -o "$t/th.tgz" "$TH_URL/trufflehog_${TH_VERSION}_linux_amd64.tar.gz" &&
    curl -sfL -o "$t/sums" "$TH_URL/trufflehog_${TH_VERSION}_checksums.txt" &&
    [ "$(grep ' trufflehog_'"$TH_VERSION"'_linux_amd64.tar.gz$' "$t/sums" | cut -d' ' -f1)" = "$TH_SHA256" ] &&
    [ "$(sha256sum "$t/th.tgz" | cut -d' ' -f1)" = "$TH_SHA256" ] &&
    tar -xzf "$t/th.tgz" -C "$t" trufflehog &&
    install -m 0755 "$t/trufflehog" "$HOME/.local/bin/trufflehog"; then
    rm -rf "$t"
    return 0
  fi
  rm -rf "$t"
  return 1
}

# Each scan_* prints findings (never secrets) and returns 0 clean / 1 findings or error.
scan_gitleaks() { # args: gitleaks subcommand args...
  command -v gitleaks >/dev/null 2>&1 || {
    echo "gitleaks: not installed" >&2
    return 1
  }
  gitleaks "$@" -c "$CFG" --no-banner --no-color --redact -l warn 2>&1 | grep -E 'File:|Line:|RuleID:' || true
  gitleaks "$@" -c "$CFG" --no-banner --no-color --redact -l error >/dev/null 2>&1
}

scan_trufflehog() { # args: paths...
  if ! install_trufflehog; then
    if [ "${PI_HARNESS_ALLOW_NO_TRUFFLEHOG:-0}" = 1 ]; then
      echo "!!! WARNING: trufflehog missing and install failed; SKIPPED by PI_HARNESS_ALLOW_NO_TRUFFLEHOG=1 !!!" >&2
      return 0
    fi
    echo "trufflehog: not installed and install failed (set PI_HARNESS_ALLOW_NO_TRUFFLEHOG=1 to skip, NOT for publishing)" >&2
    return 1
  fi
  local out rc=0
  out=$(trufflehog filesystem --no-update --fail --no-color --json --results=verified,unknown,unverified \
    --exclude-paths="$TH_EXCL" "$@" 2>/dev/null) || rc=$?
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | jq -r 'select(.SourceMetadata!=null) | "\(.DetectorName): \(.SourceMetadata.Data.Filesystem.file):\(.SourceMetadata.Data.Filesystem.line // 0)"' 2>/dev/null || true
  fi
  [ "$rc" -eq 0 ]
}

scan_identifiers() { # args: paths...   (path:line:content printed; patterns never printed)
  if [ ! -f "$IDFILE" ]; then
    echo "identifiers: file missing ($IDFILE). Create it or point PI_HARNESS_IDENTIFIERS at an (empty) file." >&2
    return 1
  fi
  # Fail closed: without rg the scan below would report no hits (GitHub runners ship no ripgrep, 2026-11-13).
  command -v rg >/dev/null 2>&1 || {
    echo "identifiers: rg (ripgrep) not installed" >&2
    return 1
  }
  local pat hits n=0 line p rest ln content a ap are ignored
  pat=$(mktemp)
  grep -v -e '^[[:space:]]*$' -e '^[[:space:]]*#' "$IDFILE" >"$pat" || true
  [ -s "$pat" ] || {
    rm -f "$pat"
    return 0
  }
  hits=$(rg --hidden --no-ignore -n --no-heading --with-filename -f "$pat" \
    -g '!.git' -g '!.leak-allow' -g '!scripts/fixtures/leak' -- "$@" 2>/dev/null || true)
  rm -f "$pat"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    p=${line%%:*}
    rest=${line#*:}
    ln=${rest%%:*}
    content=${rest#*:}
    p=${p#./}
    ignored=0
    case "$p" in .leak-allow | scripts/fixtures/leak/*) continue ;; esac # rg globs skip explicit paths (--staged)
    if [ -f "$ROOT/.leak-allow" ]; then
      while IFS= read -r a; do
        case "$a" in '' | '#'*) continue ;; esac
        ap=${a%%:*}
        are=${a#*:}
        if [ "$ap" = "$p" ] && printf '%s' "$content" | grep -Eq -- "$are"; then
          ignored=1
          break
        fi
      done <"$ROOT/.leak-allow"
    fi
    [ "$ignored" = 1 ] && continue
    echo "$p:$ln: $content"
    n=$((n + 1))
  done <<<"$hits"
  [ "$n" -eq 0 ] || {
    echo "identifiers: $n hit(s)"
    return 1
  }
}

summary() { # name rc
  if [ "$2" -eq 0 ]; then echo "== $1: clean"; else echo "== $1: FINDINGS/ERROR"; fi
}

run_all() { # mode; remaining args: targets
  local mode=$1
  shift
  local fail=0 rc
  case "$mode" in
  tree)
    scan_gitleaks dir "$ROOT" && rc=0 || rc=$?
    summary gitleaks $rc
    fail=$((fail | rc))
    scan_trufflehog "$ROOT" && rc=0 || rc=$?
    summary trufflehog $rc
    fail=$((fail | rc))
    scan_identifiers . && rc=0 || rc=$?
    summary identifiers $rc
    fail=$((fail | rc))
    ;;
  staged)
    scan_gitleaks git --staged "$ROOT" && rc=0 || rc=$?
    summary gitleaks $rc
    fail=$((fail | rc))
    scan_trufflehog "$@" && rc=0 || rc=$?
    summary trufflehog $rc
    fail=$((fail | rc))
    scan_identifiers "$@" && rc=0 || rc=$?
    summary identifiers $rc
    fail=$((fail | rc))
    ;;
  history)
    scan_gitleaks git "$ROOT" && rc=0 || rc=$?
    summary gitleaks $rc
    fail=$((fail | rc))
    ;;
  esac
  [ "$fail" -eq 0 ]
}

selftest() {
  TMPD=$(mktemp -d)
  local d=$TMPD/t rc ok=0
  mkdir -p "$d/tok" "$d/path" "$d/clean"
  cp scripts/fixtures/leak/clean.txt "$d/clean/clean.txt"
  # fake token built at runtime so this file holds no literal secret
  # valid GitHub PAT shape (30 chars + base62 CRC32), so trufflehog's checksum filter accepts it
  python3 - >"$d/tok/config.txt" <<'PY'
import zlib
a = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
body = "Zq7Lm2Xv9Kd4Rt8Wp3Hs6Nb1Cf5Yg"
n = zlib.crc32(body.encode()); c = ""
while n: n, r = divmod(n, 62); c = a[r] + c
print("GITHUB_TOKEN=" + "ghp_" + body + c.rjust(6, "0"))
# AWS-shaped pair (random, not a real credential), built from parts for trufflehog's detector
print("AWS_ACCESS_KEY_ID=" + "AKIA" + "Z3MSJV4WWYXRB6PL")
print("AWS_SECRET_ACCESS_KEY=" + "wJalrXUtnFEMI/K7MDENG" + "/bPxRfiCYzXx9Qm2Lp4")
PY
  printf 'cd /home/someuser/work\n' >"$d/path/notes.txt"
  printf '/home/someuser\n' >"$TMPD/ids"
  local saved=$IDFILE
  IDFILE=$TMPD/ids
  chk() { # label expect(0|1) cmd...
    local label=$1 exp=$2
    shift 2
    local r=0
    "$@" >/dev/null 2>&1 || r=$?
    if { [ "$exp" = 0 ] && [ "$r" -eq 0 ]; } || { [ "$exp" = 1 ] && [ "$r" -ne 0 ]; }; then echo "ok   $label"; else
      echo "FAIL $label (rc=$r)"
      ok=1
    fi
  }
  chk "gitleaks catches token" 1 scan_gitleaks dir "$d/tok"
  chk "gitleaks passes clean" 0 scan_gitleaks dir "$d/clean"
  chk "identifiers catch path" 1 scan_identifiers "$d/path"
  chk "identifiers pass clean" 0 scan_identifiers "$d/clean"
  if install_trufflehog; then
    chk "trufflehog catches token" 1 scan_trufflehog "$d/tok"
    chk "trufflehog passes clean" 0 scan_trufflehog "$d/clean"
  else
    echo "FAIL trufflehog unavailable"
    ok=1
  fi
  IDFILE=$saved
  [ "$ok" -eq 0 ] && echo "selftest: PASS" || echo "selftest: FAIL"
  return "$ok"
}

mode=${1:---tree}
[ $# -gt 0 ] && shift
case "$mode" in
--tree) run_all tree ;;
--staged)
  [ $# -gt 0 ] || {
    echo "--staged needs FILES" >&2
    exit 2
  }
  run_all staged "$@"
  ;;
--history) run_all history ;;
--selftest) selftest ;;
*)
  echo "usage: $0 [--tree|--staged FILES...|--history|--selftest]" >&2
  exit 2
  ;;
esac
