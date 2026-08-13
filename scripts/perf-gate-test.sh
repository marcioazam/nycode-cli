#!/usr/bin/env bash
# Bateria do gate de performance.
#
# O gate sustenta NFR-1, NFR-2 e NFR-3, e um gate que nao pode falhar compra
# confianca sem entregar evidencia — e o mesmo argumento que o `ci.yml` ja faz
# para cobertura e para paridade. Cada caso aqui monta um repositorio sintetico,
# roda o gate de verdade sobre ele e exige o codigo de saida: 0 aprova, 1 e
# violacao de piso, 2 e erro de uso.
#
# A raiz que o gate examina e o diretorio pai do proprio script, e o baseline
# fica ao lado dele. A bateria explora as duas coisas e copia o gate para dentro
# do sandbox, em vez de abrir na producao uma costura que so ela usaria: o que
# roda aqui e o mesmo arquivo, byte a byte.
#
# O baseline e o volante de controle. Como o piso que vale e sempre o mais
# apertado entre o absoluto e o relativo, um baseline minusculo torna o relativo
# arbitrariamente apertado e reprova qualquer medicao, e um baseline enorme o
# afrouxa e deixa o absoluto governar. Isso permite exercitar cada piso sem
# depender de a maquina estar ociosa, que e o que tornaria uma bateria de
# performance intermitente.
#
# Uso: scripts/perf-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/perf-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf -- "${WORK}"' EXIT

passed=0
failed=0

# --- Montagem do repositorio sintetico -----------------------------------------

sandbox() { # sandbox <nome> -> caminho da raiz sintetica
  local box="${WORK}/$1"
  mkdir -p "${box}/scripts"
  cp "${GATE}" "${box}/scripts/perf-gate.sh"
  printf '%s' "${box}"
}

baseline() { # baseline <box> <startup_us> <rss_kb> <binary_b>
  cat >"$1/scripts/perf-baseline.txt" <<EOF
competitor       = sintetico
version          = 0.0.0
measured_at      = 2026-01-01
source_url       = https://exemplo.invalido/releases
artifact_sha256  = nao-fixado
startup_fastest_us = $2
peak_rss_kb        = $3
binary_bytes       = $4
EOF
}

# Baseline largo o bastante para que todo piso relativo fique folgado e o
# absoluto seja quem governa.
generous() { baseline "$1" 100000000 100000000 100000000; }

# `nycode` de mentira. Responde ao que o gate invoca e nada mais.
#
#   fast   sai na hora em qualquer invocacao
#   slow   demora so na sonda, para que a falha aponte o piso da sessao montada
#          e nao o da chegada do processo
#   broken monta mal: `--version` funciona, a sonda recusa
fake_bin() { # fake_bin <box> <fast|slow|broken> -> caminho do binario
  local box="$1" kind="$2" path="$1/nycode"
  case "${kind}" in
  fast) printf '#!/bin/sh\nexit 0\n' >"${path}" ;;
  slow) printf '#!/bin/sh\ncase "$1" in --probe-startup) sleep 0.02 ;; esac\nexit 0\n' >"${path}" ;;
  broken) printf '#!/bin/sh\ncase "$1" in --probe-startup) exit 3 ;; esac\nexit 0\n' >"${path}" ;;
  *)
    echo "fake_bin: tipo desconhecido ${kind}" >&2
    exit 2
    ;;
  esac
  chmod +x "${path}"
  printf '%s' "${path}"
}

check() { # check <exit esperado> <descricao> <box> <binario> [<trecho exigido>]
  local want="$1" desc="$2" box="$3" bin="$4" needle="${5:-}"
  local output status=0
  output="$(bash "${box}/scripts/perf-gate.sh" "${bin}" 2>&1)" || status=$?

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

# A maioria dos casos nao mede tempo nem memoria: as dispensas deixam a bateria
# deterministica e rapida, e os casos que exercitam esses pisos as desligam.
export PERF_ALLOW_NO_HYPERFINE=1
export PERF_ALLOW_NO_RSS=1

# --- O caminho feliz ------------------------------------------------------------

box="$(sandbox happy)"
generous "${box}"
check 0 "binario dentro de todos os pisos passa" \
  "${box}" "$(fake_bin "${box}" fast)" "todos os pisos satisfeitos"

# --- Piso relativo: o concorrente passando na frente ----------------------------
# O absoluto sozinho nao veria nenhum destes tres. E a metade do ADR-0012 que
# nao existiria se o gate so olhasse para o proprio numero.

box="$(sandbox relative_binary)"
baseline "${box}" 100000000 100000000 5
check 1 "binario acima do piso relativo reprova mesmo dentro do absoluto" \
  "${box}" "$(fake_bin "${box}" fast)" "relativo, NFR-3"

box="$(sandbox relative_rss)"
baseline "${box}" 100000000 2 100000000
PERF_ALLOW_NO_RSS=0 check 1 "RSS acima do piso relativo reprova" \
  "${box}" "$(fake_bin "${box}" fast)" "relativo, NFR-2"

box="$(sandbox relative_startup)"
baseline "${box}" 2 100000000 100000000
PERF_ALLOW_NO_HYPERFINE=0 check 1 "chegada do processo acima do piso relativo reprova" \
  "${box}" "$(fake_bin "${box}" fast)" "relativo, NFR-1"

# --- Piso absoluto da sessao montada --------------------------------------------
# A carga que o ADR-0013 acrescentou. O binario e rapido em `--version` e lento
# so na sonda, entao a falha so pode vir do piso da sessao montada — que e
# exatamente a regressao que medir `--version` nunca veria.

box="$(sandbox absolute_probe)"
generous "${box}"
PERF_ALLOW_NO_HYPERFINE=0 check 1 "sessao montada acima do piso absoluto reprova" \
  "${box}" "$(fake_bin "${box}" slow)" "Sessao montada"

# --- A sonda que nao monta ------------------------------------------------------
# Sem esta verificacao o gate mediria o custo de desistir, que passa folgado em
# qualquer piso: um binario que nao abre sessao nenhuma seria o mais rapido.

box="$(sandbox probe_broken)"
generous "${box}"
check 1 "sonda que nao completa reprova em vez de virar medicao" \
  "${box}" "$(fake_bin "${box}" broken)" "nao completou"

# --- Instrumento ausente falha fechado ------------------------------------------
# Pular a medicao em silencio deixaria o requisito sem gate nenhum sem que nada
# indicasse isso.

box="$(sandbox no_hyperfine)"
generous "${box}"
PERF_ALLOW_NO_HYPERFINE=0 PERF_HYPERFINE=/nao/existe/hyperfine \
  check 1 "hyperfine ausente sem dispensa reprova" \
  "${box}" "$(fake_bin "${box}" fast)" "NFR-1 nao pode ser medido"

box="$(sandbox no_time)"
generous "${box}"
PERF_ALLOW_NO_RSS=0 PERF_TIME=/nao/existe/time \
  check 1 "/usr/bin/time ausente sem dispensa reprova" \
  "${box}" "$(fake_bin "${box}" fast)" "NFR-2 nao pode ser medido"

box="$(sandbox dispensed)"
generous "${box}"
PERF_HYPERFINE=/nao/existe/hyperfine PERF_TIME=/nao/existe/time \
  check 0 "dispensa declarada deixa o gate seguir sem os instrumentos" \
  "${box}" "$(fake_bin "${box}" fast)" "dispensada por"

# --- Erro de uso ----------------------------------------------------------------
# Sai como 2, e nao como violacao de piso: nao ha medicao para comparar, e tratar
# isso como reprovacao esconderia a diferenca entre "regrediu" e "nao mediu".

box="$(sandbox no_binary)"
generous "${box}"
check 2 "binario ausente e erro de uso" "${box}" "${box}/nao-existe" "nao encontrado"

box="$(sandbox no_baseline)"
check 2 "baseline ausente e erro de uso" \
  "${box}" "$(fake_bin "${box}" fast)" "baseline nao encontrado"

box="$(sandbox baseline_missing_key)"
generous "${box}"
grep -v '^peak_rss_kb' "${box}/scripts/perf-baseline.txt" >"${box}/tmp"
mv "${box}/tmp" "${box}/scripts/perf-baseline.txt"
check 2 "baseline sem chave obrigatoria e erro de uso" \
  "${box}" "$(fake_bin "${box}" fast)" "chave obrigatoria"

box="$(sandbox baseline_not_a_number)"
baseline "${box}" "muito-rapido" 100000000 100000000
check 2 "baseline com valor nao numerico e erro de uso" \
  "${box}" "$(fake_bin "${box}" fast)" "nao e um numero"

box="$(sandbox baseline_zero)"
baseline "${box}" 100000000 0 100000000
check 2 "baseline com zero e erro de uso" \
  "${box}" "$(fake_bin "${box}" fast)" "maior que zero"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
  echo "perf-gate-test: ${failed} caso(s) falharam, ${passed} passaram." >&2
  exit 1
fi
echo "perf-gate-test: ${passed} casos, todos passaram."
