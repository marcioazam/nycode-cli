#!/bin/sh
# Selftest for the local.env loader in bin/pi (sources it with PI_WRAPPER_TEST=1).
d=$(mktemp -d) || exit 1
trap 'rm -r "$d"' EXIT
here=$(cd "$(dirname "$0")" && pwd)
PI_WRAPPER_TEST=1
export PI_WRAPPER_TEST
. "$here/pi"
fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   $3"; else echo "FAIL $3 (got '$1', want '$2')"; fail=1; fi; }
mk() { printf '%s\n' "$2" > "$d/$1"; chmod "$3" "$d/$1"; }
unset PI_BYPASS_PERMISSIONS PI_KNOWLEDGE_VAULT PI_COMPACT_AT PONYTAIL_QUIET_STARTUP FOO
rm -f /tmp/pwned

mk a 'PI_BYPASS_PERMISSIONS=1' 644
pi_load_local_env "$d/a" 2>/dev/null
ok "${PI_BYPASS_PERMISSIONS-unset}" unset "0644 file ignored"

mk b 'FOO=1' 600
pi_load_local_env "$d/b" 2>/dev/null
ok "${FOO-unset}" unset "unknown key ignored"

mk c 'PI_KNOWLEDGE_VAULT=$(touch /tmp/pwned)' 600
pi_load_local_env "$d/c"
ok "$PI_KNOWLEDGE_VAULT" '$(touch /tmp/pwned)' "command substitution stored literally"
[ -e /tmp/pwned ] && { echo "FAIL /tmp/pwned created"; fail=1; } || echo "ok   /tmp/pwned not created"

mk e 'PI_COMPACT_AT="123"' 600
pi_load_local_env "$d/e"
ok "$PI_COMPACT_AT" 123 "quoted value unquoted"

mk g 'PONYTAIL_QUIET_STARTUP=0' 600
PONYTAIL_QUIET_STARTUP=5
pi_load_local_env "$d/g"
ok "$PONYTAIL_QUIET_STARTUP" 5 "caller env wins"

mk h 'PI_BYPASS_PERMISSIONS=1' 600
pi_load_local_env "$d/h"
ok "$PI_BYPASS_PERMISSIONS" 1 "valid PI_BYPASS_PERMISSIONS applied"
exit "$fail"
