#!/usr/bin/env bash
# Gate de tamanho de PR assistido por IA (GATE-11/AI-01 do padrao externo
# SOTA-2026 adotado no AGENTS.md).
#
# Um PR pode nascer de um minuto de agente e nao cabe numa hora de revisao
# humana. O teto forca decomposicao, que e a unica coisa que mantem a revisao
# real. Vale so para PR assistido por IA — PR humano fica em ADV-02, que e so
# consultivo.
#
# Deteccao mecanica de "assistido por IA": qualquer commit no intervalo com
# rodape `Assisted-by:` (AI-07) poe o intervalo inteiro sob o teto. E o lado
# conservador da regra, e o unico jeito mecanico de decidir dado que a
# maioria dos commits deste repositorio ja carrega o rodape.
#
# `Cargo.lock` e `test_map` nao entram na contagem: sao gerados, nunca
# escritos a mao, exatamente o que o padrao ja exclui ("Generated code,
# lockfile churn... excluded from the count"). Um arquivo gerado novo entra
# nesta lista quando nascer, do mesmo jeito.
#
# Diferente dos outros gates, este NAO roda em scripts/ci-local.sh --full: a
# base certa de comparacao e o alvo real do PR, que so e conhecido dentro de
# um pull request (o `github.base_ref` do evento) — pode nao ser `main` num
# PR empilhado sobre outro. Localmente nao ha como adivinhar isso sem
# arriscar comparar contra a base errada, e um gate que compara contra a base
# errada e pior que nenhum. Roda so no job `pr-size` do CI.
#
# Uso:
#   scripts/agent-pr-size-gate.sh                    # origin/main vs HEAD
#   scripts/agent-pr-size-gate.sh <base> <head>       # refs explicitas, para o auto-teste

set -euo pipefail

readonly MAX_LINES=400
readonly MAX_FILES=15

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "agent-pr-size-gate: ref base nao encontrada: ${BASE}" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  echo "agent-pr-size-gate: ref head nao encontrada: ${HEAD}" >&2
  exit 2
fi

MERGE_BASE="$(git merge-base "${BASE}" "${HEAD}")"

assisted=0
while IFS= read -r sha; do
  if git show -s --format=%B "${sha}" | git interpret-trailers --parse 2>/dev/null | grep -qi '^Assisted-by:'; then
    assisted=1
    break
  fi
done < <(git rev-list "${MERGE_BASE}..${HEAD}")

if ((assisted == 0)); then
  echo "agent-pr-size-gate: nenhum commit no intervalo carrega Assisted-by; teto de agente nao se aplica (PR humano cai em ADV-02, so consultivo)."
  exit 0
fi

file_count=0
line_count=0
while IFS=$'\t' read -r added deleted path; do
  case "${path}" in
  "" | "Cargo.lock" | "test_map") continue ;;
  esac
  file_count=$((file_count + 1))
  if [[ "${added}" != "-" && "${deleted}" != "-" ]]; then
    line_count=$((line_count + added + deleted))
  fi
done < <(git diff --numstat "${MERGE_BASE}" "${HEAD}")

failures=0
if ((file_count > MAX_FILES)); then
  echo "  FALHA: ${file_count} arquivos alterados, acima do teto de ${MAX_FILES}" >&2
  failures=$((failures + 1))
fi
if ((line_count > MAX_LINES)); then
  echo "  FALHA: ${line_count} linhas alteradas, acima do teto de ${MAX_LINES}" >&2
  failures=$((failures + 1))
fi

if ((failures > 0)); then
  echo >&2
  echo "agent-pr-size-gate: PR assistido por IA acima do teto. Divida em mudancas menores, ou descreva como transformacao mecanica revisavel (GATE-11)." >&2
  exit 1
fi

echo "agent-pr-size-gate: ${file_count} arquivo(s), ${line_count} linha(s) — dentro do teto."
