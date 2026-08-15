#!/usr/bin/env bash
# Gate de mutation testing por diff (GATE-04 do padrao externo SOTA-2026
# adotado no AGENTS.md): nenhum mutante sobrevivente nas linhas que o PR
# tocou.
#
# Mutar o workspace inteiro nao cabe num gate de PR -- 2144 mutantes
# contados no dia em que este gate foi desenhado, cada um exigindo rebuild
# e retest completo. `cargo mutants --in-diff` restringe aos mutantes dentro
# do que o PR de fato tocou, o mesmo principio de diff-coverage-gate.sh
# (GATE-01) aplicado a um instrumento diferente: cobertura pergunta "essa
# linha rodou?", mutation testing pergunta "se essa linha estivesse errada,
# algum teste perceberia?" -- a segunda pergunta e' estritamente mais forte,
# e e' por isso que o padrao externo trata mutation score como "a prova",
# cobertura como "o piso".
#
# Nao ratcheta contra o legado do resto do workspace, ao contrario do teto
# de 500 linhas por arquivo: como o escopo ja e' so o diff, nao ha legado
# dentro do escopo por definicao -- o PR so e' responsavel pelo que ele
# proprio tocou.
#
# Uso:
#   scripts/mutation-gate.sh [<base>] [<head>]
#     <base>  default origin/main
#     <head>  default HEAD

set -euo pipefail

# --- Funcoes puras, sem cargo -------------------------------------------------

missed_is_empty() { # missed_is_empty <missed.txt> -> 0 se vazio (gate passa)
  [[ ! -s "$1" ]]
}

rust_diff() { # rust_diff <base> <head> -> diff unificado de .rs, no cwd atual
  git diff "${1}" "${2}" -- '*.rs'
}

# Sourced pelo teste para reusar as funcoes puras acima.
if [[ "${1:-}" == "--source-only" ]]; then
  return 0 2>/dev/null || exit 0
fi

# --- Execucao real ------------------------------------------------------------

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "mutation-gate: ref base nao encontrada: ${BASE}" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  echo "mutation-gate: ref head nao encontrada: ${HEAD}" >&2
  exit 2
fi
if ! command -v cargo-mutants >/dev/null 2>&1 && ! cargo mutants --version >/dev/null 2>&1; then
  echo "mutation-gate: \`cargo-mutants\` nao encontrado." >&2
  echo "  instale: cargo install cargo-mutants --locked" >&2
  exit 1
fi

diff_file="$(mktemp)"
trap 'rm -f "${diff_file}"' EXIT
rust_diff "${BASE}" "${HEAD}" >"${diff_file}"

if [[ ! -s "${diff_file}" ]]; then
  echo "mutation-gate: nenhuma mudanca em .rs; nada para mutar."
  exit 0
fi

# --no-shuffle: ordem deterministica, o log fica igual entre execucoes do
# mesmo diff. mutants.out/ fica no cwd -- limpo pelo proprio cargo-mutants
# a cada execucao.
cargo mutants --in-diff "${diff_file}" --no-shuffle || true

if [[ ! -f mutants.out/missed.txt ]]; then
  echo "mutation-gate: mutants.out/missed.txt nao apareceu; a execucao do cargo-mutants falhou antes de terminar." >&2
  exit 1
fi

if ! missed_is_empty mutants.out/missed.txt; then
  echo "  FALHA: mutante(s) sobrevivente(s) nas linhas que este PR tocou (GATE-04):" >&2
  sed 's/^/    /' mutants.out/missed.txt >&2
  echo >&2
  echo "mutation-gate: reprovado." >&2
  exit 1
fi

echo "mutation-gate: nenhum mutante sobrevivente nas linhas tocadas por este PR."
