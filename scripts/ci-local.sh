#!/usr/bin/env bash
# CI local do nycode: a definicao unica de "verde".
#
# Existe uma definicao so, e ela mora aqui. O workflow do GitHub chama este
# mesmo script; um CI remoto que diverge do local e um CI que ensina a ignorar o
# local, e ai o sinal que sobra e o mais lento e o menos util.
#
# Dois niveis, porque o custo e diferente e a garantia tambem:
#
#   --fast   fmt, clippy e testes. Cerca de um minuto. E o que roda a cada
#            commit: pega o erro que nao compila e o teste que quebrou, que sao
#            a maioria, sem cobrar oito minutos de quem esta iterando.
#
#   --full   a sequencia inteira do AGENTS.md, com cobertura, layout, release,
#            performance e paridade. E o que o merge exige, porque merge e a
#            fronteira depois da qual o erro deixa de ser barato.
#
# A ordem do `--full` nao e arbitraria: `cargo deny` roda ANTES do gate de
# performance, como o `needs: [supply-chain]` do workflow impoe. E o NFR-8
# literal — quando seguranca e performance se opoem, a seguranca define o que e
# aceitavel e a performance se acomoda ao que sobra (ADR-0011).
#
# Uso:
#   scripts/ci-local.sh --fast
#   scripts/ci-local.sh --full
#   scripts/ci-local.sh --check-hooks   # so confere a ativacao dos hooks

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
cd "${ROOT}"

readonly HOOKS_DIR=".githooks"

usage_error() {
  echo "ci-local: $*" >&2
  echo "  uso: scripts/ci-local.sh --fast | --full | --check-hooks" >&2
  exit 2
}

# --- Ativacao dos hooks ---------------------------------------------------------
# Um hook que ninguem ativou e pior que nenhum: ele parece proteger. O `git` nao
# tem como saber que o repositorio traz hooks versionados, entao a ativacao e um
# comando manual — e a unica forma de ela nao ser esquecida e alguem conferir.
check_hooks() {
  local configured
  configured="$(git config --get core.hooksPath || true)"
  if [[ "${configured}" == "${HOOKS_DIR}" ]]; then
    return 0
  fi
  echo "ci-local: os hooks versionados nao estao ativos neste clone." >&2
  echo "  core.hooksPath = ${configured:-<nao definido>}, esperado ${HOOKS_DIR}" >&2
  echo "  ative com: git config core.hooksPath ${HOOKS_DIR}" >&2
  return 1
}

# --- Execucao de etapa ----------------------------------------------------------
# Cada etapa anuncia o que vai fazer antes de fazer. Numa sequencia de oito
# minutos, saber em qual delas se esta e a diferenca entre esperar e desistir.
step() { # step <descricao> <comando...>
  local desc="$1"
  shift
  printf '\n=== %s\n' "${desc}"
  if ! "$@"; then
    printf '\nci-local: FALHOU em "%s". Gate fecha.\n' "${desc}" >&2
    exit 1
  fi
}

# Ferramenta ausente reprova, no mesmo precedente do `perf-gate`, que falha
# fechado sem `hyperfine`: requisito sem medicao e requisito sem gate. A
# mensagem diz como instalar, porque um gate que so diz "nao encontrado" manda
# quem le procurar sozinho o que o proprio gate ja sabe.
require_tool() { # require_tool <binario> <linha de instalacao>
  local tool="$1" install="$2"
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "ci-local: \`${tool}\` nao encontrado." >&2
    echo "  instale: ${install}" >&2
    exit 1
  fi
}

fast() {
  step "formatacao" cargo fmt --all --check
  step "clippy" cargo clippy --workspace --all-targets --all-features
  step "testes" cargo test --workspace --all-features

  # As quatro rodam em segundos e pegam o que so apareceria no remoto — actions
  # nao fixadas, permissao larga, credencial persistida, segredo commitado.
  # `-no-api`: a checagem que precisa de rede fica para o job `workflows` do CI.
  require_tool actionlint "cargo install actionlint --locked (ou: go install github.com/rhysd/actionlint/cmd/actionlint@latest)"
  step "lint dos workflows" actionlint
  require_tool zizmor "cargo install zizmor --locked (ou: pipx install zizmor)"
  step "seguranca dos workflows" zizmor --no-progress --collect all --min-severity medium .
  require_tool pinact "go install github.com/suzuki-shunsuke/pinact/cmd/pinact@latest"
  step "actions fixadas por SHA" pinact run -fix=false -no-api
  require_tool gitleaks "brew install gitleaks (ou: veja https://github.com/gitleaks/gitleaks#installing)"
  step "segredo commitado" gitleaks detect --no-banner --redact --exit-code 1
}

full() {
  fast

  # Seguranca antes de performance, literal: a politica de dependencia decide
  # antes de qualquer numero de velocidade ser produzido.
  step "politica de dependencias" cargo deny check

  # Os auto-testes dos gates vem antes dos gates: um gate quebrado que aprova e
  # pior que um gate que reprova, porque nao deixa rastro.
  step "auto-teste do gate de cobertura" scripts/coverage-gate-test.sh
  step "auto-teste do gate de layout" scripts/layout-gate-test.sh
  step "auto-teste do gate de performance" scripts/perf-gate-test.sh

  step "layout" scripts/layout-gate.sh
  step "cobertura" cargo llvm-cov --workspace --all-features --json \
    --output-path coverage.json
  step "gate de cobertura" scripts/coverage-gate.sh coverage.json

  step "build de release" cargo build --release
  step "gate de performance" scripts/perf-gate.sh

  # A paridade fecha a sequencia porque e a unica que depende de binario de
  # terceiro. Sem `PARITY_REFERENCE` ela roda em modo instrumento e diz isso em
  # voz alta, em vez de sair com zero fingindo comparacao.
  step "paridade" scripts/parity-gate.sh
}

case "${1:---fast}" in
--fast)
  fast
  printf '\nci-local: verde no nivel rapido.\n'
  ;;
--full)
  full
  printf '\nci-local: verde no nivel completo.\n'
  ;;
--check-hooks)
  check_hooks
  printf 'ci-local: hooks versionados ativos.\n'
  ;;
*)
  usage_error "argumento desconhecido: $1"
  ;;
esac
