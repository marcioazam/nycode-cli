#!/usr/bin/env bash
# Bateria do gate de vulnerabilidade no artefato (GATE-10).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/artifact/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

check() {
  local want="$1" desc="$2"
  shift 2
  local output status=0
  output="$(bash "${GATE}" "$@" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' \
      "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

clean="${WORK}/clean.json"
cat >"${clean}" <<'EOF'
{"Results":[{"Target":"bin","Vulnerabilities":null}]}
EOF
check 0 "relatorio limpo passa" --json "${clean}"

high="${WORK}/high.json"
cat >"${high}" <<'EOF'
{"Results":[{"Target":"bin","Vulnerabilities":[{"VulnerabilityID":"CVE-9999-1","Severity":"HIGH","PkgName":"x"}]}]}
EOF
check 1 "HIGH sem VEX reprova" --json "${high}"

crit="${WORK}/crit.json"
cat >"${crit}" <<'EOF'
{"Results":[{"Target":"bin","Vulnerabilities":[{"VulnerabilityID":"CVE-9999-2","Severity":"CRITICAL","PkgName":"x"}]}]}
EOF
check 1 "CRITICAL sem VEX reprova" --json "${crit}"

vex="${WORK}/vex.txt"
printf 'CVE-9999-1 | 2099-12-31 | nao alcancavel\n' >"${vex}"
check 0 "HIGH com VEX vigente passa" --json "${high}" "${vex}"

vex_old="${WORK}/vex-old.txt"
printf 'CVE-9999-1 | 2000-01-01 | expirado\n' >"${vex_old}"
check 1 "HIGH com VEX expirado reprova" --json "${high}" "${vex_old}"

check 2 "relatorio ausente e erro de uso" --json "${WORK}/nao.json"
check 2 "modo desconhecido e erro de uso" --nope "${clean}"

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "artifact-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "artifact-gate-test: ${passed} casos, todos passaram."
