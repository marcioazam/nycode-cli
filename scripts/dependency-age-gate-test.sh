#!/usr/bin/env bash
# Bateria do gate de idade minima de dependencia (SP-04 do padrao externo
# SOTA-2026).
#
# Duas partes testadas separadamente:
#
#   - Deteccao de dependencia nova e calculo de idade: puros, sem rede,
#     deterministicos -- usam git sintetico e datas geradas por `jq`, nunca
#     por `date -d`/`date -j` (a sintaxe diverge entre GNU e BSD, e este
#     script roda nas duas plataformas do release.yml).
#   - Existencia no registro: bate na API real do crates.io, por decisao --
#     "audit" e a excecao a "sem rede em verificacao" do proprio padrao
#     externo, e o alvo aqui e exatamente perguntar ao registro se um nome
#     existe. Usa `libc` (estavel, nunca sai do ar) para "existe e e velho o
#     bastante" e um nome garantidamente inexistente para "nao encontrado" --
#     os dois nunca decaem com o tempo, ao contrario de escolher uma
#     dependencia "recente" que ficaria velha em poucos meses.
#
# Uso: scripts/dependency-age-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/dependency-age-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

git_() { git -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

# days_ago_iso8601 <n> -> ISO8601 UTC de N dias atras, via jq (portavel)
days_ago_iso8601() {
  jq -nr --argjson n "$1" '(now - (86400 * $n)) | todateiso8601'
}

ok() {
  printf 'ok      %s\n' "$1"
  passed=$((passed + 1))
}
falhou() {
  printf 'FALHOU  %s\n        %s\n' "$1" "$2"
  failed=$((failed + 1))
}

# ============================================================================
# Parte 1: calculo de idade a partir de JSON (puro, sem rede)
# ============================================================================

# shellcheck source=/dev/null
source "${GATE}" --source-only

json_com_created_at() { # json_com_created_at <iso8601> -> corpo de resposta sintetico
  printf '{"crate":{"created_at":"%s"}}' "$1"
}

velho="$(json_com_created_at "$(days_ago_iso8601 100)")"
dias="$(age_days_from_json "${velho}")"
if ((dias >= 90 && dias <= 110)); then
  ok "age_days_from_json calcula ~100 dias para uma data 100 dias atras"
else
  falhou "age_days_from_json calcula ~100 dias para uma data 100 dias atras" "veio ${dias}"
fi

novo="$(json_com_created_at "$(days_ago_iso8601 5)")"
dias="$(age_days_from_json "${novo}")"
if ((dias >= 0 && dias <= 10)); then
  ok "age_days_from_json calcula ~5 dias para uma data 5 dias atras"
else
  falhou "age_days_from_json calcula ~5 dias para uma data 5 dias atras" "veio ${dias}"
fi

if meets_min_age "$(json_com_created_at "$(days_ago_iso8601 100)")" 30; then
  ok "100 dias satisfaz o piso de 30"
else
  falhou "100 dias satisfaz o piso de 30" "reprovou"
fi

if ! meets_min_age "$(json_com_created_at "$(days_ago_iso8601 5)")" 30; then
  ok "5 dias nao satisfaz o piso de 30"
else
  falhou "5 dias nao satisfaz o piso de 30" "passou"
fi

if meets_min_age "$(json_com_created_at "$(days_ago_iso8601 30)")" 30; then
  ok "exatamente 30 dias satisfaz; o piso e inclusivo"
else
  falhou "exatamente 30 dias satisfaz; o piso e inclusivo" "reprovou"
fi

# ============================================================================
# Parte 2: deteccao de dependencia nova a partir do Cargo.lock (puro, sem rede)
# ============================================================================

# repo <nome> -> caminho, ja com um Cargo.lock base e branch "feature"
repo() {
  local box="${WORK}/$1"
  mkdir -p "${box}/crates/x"
  (
    cd "${box}"
    git_ init --quiet --initial-branch=main
    mkdir -p crates/x
    printf '[package]\nname = "x"\nversion = "0.1.0"\n' >crates/x/Cargo.toml
    cat >Cargo.lock <<'EOF'
[[package]]
name = "x"
version = "0.1.0"

[[package]]
name = "libc"
version = "0.2.0"
EOF
    git_ add .
    git_ commit --quiet -m "base"
    git_ checkout --quiet -b feature
  )
  printf '%s' "${box}"
}

box="$(repo deteccao_dependencia_nova)"
(
  cd "${box}"
  cat >Cargo.lock <<'EOF'
[[package]]
name = "x"
version = "0.1.0"

[[package]]
name = "libc"
version = "0.2.0"

[[package]]
name = "serde"
version = "1.0.0"
EOF
  git_ add Cargo.lock
  git_ commit --quiet -m "adiciona serde"
)
lista="$(new_dependency_names "${box}" main feature)"
if [[ "${lista}" == "serde" ]]; then
  ok "dependencia nova de verdade e detectada"
else
  falhou "dependencia nova de verdade e detectada" "veio [${lista}]"
fi

box="$(repo crate_interno_nao_conta)"
(
  cd "${box}"
  mkdir -p crates/y
  printf '[package]\nname = "y"\nversion = "0.1.0"\n' >crates/y/Cargo.toml
  cat >Cargo.lock <<'EOF'
[[package]]
name = "x"
version = "0.1.0"

[[package]]
name = "libc"
version = "0.2.0"

[[package]]
name = "y"
version = "0.1.0"
EOF
  git_ add .
  git_ commit --quiet -m "adiciona crate interno y"
)
lista="$(new_dependency_names "${box}" main feature)"
if [[ -z "${lista}" ]]; then
  ok "crate interno novo (existe em crates/) nao conta como dependencia nova"
else
  falhou "crate interno novo nao conta como dependencia nova" "veio [${lista}]"
fi

box="$(repo sem_dependencia_nova)"
(
  cd "${box}"
  sed -i.bak 's/version = "0.2.0"/version = "0.2.1"/' Cargo.lock
  rm -f Cargo.lock.bak
  git_ add Cargo.lock
  git_ commit --quiet -m "so bump de versao de dependencia ja existente"
)
lista="$(new_dependency_names "${box}" main feature)"
if [[ -z "${lista}" ]]; then
  ok "bump de versao de dependencia ja existente nao conta como nova"
else
  falhou "bump de versao nao conta como nova" "veio [${lista}]"
fi

# ============================================================================
# Parte 3: gate completo, ponta a ponta, contra a API real do crates.io
# ============================================================================

check_status() { # check_status <exit esperado> <descricao> <raiz> <base> <head> [<trecho>]
  local want="$1" desc="$2" box="$3" base="$4" head="$5" needle="${6:-}"
  local output status=0
  output="$(cd "${box}" && bash "${GATE}" "${base}" "${head}" 2>&1)" || status=$?
  if [[ "${status}" -ne "${want}" ]]; then
    falhou "${desc}" "esperava exit ${want}, veio ${status}: ${output}"
    return
  fi
  if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
    falhou "${desc}" "exit ${status} correto, mas a saida nao diz \"${needle}\": ${output}"
    return
  fi
  ok "${desc}"
}

# repo() ja deixa "feature" identico a "main" (nenhum commit extra ainda) --
# nao ha nada novo por construcao, sem precisar de outro commit para provar.
box="$(repo dependencia_velha_o_bastante_passa)"
check_status 0 "sem nada novo, gate passa sem bater na rede" "${box}" main feature

box="$(repo dependencia_inexistente_reprova)"
(
  cd "${box}"
  cat >Cargo.lock <<'EOF'
[[package]]
name = "x"
version = "0.1.0"

[[package]]
name = "libc"
version = "0.2.0"

[[package]]
name = "nycode-cli-test-nonexistent-crate-xyz123"
version = "0.1.0"
EOF
  git_ add Cargo.lock
  git_ commit --quiet -m "adiciona dependencia que nao existe no crates.io"
)
check_status 1 "dependencia nao encontrada no registro reprova" "${box}" main feature "nao encontrad"

box="$(repo dependencia_real_e_antiga_passa)"
(
  cd "${box}"
  cat >Cargo.lock <<'EOF'
[[package]]
name = "x"
version = "0.1.0"

[[package]]
name = "cfg-if"
version = "1.0.0"
EOF
  git_ add Cargo.lock
  git_ commit --quiet -m "adiciona cfg-if, dependencia real e antiga"
)
check_status 0 "dependencia real, publicada ha anos, passa o piso de 30 dias" "${box}" main feature

# --- Erro de uso ----------------------------------------------------------------

box="$(repo ref_invalida)"
check_status 2 "ref base inexistente e erro de uso" "${box}" "nao-existe" feature "nao encontrada"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "dependency-age-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "dependency-age-gate-test: ${passed} casos, todos passaram."
