#!/usr/bin/env bash
# Bateria do gate de error-masking no diff (FR-7).
#
# Cada caso monta um diff unificado, um JSON de clippy e uma arvore-fonte
# minima; o gate de producao roda em --from (sem cargo). 0 aprova, 1 e
# violacao, 2 e erro de uso.
#
# Uso: scripts/error-masking/gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/error-masking/gate.sh"

if [[ ! -f "${GATE}" ]]; then
  echo "error-masking-test: ${GATE} ainda nao esta nesta arvore; este PR so publica o teste." >&2
  exit 2
fi

WORK="$(mktemp -d)"
readonly WORK
cleanup_work() {
  rm -rf -- "${WORK}"
}
trap cleanup_work EXIT

passed=0
failed=0

check() { # check <exit> <descricao> <diff> <json> <raiz> [<trecho>]
  local want="$1" desc="$2" diff="$3" json="$4" box="$5" needle="${6:-}"
  local output status=0
  output="$(bash "${GATE}" --from "${diff}" "${json}" "${box}" 2>&1)" || status=$?

  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
    printf 'FALHOU  %s\n        exit %s correto, mas a saida nao diz "%s":\n%s\n' \
      "${desc}" "${status}" "${needle}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

diag() { # diag <arquivo> <linha> <codigo>
  python3 -c 'import json, sys
path, line, code = sys.argv[1], int(sys.argv[2]), sys.argv[3]
print(json.dumps({
    "reason": "compiler-message",
    "message": {
        "code": {"code": code},
        "spans": [{"file_name": path, "line_start": line, "is_primary": True}],
    },
}))
' "$1" "$2" "$3"
}

box="${WORK}/src"
mkdir -p "${box}/crates/demo/src"

# --- 1. let _ = Result novo no diff falha ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
use std::fs;
pub fn f() {
    let _ = fs::remove_file("x");
}
EOF
cat >"${WORK}/new.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,2 +1,4 @@
 use std::fs;
 pub fn f() {
+    let _ = fs::remove_file("x");
 }
EOF
diag crates/demo/src/lib.rs 3 clippy::let_underscore_must_use >"${WORK}/hit.json"
check 1 "let _ = Result novo no diff falha" \
  "${WORK}/new.diff" "${WORK}/hit.json" "${box}" "descarta falha"

# --- 2. anotacao mascarado-porque na linha anterior passa ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
use std::fs;
pub fn f() {
    // mascarado-porque: arquivo ausente e o caso esperado
    let _ = fs::remove_file("x");
}
EOF
cat >"${WORK}/ann.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,2 +1,5 @@
 use std::fs;
 pub fn f() {
+    // mascarado-porque: arquivo ausente e o caso esperado
+    let _ = fs::remove_file("x");
 }
EOF
diag crates/demo/src/lib.rs 4 clippy::let_underscore_must_use >"${WORK}/ann.json"
check 0 "anotacao mascarado-porque na linha anterior passa" \
  "${WORK}/ann.diff" "${WORK}/ann.json" "${box}"

# --- 3. writeln / fmt::Write sem diagnostico passa ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
use std::fmt::Write;
pub fn f(out: &mut String) {
    let _ = write!(out, "ok");
}
EOF
cat >"${WORK}/fmt.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,2 +1,4 @@
 use std::fmt::Write;
 pub fn f(out: &mut String) {
+    let _ = write!(out, "ok");
 }
EOF
: >"${WORK}/empty.json"
check 0 "fmt::Write sem diagnostico clippy passa" \
  "${WORK}/fmt.diff" "${WORK}/empty.json" "${box}"

# --- 4. legado fora do diff nao falha ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
use std::fs;
pub fn f() {
    let _ = fs::remove_file("x");
}
pub fn g() {}
EOF
cat >"${WORK}/old.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -3,3 +3,4 @@
     let _ = fs::remove_file("x");
 }
+pub fn g() {}
EOF
diag crates/demo/src/lib.rs 3 clippy::let_underscore_must_use >"${WORK}/old.json"
check 0 "legado fora das linhas adicionadas nao falha" \
  "${WORK}/old.diff" "${WORK}/old.json" "${box}"

# --- 5. unused_must_use no diff falha ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
use std::fs;
pub fn f() {
    fs::remove_file("x").ok();
}
EOF
cat >"${WORK}/ok.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,2 +1,4 @@
 use std::fs;
 pub fn f() {
+    fs::remove_file("x").ok();
 }
EOF
diag crates/demo/src/lib.rs 3 unused_must_use >"${WORK}/ok.json"
check 1 "unused_must_use novo no diff falha" \
  "${WORK}/ok.diff" "${WORK}/ok.json" "${box}" "descarta falha"

# --- 6. allow de modulo novo sem anotacao falha ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
#![allow(unused_must_use)]
pub fn f() {}
EOF
cat >"${WORK}/allow.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,1 +1,2 @@
+#![allow(unused_must_use)]
 pub fn f() {}
EOF
: >"${WORK}/empty2.json"
check 1 "allow unused_must_use adicionado sem razao falha" \
  "${WORK}/allow.diff" "${WORK}/empty2.json" "${box}" "allow(unused_must_use)"

# --- 7. allow anotado passa ---
cat >"${box}/crates/demo/src/lib.rs" <<'EOF'
// mascarado-porque: crate de fixture do auto-teste
#![allow(unused_must_use)]
pub fn f() {}
EOF
cat >"${WORK}/allowok.diff" <<'EOF'
--- a/crates/demo/src/lib.rs
+++ b/crates/demo/src/lib.rs
@@ -1,1 +1,3 @@
+// mascarado-porque: crate de fixture do auto-teste
+#![allow(unused_must_use)]
 pub fn f() {}
EOF
check 0 "allow unused_must_use com mascarado-porque passa" \
  "${WORK}/allowok.diff" "${WORK}/empty2.json" "${box}"

echo
if ((failed > 0)); then
  echo "error-masking-gate-test: ${failed} falhou, ${passed} passou." >&2
  exit 1
fi
echo "error-masking-gate-test: ${passed} passou."
