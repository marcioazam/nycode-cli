#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/vacuous-assert/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

check() {
  local want="$1" desc="$2" box="$3" needle="${4:-}"
  local output status=0
  output="$(bash "${GATE}" "${box}" 2>&1)" || status=$?
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

vacuous="$(mktemp -d "${WORK}/vacuous.XXXXXX")"
mkdir -p "${vacuous}/src"
cat >"${vacuous}/src/lib.rs" <<'RS'
#[cfg(test)]
mod tests {
    #[test]
    fn t() {
        assert!(true);
    }
}
RS
check 1 "assert true em teste recusa" "${vacuous}" "vacuous"

payload="$(mktemp -d "${WORK}/payload.XXXXXX")"
mkdir -p "${payload}/src"
cat >"${payload}/src/lib.rs" <<'RS'
#[cfg(test)]
mod tests {
    #[test]
    fn t() {
        assert_eq!(1 + 1, 2);
    }
}
RS
check 0 "assert_eq de payload passa" "${payload}"

okonly="$(mktemp -d "${WORK}/okonly.XXXXXX")"
mkdir -p "${okonly}/src"
cat >"${okonly}/src/lib.rs" <<'RS'
#[cfg(test)]
mod tests {
    #[test]
    fn t() {
        let r: Result<(), ()> = Ok(());
        assert!(r.is_ok());
    }
}
RS
check 1 "so is_ok recusa" "${okonly}" "vacuous"

if ((failed > 0)); then
  printf 'vacuous-assert-gate-test: %s ok, %s falhou\n' "${passed}" "${failed}" >&2
  exit 1
fi
printf 'vacuous-assert-gate-test: %s ok\n' "${passed}"
