#!/usr/bin/env bash
# Bateria do gate de fronteira de arquitetura (GATE-15/ARCH-04/ARCH-05 do
# padrao externo SOTA-2026): o grafo de dependencia entre crates internos.
#
# Cada caso monta um workspace sintetico (crates/<nome>/Cargo.toml com um
# bloco [dependencies]) e sua propria allowlist, roda o gate de producao e
# exige o codigo de saida. 0 aprova, 1 e violacao (aresta nova ou entrada
# obsoleta na allowlist), 2 e erro de uso.
#
# Uso: scripts/architecture-boundary-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/architecture-boundary-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

tree() { # tree <nome> -> caminho da raiz sintetica
  local box="${WORK}/$1"
  mkdir -p "${box}/crates"
  printf '%s' "${box}"
}

# crate <raiz> <nome> [<dependencia-interna>...]
crate() {
  local box="$1" nome="$2"
  shift 2
  local dir="${box}/crates/${nome}"
  mkdir -p "${dir}"
  {
    printf '[package]\nname = "%s"\nversion = "0.1.0"\n\n[dependencies]\n' "${nome}"
    for dep in "$@"; do
      printf '%s = { version = "0.1.0", path = "../%s" }\n' "${dep}" "${dep}"
    done
    printf 'serde = "1"\n'
  } >"${dir}/Cargo.toml"
}

# allowlist <raiz> <linha...> -> caminho do arquivo
allowlist() {
  local box="$1"
  shift
  local file="${box}.allowlist.txt"
  printf '%s\n' "$@" >"${file}"
  printf '%s' "${file}"
}

check() { # check <exit esperado> <descricao> <raiz> <allowlist> [<trecho exigido>]
  local want="$1" desc="$2" box="$3" allow="$4" needle="${5:-}"
  local output status=0
  output="$(bash "${GATE}" "${box}" "${allow}" 2>&1)" || status=$?

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

# --- Aresta permitida passa, nao declarada reprova ------------------------------

box="$(tree aresta_permitida)"
crate "${box}" a
crate "${box}" b a
allow="$(allowlist "${box}" "b -> a")"
check 0 "aresta na allowlist passa" "${box}" "${allow}"

box="$(tree aresta_nova_sem_declarar)"
crate "${box}" a
crate "${box}" b a
allow="$(allowlist "${box}")"
check 1 "aresta real sem entrada na allowlist reprova" "${box}" "${allow}" "b -> a"

box="$(tree diz_o_que_falta_declarar)"
crate "${box}" x
crate "${box}" y x
allow="$(allowlist "${box}")"
check 1 "a falha nomeia a aresta que falta declarar" "${box}" "${allow}" "y -> x"

# --- Allowlist obsoleta tambem reprova ------------------------------------------

box="$(tree allowlist_obsoleta_dependencia_removida)"
crate "${box}" a
crate "${box}" b
allow="$(allowlist "${box}" "b -> a")"
check 1 "allowlist citando aresta que nao existe mais reprova" "${box}" "${allow}" "obsoleta"

# --- Grafo sem dependencia interna nenhuma passa --------------------------------

box="$(tree sem_dependencia_interna)"
crate "${box}" a
crate "${box}" b
allow="$(allowlist "${box}")"
check 0 "workspace sem nenhuma dependencia interna passa com allowlist vazia" "${box}" "${allow}"

# --- Varios crates, grafo em cadeia ---------------------------------------------

box="$(tree cadeia_de_tres)"
crate "${box}" a
crate "${box}" b a
crate "${box}" c b
allow="$(allowlist "${box}" "b -> a" "c -> b")"
check 0 "cadeia a <- b <- c com as duas arestas declaradas passa" "${box}" "${allow}"

box="$(tree cadeia_com_uma_reprovando)"
crate "${box}" a
crate "${box}" b a
crate "${box}" c b
allow="$(allowlist "${box}" "b -> a")"
check 1 "falta so uma entrada, e so ela reprova" "${box}" "${allow}" "c -> b"

# --- Comentarios e linhas vazias na allowlist sao ignorados --------------------

box="$(tree allowlist_com_comentario)"
crate "${box}" a
crate "${box}" b a
allow="$(allowlist "${box}" "# comentario" "" "b -> a")"
check 0 "comentario e linha vazia na allowlist sao ignorados" "${box}" "${allow}"

# --- Erro de uso ----------------------------------------------------------------

allow="$(allowlist "$(tree raiz_p_allow_de_uso)")"
check 2 "raiz inexistente e erro de uso, nao aprovacao" "${WORK}/nao/existe" "${allow}" "nao encontrada"

box="$(tree allowlist_inexistente)"
check 2 "allowlist inexistente e erro de uso" "${box}" "${WORK}/nao-existe.txt" "nao encontrada"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "architecture-boundary-gate-test: ${passed} passaram, ${failed} falharam." >&2
  exit 1
fi
echo "architecture-boundary-gate-test: ${passed} casos, todos passaram."
