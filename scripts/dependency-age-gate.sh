#!/usr/bin/env bash
# Gate de idade minima de dependencia (SP-04 do padrao externo SOTA-2026
# adotado no AGENTS.md): toda dependencia nova precisa ter pelo menos 30 dias
# de existencia verificada no crates.io.
#
# O risco que isto cobre e o pacote inventado ou recem-registrado — entre 4%
# e 6% dos pacotes sugeridos por modelo sao alucinados (AI-11), e um nome
# recem-criado no registro nao teve tempo de ser identificado como tal pela
# comunidade. Trinta dias nao prova nada sozinho, mas transforma "aceitar
# cegamente o que o modelo sugeriu" em "esperar o minimo antes de confiar".
#
# So verifica dependencia NOVA — nome que nao existia no Cargo.lock da base
# do PR. Um bump de versao de dependencia ja confiada nao e o risco que isto
# cobre. Crate interno deste workspace (existe em crates/) tambem nao conta.
#
# Uso:
#   scripts/dependency-age-gate.sh                    # origin/main vs HEAD, cwd = raiz do repo
#   scripts/dependency-age-gate.sh <base> <head>       # refs explicitas, para o auto-teste

set -euo pipefail

# `comm` exige as duas entradas na mesma ordem de colacao que ele proprio usa,
# e `sort` colaciona diferente por locale -- o mesmo defeito ja encontrado em
# scripts/gen-test-map.sh (achado nesta mesma sessao). Fixado aqui pela mesma
# razao: correcao nao pode depender do ambiente de quem chama.
export LC_ALL=C

# --- Funcoes puras, sem rede ------------------------------------------------
# Nunca usam `date -d`/`date -j`: a sintaxe diverge entre GNU e BSD, e este
# script roda nas duas plataformas de release.yml. `jq` resolve data ISO8601
# de forma portavel.

age_days_from_json() { # age_days_from_json <json-da-api> -> dias desde created_at
  # crates.io emite fracao de segundo (".485040Z"), que fromdateiso8601 nao
  # aceita -- normaliza para inteiro antes de converter.
  jq -r '(now - (.crate.created_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)) / 86400 | floor' <<<"$1"
}

meets_min_age() { # meets_min_age <json-da-api> <min-dias> -> 0 se satisfaz, 1 se nao
  local json="$1" min="$2" dias
  dias="$(age_days_from_json "${json}")"
  ((dias >= min))
}

new_dependency_names() { # new_dependency_names <raiz> <base> <head> -> um nome por linha
  local root="$1" base="$2" head="$3" merge_base before after internal

  merge_base="$(git -C "${root}" merge-base "${base}" "${head}")"

  before="$(git -C "${root}" show "${merge_base}:Cargo.lock" 2>/dev/null |
    grep '^name = ' | sed 's/^name = "\(.*\)"$/\1/' | sort -u || true)"
  after="$(git -C "${root}" show "${head}:Cargo.lock" 2>/dev/null |
    grep '^name = ' | sed 's/^name = "\(.*\)"$/\1/' | sort -u || true)"
  internal="$(git -C "${root}" ls-tree --name-only "${head}" crates/ 2>/dev/null |
    sed 's#^crates/##' | sort -u || true)"

  comm -13 <(printf '%s\n' "${before}") <(printf '%s\n' "${after}") |
    grep -vxF -f <(printf '%s\n' "${internal}") || true
}

# --- Rede: existencia no registro oficial -----------------------------------
# `curl` sem User-Agent identificavel e recusado ou limitado pelo crates.io —
# a politica deles exige um agente que identifique a aplicacao.

fetch_crate_json() { # fetch_crate_json <nome> -> corpo da resposta; retorna 1 se nao existe
  local nome="$1" resposta status body
  resposta="$(curl -sS -w '\n%{http_code}' \
    -H 'User-Agent: nycode-cli-dependency-age-gate (https://github.com/marcioazam/nycode-cli)' \
    "https://crates.io/api/v1/crates/${nome}")"
  status="${resposta##*$'\n'}"
  body="${resposta%$'\n'*}"
  [[ "${status}" == "200" ]] || return 1
  printf '%s' "${body}"
}

# Sourced pelo teste para reusar as funcoes puras acima sem rodar a logica
# real, que bate na rede: `source scripts/dependency-age-gate.sh --source-only`.
if [[ "${1:-}" == "--source-only" ]]; then
  return 0 2>/dev/null || exit 0
fi

# --- Execucao real ---------------------------------------------------------

BASE="${1:-origin/main}"
HEAD="${2:-HEAD}"

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "dependency-age-gate: ref base nao encontrada: ${BASE}" >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${HEAD}" >/dev/null; then
  echo "dependency-age-gate: ref head nao encontrada: ${HEAD}" >&2
  exit 2
fi

readonly MIN_DAYS=30
novas="$(new_dependency_names "$(pwd)" "${BASE}" "${HEAD}")"

if [[ -z "${novas}" ]]; then
  echo "dependency-age-gate: nenhuma dependencia nova; nada para verificar no registro."
  exit 0
fi

failures=0
while IFS= read -r nome; do
  [[ -z "${nome}" ]] && continue
  if ! json="$(fetch_crate_json "${nome}")"; then
    echo "  FALHA: ${nome} nao encontrado no crates.io — registro nao verifica a existencia" >&2
    failures=$((failures + 1))
    continue
  fi
  if ! meets_min_age "${json}" "${MIN_DAYS}"; then
    dias="$(age_days_from_json "${json}")"
    echo "  FALHA: ${nome} tem ${dias} dia(s) no registro, abaixo do piso de ${MIN_DAYS} (SP-04)" >&2
    failures=$((failures + 1))
  fi
done <<<"${novas}"

if ((failures > 0)); then
  echo >&2
  echo "dependency-age-gate: ${failures} dependencia(s) nova(s) reprovada(s). Gate fecha." >&2
  exit 1
fi

echo "dependency-age-gate: todas as dependencias novas satisfazem o piso de ${MIN_DAYS} dias."
