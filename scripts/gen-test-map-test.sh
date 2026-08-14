#!/usr/bin/env bash
# Bateria do gerador de test_map (AI-10 do padrao externo SOTA-2026).
#
# O gerador nao mapeia arquivo-fonte -> teste especifico (ver o cabecalho do
# proprio test_map para o porque). Estes testes verificam so o que ele
# promete: o inventario por crate de onde os testes vivem, e o modo --check
# que detecta um test_map desatualizado sem reescreve-lo.
#
# Uso: scripts/gen-test-map-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GEN="${ROOT}/scripts/gen-test-map.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

tree() { # tree <nome> -> caminho da raiz sintetica
  local box="${WORK}/$1"
  mkdir -p "${box}"
  printf '%s' "${box}"
}

# arquivo <caminho> <conteudo...>
arquivo() {
  local path="$1"
  shift
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "$@" >"${path}"
}

check_ok() { # check_ok <descricao> <raiz> <saida> [<trecho exigido>...]
  local desc="$1" box="$2" out="$3"
  shift 3
  local output status=0
  output="$(bash "${GEN}" "${box}" "${out}" 2>&1)" || status=$?

  if [[ "${status}" -ne 0 ]]; then
    printf 'FALHOU  %s\n        esperava exit 0, veio %s:\n%s\n' "${desc}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  if [[ ! -f "${out}" ]]; then
    printf 'FALHOU  %s\n        exit 0 mas %s nao foi escrito\n' "${desc}" "${out}"
    failed=$((failed + 1))
    return
  fi
  local content
  content="$(cat "${out}")"
  for needle in "$@"; do
    if [[ "${content}" != *"${needle}"* ]]; then
      printf 'FALHOU  %s\n        saida nao contem "%s":\n%s\n' "${desc}" "${needle}" "${content}"
      failed=$((failed + 1))
      return
    fi
  done
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

check_status() { # check_status <exit esperado> <descricao> <args...> [-- <trecho exigido>]
  local want="$1" desc="$2"
  shift 2
  local -a gate_args=()
  local needle=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--" ]]; then
      shift
      needle="${1:-}"
      break
    fi
    gate_args+=("$1")
    shift
  done

  local output status=0
  output="$(bash "${GEN}" "${gate_args[@]}" 2>&1)" || status=$?

  if [[ "${status}" -ne "${want}" ]]; then
    printf 'FALHOU  %s\n        esperava exit %s, veio %s:\n%s\n' "${desc}" "${want}" "${status}" "${output}"
    failed=$((failed + 1))
    return
  fi
  if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
    printf 'FALHOU  %s\n        exit %s correto, mas a saida nao diz "%s":\n%s\n' "${desc}" "${status}" "${needle}" "${output}"
    failed=$((failed + 1))
    return
  fi
  printf 'ok      %s\n' "${desc}"
  passed=$((passed + 1))
}

# --- Inventario, nao mapeamento --------------------------------------------

box="$(tree crate_completo)"
arquivo "${box}/crates/x/src/lib.rs" "pub mod a;"
arquivo "${box}/crates/x/src/a.rs" "pub fn f() {}" "" "#[cfg(test)]" "mod tests {}"
arquivo "${box}/crates/x/src/b.rs" "pub fn g() {}"
arquivo "${box}/crates/x/src/b_test.rs" "// testes de b"
arquivo "${box}/crates/x/tests/e2e.rs" "// integracao"
out="${box}.test_map"
check_ok "arquivo com teste inline aparece na secao certa" "${box}" "${out}" "src/a.rs"
check_ok "arquivo de teste dedicado aparece na secao certa" "${box}" "${out}" "src/b_test.rs"
check_ok "teste de integracao aparece na secao certa" "${box}" "${out}" "tests/e2e.rs"
check_ok "o crate ganha seu proprio cabecalho" "${box}" "${out}" "## x"

box="$(tree crate_sem_teste_nenhum)"
arquivo "${box}/crates/y/src/lib.rs" "pub fn nada() {}"
out="${box}.test_map"
check_ok "crate sem teste nenhum ainda gera secao, sem quebrar" "${box}" "${out}" "## y" "(nenhum)"

box="$(tree dois_crates)"
arquivo "${box}/crates/a/src/lib.rs" "pub fn f() {}"
arquivo "${box}/crates/b/src/lib.rs" "pub fn g() {}"
out="${box}.test_map"
check_ok "varios crates geram varias secoes" "${box}" "${out}" "## a" "## b"

box="$(tree nao_afirma_mapeamento_1a1)"
arquivo "${box}/crates/x/src/lib.rs" "pub fn f() {}"
out="${box}.test_map"
check_ok "o cabecalho explica por que nao ha mapeamento 1:1" "${box}" "${out}" "nao mapeia arquivo-fonte"

# --- --check ------------------------------------------------------------------

box="$(tree check_em_dia)"
arquivo "${box}/crates/x/src/lib.rs" "pub fn f() {}"
out="${box}.test_map"
bash "${GEN}" "${box}" "${out}" >/dev/null
check_status 0 "--check passa quando o test_map esta em dia" "${box}" "${out}" "--check"

box="$(tree check_ausente)"
arquivo "${box}/crates/x/src/lib.rs" "pub fn f() {}"
out="${box}.test_map"
check_status 1 "--check falha quando o test_map nao existe" "${box}" "${out}" "--check" -- "nao existe"

box="$(tree check_desatualizado)"
arquivo "${box}/crates/x/src/lib.rs" "pub fn f() {}"
out="${box}.test_map"
bash "${GEN}" "${box}" "${out}" >/dev/null
arquivo "${box}/crates/x/src/novo.rs" "pub fn h() {}" "" "#[cfg(test)]" "mod tests {}"
check_status 1 "--check falha quando o test_map ficou desatualizado" "${box}" "${out}" "--check" -- "desatualizado"

box="$(tree check_nao_escreve)"
arquivo "${box}/crates/x/src/lib.rs" "pub fn f() {}"
out="${box}.test_map"
printf 'conteudo antigo, de proposito\n' >"${out}"
bash "${GEN}" "${box}" "${out}" --check >/dev/null 2>&1 || true
if [[ "$(cat "${out}")" == "conteudo antigo, de proposito" ]]; then
  printf 'ok      %s\n' "--check nunca escreve, so compara"
  passed=$((passed + 1))
else
  printf 'FALHOU  --check nunca escreve, so compara\n        o arquivo foi sobrescrito\n'
  failed=$((failed + 1))
fi

# --- Saida independe do locale de quem roda -------------------------------------
#
# `sort` (usado tanto na lista de crates quanto dentro de list_section) ordena
# diferente dependendo de LC_ALL/LC_COLLATE: a colacao de "en_US.UTF-8" trata
# "." e "/" diferente da colacao "C". Um arquivo "sandbox.rs" ao lado de um
# diretorio "sandbox/" e o caso exato que muda de ordem entre as duas -- e foi
# achado assim: test_map gerado nesta maquina (en_US.UTF-8) ficou "desatualizado"
# no runner do GitHub Actions (locale diferente), embora nenhum .rs tivesse
# mudado. O gerador precisa produzir a MESMA saida em qualquer locale.

box="$(tree independe_de_locale)"
arquivo "${box}/crates/x/src/policy/confinement/sandbox.rs" "pub fn f() {}" "" "#[cfg(test)]" "mod tests {}"
arquivo "${box}/crates/x/src/policy/confinement/sandbox/profile.rs" "pub fn g() {}" "" "#[cfg(test)]" "mod tests {}"
out_c="${box}.c.test_map"
out_utf8="${box}.utf8.test_map"
LC_ALL=C bash "${GEN}" "${box}" "${out_c}" >/dev/null
LC_ALL=en_US.utf8 bash "${GEN}" "${box}" "${out_utf8}" >/dev/null
if diff -q "${out_c}" "${out_utf8}" >/dev/null; then
  printf 'ok      %s\n' "a saida e identica sob C e en_US.UTF-8"
  passed=$((passed + 1))
else
  printf 'FALHOU  %s\n        as duas saidas divergem:\n%s\n' \
    "a saida e identica sob C e en_US.UTF-8" "$(diff "${out_c}" "${out_utf8}")"
  failed=$((failed + 1))
fi

# --- Erro de uso ----------------------------------------------------------------

check_status 2 "raiz inexistente e erro de uso" "${WORK}/nao/existe" "${WORK}/saida.txt" -- "nao encontrada"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "gen-test-map-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "gen-test-map-test: ${passed} casos, todos passaram."
