#!/usr/bin/env bash
# Bateria do gate de waiver expirado (GATE-14).
#
# Cada caso monta uma arvore sintetica com o proprio registro e os ADRs
# que ele cita, roda o gate de producao sobre ela e exige o codigo de
# saida. 0 aprova, 1 e violacao, 2 e erro de uso.
#
# Uso: scripts/waiver/gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/waiver/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

tree() {
  local box="${WORK}/$1"
  mkdir -p "${box}/docs/architecture/decisions" "${box}/scripts/waiver"
  printf '%s' "${box}"
}

adr() { # adr <caminho> <regra> <expira>
  local path="$1" regra="$2" expira="$3"
  mkdir -p "$(dirname "${path}")"
  cat >"${path}" <<EOF
# ADR sintetico

- **Status:** aceito
- **Waiver:** ${regra}
- **Expira:** ${expira}
EOF
}

registro() { # registro <raiz> <linha...>
  local box="$1"
  shift
  printf '%s\n' "$@" >"${box}/scripts/waiver/registry.txt"
}

check() { # check <exit> <descricao> <raiz> <registro> [<trecho>]
  local want="$1" desc="$2" box="$3" reg="$4" needle="${5:-}"
  local output status=0
  output="$(bash "${GATE}" "${box}" "${reg}" 2>&1)" || status=$?

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

box="$(tree vigente)"
adr "${box}/docs/architecture/decisions/0033-x.md" "GATE-16" "2099-12-31"
registro "${box}" \
  "# comentario" \
  "" \
  "GATE-16 | GATE-16 | 2099-12-31 | ana | hook e squash | docs/architecture/decisions/0033-x.md"
check 0 "waiver vigente com ADR casado passa" "${box}" "${box}/scripts/waiver/registry.txt"

box="$(tree expirado)"
adr "${box}/docs/architecture/decisions/0033-x.md" "GATE-16" "2000-01-01"
registro "${box}" \
  "GATE-16 | GATE-16 | 2000-01-01 | ana | hook | docs/architecture/decisions/0033-x.md"
check 1 "waiver com data no passado reprova" "${box}" "${box}/scripts/waiver/registry.txt" "expirou"

box="$(tree campo_faltando)"
mkdir -p "${box}/docs/architecture/decisions"
registro "${box}" "GATE-16 | GATE-16 | 2099-12-31 | ana"
check 1 "linha sem os seis campos reprova" "${box}" "${box}/scripts/waiver/registry.txt" "campos"

box="$(tree adr_ausente)"
registro "${box}" \
  "GATE-16 | GATE-16 | 2099-12-31 | ana | hook | docs/architecture/decisions/nao-existe.md"
check 1 "ADR apontado que nao existe reprova" "${box}" "${box}/scripts/waiver/registry.txt" "nao existe"

box="$(tree adr_sem_registro)"
adr "${box}/docs/architecture/decisions/0040-orfao.md" "GATE-17" "2099-12-31"
registro "${box}" "# vazio de waivers"
check 1 "ADR com Waiver sem linha no registro reprova" "${box}" "${box}/scripts/waiver/registry.txt" "sem linha no registro"

box="$(tree data_diverge)"
adr "${box}/docs/architecture/decisions/0033-x.md" "GATE-16" "2099-01-01"
registro "${box}" \
  "GATE-16 | GATE-16 | 2099-12-31 | ana | hook | docs/architecture/decisions/0033-x.md"
check 1 "Expira do ADR diferente do registro reprova" "${box}" "${box}/scripts/waiver/registry.txt" "diverge"

box="$(tree regra_diverge)"
adr "${box}/docs/architecture/decisions/0033-x.md" "GATE-99" "2099-12-31"
registro "${box}" \
  "GATE-16 | GATE-16 | 2099-12-31 | ana | hook | docs/architecture/decisions/0033-x.md"
check 1 "Waiver do ADR diferente da regra do registro reprova" "${box}" "${box}/scripts/waiver/registry.txt" "diverge"

box="$(tree lista_virgula)"
adr "${box}/docs/architecture/decisions/0038-x.md" "AGT-04, AGT-05" "2099-12-31"
registro "${box}" \
  "AGT-04 | AGT-04 | 2099-12-31 | ana | gate | docs/architecture/decisions/0038-x.md" \
  "AGT-05 | AGT-05 | 2099-12-31 | ana | gate | docs/architecture/decisions/0038-x.md"
check 0 "Waiver com lista separada por virgula casa cada regra do registro" "${box}" "${box}/scripts/waiver/registry.txt"

box="$(tree lista_incompleta)"
adr "${box}/docs/architecture/decisions/0038-x.md" "AGT-04, AGT-05" "2099-12-31"
registro "${box}" \
  "AGT-04 | AGT-04 | 2099-12-31 | ana | gate | docs/architecture/decisions/0038-x.md"
check 1 "ID da lista Waiver sem linha no registro reprova" "${box}" "${box}/scripts/waiver/registry.txt" "AGT-05"

box="$(tree flake_expirada)"
adr "${box}/docs/architecture/decisions/0033-x.md" "GATE-16" "2099-12-31"
registro "${box}" \
  "GATE-16 | GATE-16 | 2099-12-31 | ana | hook | docs/architecture/decisions/0033-x.md"
cat >"${box}/scripts/flake-quarantine.txt" <<'EOF'
FLK-1 | crates::flaky | 2000-01-01 | ana | apagar | ruido
EOF
output="$(bash "${GATE}" "${box}" "${box}/scripts/waiver/registry.txt" "${box}/scripts/flake-quarantine.txt" 2>&1)" || status=$?
if [[ "${status:-0}" -eq 1 && "${output}" == *expirou* ]]; then
  printf 'ok      %s\n' "quarentena de flake com data no passado reprova"
  passed=$((passed + 1))
else
  printf 'FALHOU  %s\n        esperava exit 1 e "expirou", veio %s:\n%s\n' \
    "quarentena de flake com data no passado reprova" "${status:-0}" "${output}"
  failed=$((failed + 1))
fi
status=0

reg="$(mktemp "${WORK}/reg.XXXX")"
check 2 "raiz inexistente e erro de uso" "${WORK}/nao/existe" "${reg}" "nao encontrada"

box="$(tree registro_ausente)"
check 2 "registro inexistente e erro de uso" "${box}" "${WORK}/nao-existe.txt" "nao encontrado"

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "waiver-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "waiver-gate-test: ${passed} casos, todos passaram."
