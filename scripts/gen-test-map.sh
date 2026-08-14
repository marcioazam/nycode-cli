#!/usr/bin/env bash
# Gera o test_map (AI-10 do padrao externo SOTA-2026 adotado no AGENTS.md):
# um inventario, por crate, de onde os testes vivem.
#
# NAO mapeia arquivo-fonte para teste especifico. Este repositorio tem
# modulos de fixture compartilhados entre varios arquivos de teste --
# `agent_test.rs` e usado por `outcome_test.rs` e `compaction_test.rs`, por
# exemplo, e nenhum dos tres protege so o arquivo cujo nome ele ecoa. Uma
# relacao 1:1 seria falsa nesses casos, e um mapa errado ensina o agente a
# confiar onde nao devia -- pior que nenhum mapa (AI-10, "Failure modes").
# O que fica e' honesto e mecanico: por crate, onde estao os testes inline,
# os arquivos de teste dedicados e os testes de integracao.
#
# Uso:
#   scripts/gen-test-map.sh                       # regenera test_map na raiz real
#   scripts/gen-test-map.sh --check                # falha se o commitado estiver desatualizado
#   scripts/gen-test-map.sh <raiz> <saida> [--check]   # para o auto-teste

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

CHECK=0
args=()
for a in "$@"; do
  if [[ "${a}" == "--check" ]]; then
    CHECK=1
  else
    args+=("${a}")
  fi
done

TARGET="${args[0]:-${ROOT}}"
OUT="${args[1]:-${ROOT}/test_map}"

if [[ ! -d "${TARGET}/crates" ]]; then
  echo "gen-test-map: raiz nao encontrada: ${TARGET}" >&2
  exit 2
fi

list_section() { # list_section <find-args...>
  local found=0
  while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    printf '  %s\n' "${f#"${TARGET}"/}"
    found=1
  done < <("$@" 2>/dev/null | sort)
  ((found == 1)) || printf '  (nenhum)\n'
}

generate() {
  cat <<'HEADER'
# test_map -- gerado por scripts/gen-test-map.sh (AI-10 do padrao externo
# SOTA-2026). NAO EDITE A MAO: scripts/gen-test-map.sh --check falha se este
# arquivo estiver desatualizado.
#
# Inventario por crate de onde os testes vivem -- nao mapeia arquivo-fonte
# para teste especifico. Este repositorio tem modulos de fixture
# compartilhados entre varios arquivos de teste (agent_test.rs e usado por
# outcome_test.rs e compaction_test.rs, por exemplo), entao uma relacao 1:1
# seria falsa em varios casos reais. Um mapa errado ensina a confiar onde nao
# devia, o que e pior que nenhum mapa.
HEADER
  echo

  while IFS= read -r crate_dir; do
    [[ -z "${crate_dir}" ]] && continue
    printf '## %s\n\n' "$(basename "${crate_dir}")"

    printf 'Testes inline (#[cfg(test)] dentro do proprio arquivo):\n'
    list_section find "${crate_dir}/src" -type f -name '*.rs' ! -name '*_test.rs' \
      -exec grep -l '#\[cfg(test)\]' {} \;
    echo

    printf 'Arquivos de teste dedicados (mod *_test;):\n'
    list_section find "${crate_dir}/src" -type f -name '*_test.rs'
    echo

    printf 'Testes de integracao:\n'
    if [[ -d "${crate_dir}/tests" ]]; then
      list_section find "${crate_dir}/tests" -type f -name '*.rs'
    else
      printf '  (nenhum)\n'
    fi
    echo
  done < <(find "${TARGET}/crates" -mindepth 1 -maxdepth 1 -type d | sort)
}

content="$(generate)"

if ((CHECK == 1)); then
  if [[ ! -f "${OUT}" ]]; then
    echo "gen-test-map: ${OUT} nao existe. Rode scripts/gen-test-map.sh para gera-lo." >&2
    exit 1
  fi
  if [[ "${content}" != "$(cat "${OUT}")" ]]; then
    echo "gen-test-map: ${OUT} esta desatualizado. Rode scripts/gen-test-map.sh de novo." >&2
    exit 1
  fi
  echo "gen-test-map: ${OUT} esta em dia."
  exit 0
fi

printf '%s\n' "${content}" >"${OUT}"
echo "gen-test-map: ${OUT} gerado."
