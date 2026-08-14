#!/usr/bin/env bash
# Gate de performance do nycode: NFR-1 (startup), NFR-2 (memoria residente) e
# NFR-3 (binario auto-contido), medidos sobre o build padrao de release com
# todo controle de seguranca ativo, como o NFR-8 exige.
#
# Duas decisoes moldam este arquivo.
#
# O ADR-0012 deu a cada metrica dois pisos, ambos duros, ambos falhando
# fechado: um absoluto, perto do valor medido, que pega regressao nossa; e um
# relativo ao concorrente, que pega o mercado passando na frente. Vale sempre o
# mais apertado dos dois. Um piso muito abaixo do valor real nao e piso, e
# decoracao — nao impede regressao nenhuma ate que a regressao seja enorme.
#
# O ADR-0013 corrigiu o que era medido. `--version` nao alcanca o caminho que o
# NFR-1 descreve: o `clap` o resolve dentro de `Cli::parse()` e encerra o
# processo antes do runtime, da credencial, do disco e do MCP. Por isso ha duas
# cargas aqui, e nao uma:
#
#   `--version`        chegada do processo — exec, link e argumentos. E o que
#                      tem par comparavel no concorrente.
#   `--probe-startup`  sessao montada de verdade. E o que o NFR-1 e o NFR-2
#                      descrevem, e nao tem par comparavel: o concorrente nao
#                      expoe uma sonda equivalente, entao aqui so ha piso
#                      absoluto. Um piso relativo sem medicao do outro lado
#                      seria ficcao.
#
# Uso: scripts/perf-gate.sh [caminho-do-binario]

set -euo pipefail

# --- Pisos absolutos -----------------------------------------------------------
# Calibrados perto do valor medido. Os da carga `--version` vem do ADR-0012; os
# da sonda vem da medicao do ADR-0013 e guardam a mesma folga de cerca de 5x
# que o ADR-0012 adotou, porque o caminho real e mais exposto a variancia de
# runner compartilhado do que um `--version` que nao toca disco nem processo.
readonly VERSION_STARTUP_FLOOR_US=3000
readonly VERSION_RSS_FLOOR_KB=8192
readonly BINARY_FLOOR_B=16777216 # 16 MiB
readonly PROBE_STARTUP_FLOOR_US=15000
readonly PROBE_RSS_FLOOR_KB=14336 # 14 MiB

# --- Divisores do piso relativo ------------------------------------------------
# Por metrica, e nao uniformes, porque as razoes medidas diferem por quase cinco
# vezes entre elas: 21,8x em tempo contra 4,4x em memoria. Uma margem uniforme
# de 5x reprovaria hoje em memoria e seria frouxa em tempo.
# Startup em /2 e nao em /3 desde o ADR-0031: a primeira execucao real de CI
# deste repositorio mediu 1163-1178us (minimo de 200, no runner do GitHub
# Actions) contra um piso de 1148us em /3 — o runner e quase 3x mais lento
# aqui do que a maquina de desenvolvimento (386-410us), um salto maior que o
# pior caso local (560us) que motivou o /3 original. /2 da 1723us, cerca de
# 46% de folga sobre o pior valor de CI observado. Ainda assim menos folga que
# o /3 original dava sobre o mercado — o ADR-0031 registra a troca.
readonly STARTUP_RATIO=2
readonly RSS_RATIO=2
readonly BINARY_RATIO=5

readonly WARMUP=20
readonly RUNS=200

# Quanto a sonda segura a sessao parada antes de sair. O pico que o NFR-2 orca e
# o de uma sessao ociosa, e alocacao preguicosa — pool de threads do runtime,
# buffers das conexoes MCP — so assenta depois que o processo para de montar.
readonly PROBE_IDLE_MS=250

# Onde as ferramentas externas sao procuradas. Sao variaveis para que quem as
# tenha fora do PATH padrao aponte o gate sem editar o script, e para que a
# bateria consiga exercitar o caminho de ausencia.
HYPERFINE="${PERF_HYPERFINE:-hyperfine}"
TIME_BIN="${PERF_TIME:-/usr/bin/time}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly BASELINE="${ROOT}/scripts/perf-baseline.txt"

# Respeita CARGO_TARGET_DIR: em sandboxes e caches compartilhados o `target/`
# nao fica sob a raiz do repositorio.
TARGET_DIR="${CARGO_TARGET_DIR:-${ROOT}/target}"
BIN="${1:-${TARGET_DIR}/release/nycode}"
if [[ ! -x "${BIN}" ]]; then
  echo "perf-gate: binario nao encontrado ou nao executavel: ${BIN}" >&2
  echo "  compile com: cargo build --release" >&2
  exit 2
fi

usage_error() {
  echo "perf-gate: $*" >&2
  exit 2
}

failures=0
fail() {
  echo "  FALHA: $*" >&2
  failures=$((failures + 1))
}

# --- Baseline do concorrente ----------------------------------------------------
# Lido de arquivo, nunca da rede: o CI de PR nao pode quebrar por motivo alheio
# ao diff sob revisao. Quem mede o concorrente e o workflow agendado.
[[ -f "${BASELINE}" ]] || usage_error "baseline nao encontrado: ${BASELINE#"${ROOT}/"}"

declare -A base=()
while IFS= read -r line; do
  line="${line%%#*}"
  [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
  [[ "${line}" == *=* ]] || usage_error "linha sem '=' no baseline: ${line}"
  key="${line%%=*}"
  value="${line#*=}"
  # Sem `xargs` nem subshell: o corte de espaco em bash e mais barato e nao
  # depende de mais um binario estar instalado.
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  base["${key}"]="${value}"
done <"${BASELINE}"

for key in competitor version measured_at source_url artifact_sha256 \
  startup_fastest_us peak_rss_kb binary_bytes; do
  [[ -n "${base[${key}]:-}" ]] || usage_error "baseline sem a chave obrigatoria '${key}'"
done

for key in startup_fastest_us peak_rss_kb binary_bytes; do
  value="${base[${key}]}"
  [[ "${value}" =~ ^[0-9]+$ ]] || usage_error "baseline: '${key}' nao e um numero: ${value}"
  [[ "${value}" -gt 0 ]] || usage_error "baseline: '${key}' precisa ser maior que zero"
done

echo "Baseline: ${base[competitor]} ${base[version]}, medido em ${base[measured_at]}"
if [[ "${base[artifact_sha256]}" == "nao-fixado" ]]; then
  echo "  nota: digest do artefato ainda nao fixado; quem depende dele e o" >&2
  echo "        workflow agendado, nao este gate, que nunca baixa nada." >&2
fi

# --- Pisos efetivos -------------------------------------------------------------
# O mais apertado dos dois. Quando o relativo governa, o concorrente melhorou o
# bastante para apertar nossa barra; quando o absoluto governa, ele nao alcanca.
effective_floor() { # effective_floor <absoluto> <baseline> <divisor> -> piso, origem
  local absolute="$1" baseline="$2" ratio="$3" relative
  relative=$((baseline / ratio))
  # A quebra de linha e obrigatoria: sem ela o `read` que consome esta saida
  # encontra EOF antes dela, devolve 1, e o `set -e` derruba o gate no meio da
  # medicao — falha silenciosa exatamente onde ela seria menos percebida.
  if [[ "${relative}" -lt "${absolute}" ]]; then
    printf '%s relativo\n' "${relative}"
  else
    printf '%s absoluto\n' "${absolute}"
  fi
}

check() { # check <rotulo> <medido> <piso> <origem> <unidade> <nfr>
  local label="$1" measured="$2" floor="$3" origin="$4" unit="$5" nfr="$6"
  echo "${label}: ${measured}${unit} (piso ${floor}${unit}, ${origin} — ${nfr})"
  if [[ "${measured}" -gt "${floor}" ]]; then
    fail "${label} ${measured}${unit} excede o piso ${floor}${unit} (${origin}, ${nfr})"
  fi
}

# --- Instrumentos ---------------------------------------------------------------
# Falham fechado. Nenhum dos dois vem na imagem do CI, e pular a medicao em
# silencio deixaria o requisito sem gate nenhum sem que nada indicasse isso. As
# dispensas existem para quem mede onde a ferramenta nao esta, e ficam
# explicitas em vez de acidentais.
have_hyperfine=1
if ! command -v "${HYPERFINE}" >/dev/null 2>&1; then
  if [[ "${PERF_ALLOW_NO_HYPERFINE:-0}" == "1" ]]; then
    echo "Startup: ${HYPERFINE} indisponivel, medicao dispensada por PERF_ALLOW_NO_HYPERFINE" >&2
    have_hyperfine=0
  else
    fail "${HYPERFINE} indisponivel; NFR-1 nao pode ser medido."
    echo "         instale hyperfine, ou declare a dispensa com PERF_ALLOW_NO_HYPERFINE=1" >&2
    have_hyperfine=0
  fi
fi

have_time=1
if ! command -v "${TIME_BIN}" >/dev/null 2>&1; then
  if [[ "${PERF_ALLOW_NO_RSS:-0}" == "1" ]]; then
    echo "RSS: ${TIME_BIN} indisponivel, medicao dispensada por PERF_ALLOW_NO_RSS" >&2
    have_time=0
  else
    fail "${TIME_BIN} indisponivel; NFR-2 nao pode ser medido."
    echo "         instale o pacote 'time', ou declare a dispensa com PERF_ALLOW_NO_RSS=1" >&2
    have_time=0
  fi
fi

# --- Workspace da sonda ---------------------------------------------------------
# Temporario e semeado, para que a medicao seja da montagem da sessao e nao do
# repositorio em que o gate por acaso rodou. O catalogo entra fresco em disco
# para que `resolve` responda do cache: a ida a rede e do gateway, nao nossa, e
# incluí-la mediria a latencia dele.
#
# A credencial vem do ambiente. Em CI nao ha cofre do sistema, e depender dele
# tornaria a medicao dependente do `dbus` da maquina — o caminho de cofre fica,
# assim, fora do que este gate cobre.
WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf -- "${WORK}"' EXIT

readonly PROBE_URL="http://127.0.0.1:1/v1"
mkdir -p "${WORK}/ws/.nycode"
printf '{"fetched_at":%s000,"base_url":"%s","models":[{"id":"nylla-sonnet-4.5","display_name":"Nylla Sonnet 4.5","context_window":200000,"max_output_tokens":8192}]}' \
  "$(date +%s)" "${PROBE_URL}" >"${WORK}/ws/.nycode/catalog.json"

export NYCODE_API_KEY="${NYCODE_API_KEY:-perf-gate}"
probe_args=(--probe-startup --cwd "${WORK}/ws" --base-url "${PROBE_URL}")

# A sonda precisa completar antes de virar medida. Se ela falhar, o numero seria
# o custo de desistir, que passaria folgado em qualquer piso.
#
# E a medicao dela para de acontecer a partir daqui. Insistir transformaria uma
# violacao — o binario nao monta sessao — num erro de uso vindo do instrumento,
# que e a diferenca entre "regrediu" e "nao mediu".
probe_ok=1
if ! "${BIN}" "${probe_args[@]}" >/dev/null 2>&1; then
  fail "a sonda de startup nao completou; o binario nao monta uma sessao aqui"
  echo "         reproduza com: ${BIN} ${probe_args[*]}" >&2
  probe_ok=0
fi

# O menor tempo observado, e nao a mediana, porque num runner compartilhado a
# mediana mede a contencao e o minimo mede o programa. A escolha vem de medicao,
# nao de gosto: repetindo a mesma amostragem numa maquina em load average 89, o
# minimo do `--version` ficou entre 465us e 560us — dispersao de 1,2x — enquanto
# a mediana foi de 1033us a 3580us, dispersao de 3,5x. Com a mediana, este gate
# reprovava um binario sem nenhuma regressao. O mesmo vale do outro lado: o
# baseline guarda o minimo do concorrente, porque comparar nosso minimo com a
# mediana dele inflaria a razao a nosso favor.
fastest_us() { # fastest_us <argumentos do binario...> -> menor tempo em microssegundos
  local json="${WORK}/hyperfine.json"
  "${HYPERFINE}" --shell=none --warmup "${WARMUP}" --runs "${RUNS}" \
    --export-json "${json}" -- "$*" >/dev/null 2>&1 || return 1
  awk 'match($0, /"min"[[:space:]]*:[[:space:]]*[0-9.e+-]+/) {
         v = substr($0, RSTART, RLENGTH); sub(/.*:[[:space:]]*/, "", v)
         printf "%d\n", v * 1000000; exit
       }' "${json}"
}

peak_rss_kb() { # peak_rss_kb <argumentos do binario...> -> pico em KB
  "${TIME_BIN}" -f '%M' "$@" 2>&1 >/dev/null | tail -1
}

# --- NFR-1: startup -------------------------------------------------------------
if [[ "${have_hyperfine}" -eq 1 ]]; then
  read -r floor origin < <(effective_floor \
    "${VERSION_STARTUP_FLOOR_US}" "${base[startup_fastest_us]}" "${STARTUP_RATIO}")
  measured="$(fastest_us "${BIN} --version")" ||
    usage_error "hyperfine falhou ao medir ${BIN} --version"
  [[ "${measured}" =~ ^[0-9]+$ ]] || usage_error "hyperfine nao devolveu um minimo utilizavel"
  check "Chegada do processo" "${measured}" "${floor}" "${origin}" "us" "NFR-1"

  if [[ "${probe_ok}" -eq 1 ]]; then
    measured="$(fastest_us "${BIN} ${probe_args[*]}")" ||
      usage_error "hyperfine falhou ao medir a sonda de startup"
    [[ "${measured}" =~ ^[0-9]+$ ]] || usage_error "hyperfine nao devolveu um minimo utilizavel"
    check "Sessao montada" "${measured}" "${PROBE_STARTUP_FLOOR_US}" "absoluto" "us" "NFR-1"
  fi
fi

# --- NFR-2: memoria residente ---------------------------------------------------
if [[ "${have_time}" -eq 1 ]]; then
  read -r floor origin < <(effective_floor \
    "${VERSION_RSS_FLOOR_KB}" "${base[peak_rss_kb]}" "${RSS_RATIO}")
  measured="$(peak_rss_kb "${BIN}" --version)"
  if [[ "${measured}" =~ ^[0-9]+$ ]]; then
    check "RSS na chegada" "${measured}" "${floor}" "${origin}" "KB" "NFR-2"
  else
    fail "${TIME_BIN} devolveu '${measured}', que nao e uma medicao (NFR-2)"
  fi

  if [[ "${probe_ok}" -eq 1 ]]; then
    measured="$(peak_rss_kb "${BIN}" --probe-startup "${PROBE_IDLE_MS}" \
      --cwd "${WORK}/ws" --base-url "${PROBE_URL}")"
    if [[ "${measured}" =~ ^[0-9]+$ ]]; then
      check "RSS de sessao ociosa" "${measured}" "${PROBE_RSS_FLOOR_KB}" "absoluto" "KB" "NFR-2"
    else
      fail "${TIME_BIN} devolveu '${measured}', que nao e uma medicao (NFR-2)"
    fi
  fi
fi

# --- NFR-3: binario auto-contido ------------------------------------------------
# O harness de referencia falha aqui: o binario compilado le package.json e
# theme/* do proprio diretorio (pi issue #5108). O nycode roda de qualquer lugar.
cp "${BIN}" "${WORK}/nycode"
if ! (cd / && "${WORK}/nycode" --version >/dev/null 2>&1); then
  fail "binario nao executa isolado de arquivos irmaos (NFR-3)"
else
  read -r floor origin < <(effective_floor \
    "${BINARY_FLOOR_B}" "${base[binary_bytes]}" "${BINARY_RATIO}")
  size="$(stat -c%s "${BIN}" 2>/dev/null || stat -f%z "${BIN}")"
  check "Binario auto-contido" "${size}" "${floor}" "${origin}" "B" "NFR-3"
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "" >&2
  echo "perf-gate: ${failures} violacao(oes). Gate fecha." >&2
  exit 1
fi

echo "perf-gate: todos os pisos satisfeitos."
