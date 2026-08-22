#!/usr/bin/env bash
# Bateria do gate local — cobre a exigencia de hooks ativos em full().
#
# full() e o que .githooks/pre-merge-commit e .githooks/pre-push chamam para
# decidir "verde o bastante para merge". Um clone onde ninguem rodou
# `git config core.hooksPath .githooks` nao tem hook nenhum instalado — e
# `full()` precisa recusar antes de fazer qualquer trabalho real, ou "verde no
# nivel completo" vira uma frase que engana precisamente o clone que mais
# precisava do gate.
#
# ci-local.sh deriva sua propria raiz do caminho do script (nao aceita raiz
# por argumento), entao o unico jeito de isolar o teste e copiar o arquivo de
# producao, byte a byte, para dentro de uma raiz sintetica e rodar dali — o
# mesmo principio do layout-gate-test.sh, adaptado a essa diferenca.
#
# Uso: scripts/ci-local-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

sandbox() { # sandbox <nome> -> raiz sintetica com os entry points copiados
	local box="${WORK}/$1"
	mkdir -p "${box}/scripts"
	cp "${ROOT}/scripts/ci-local.sh" "${box}/scripts/ci-local.sh"
	cp "${ROOT}/scripts/verify-all" "${box}/scripts/verify-all"
	chmod +x "${box}/scripts/ci-local.sh"
	chmod +x "${box}/scripts/verify-all"
	printf '%s' "${box}"
}

# Isola a leitura de core.hooksPath da maquina que roda o teste, ou um
# hooksPath global vazaria para dentro do "clone sem hooks" e o caso pararia
# de provar o que promete provar. HOME isolado sozinho NAO basta: o `git`
# tambem le config global por $XDG_CONFIG_HOME/git/config, que HOME nao move.
# GIT_CONFIG_GLOBAL=/dev/null + GIT_CONFIG_NOSYSTEM=1 sao a primitiva real do
# git para isso — verificado: com um core.hooksPath plantado so em
# XDG_CONFIG_HOME, HOME isolado sozinho ainda vazava (2 dos 5 casos abaixo
# viravam falso-positivo), e as duas variaveis juntas fecham o vazamento.
run_isolated() { # run_isolated <raiz>
	local box="$1"
	GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 HOME="$(mktemp -d)" \
		bash "${box}/scripts/ci-local.sh" --full 2>&1
}

run_verify_all_isolated() { # run_verify_all_isolated <raiz>
	local box="$1"
	GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 HOME="$(mktemp -d)" \
		bash "${box}/scripts/verify-all" --full 2>&1
}

check() { # check <exit esperado> <descricao> <raiz> [<trecho exigido>]
	local want="$1" desc="$2" box="$3" needle="${4:-}"
	local output status=0
	output="$(run_isolated "${box}")" || status=$?

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

check_not() { # check_not <descricao> <raiz> <trecho proibido>
	local desc="$1" box="$2" needle="$3"
	local output status=0
	output="$(run_isolated "${box}")" || status=$?

	if [[ "${output}" == *"${needle}"* ]]; then
		printf 'FALHOU  %s\n        a saida nao deveria conter "%s":\n%s\n' \
			"${desc}" "${needle}" "${output}"
		failed=$((failed + 1))
		return
	fi
	printf 'ok      %s\n' "${desc}"
	passed=$((passed + 1))
}

check_verify_all() { # check_verify_all <exit esperado> <descricao> <raiz> <trecho exigido>
	local want="$1" desc="$2" box="$3" needle="$4"
	local output status=0
	output="$(run_verify_all_isolated "${box}")" || status=$?

	if [[ "${status}" -ne "${want}" || "${output}" != *"${needle}"* ]]; then
		printf 'FALHOU  %s\n        esperava exit %s e "%s", veio exit %s:\n%s\n' \
			"${desc}" "${want}" "${needle}" "${status}" "${output}"
		failed=$((failed + 1))
		return
	fi
	printf 'ok      %s\n' "${desc}"
	passed=$((passed + 1))
}

check_source_contains() { # check_source_contains <descricao> <arquivo> <trecho>
	local desc="$1" file="$2" needle="$3"
	if grep -Fq -- "${needle}" "${file}"; then
		printf 'ok      %s\n' "${desc}"
		passed=$((passed + 1))
		return
	fi
	printf 'FALHOU  %s\n        "%s" nao encontrado em %s\n' \
		"${desc}" "${needle}" "${file}"
	failed=$((failed + 1))
}

check_source_absent() { # check_source_absent <descricao> <arquivo> <trecho>
	local desc="$1" file="$2" needle="$3"
	if ! grep -Fq -- "${needle}" "${file}"; then
		printf 'ok      %s\n' "${desc}"
		passed=$((passed + 1))
		return
	fi
	printf 'FALHOU  %s\n        "%s" ainda esta em %s\n' \
		"${desc}" "${needle}" "${file}"
	failed=$((failed + 1))
}

check_full_does_not_repeat() { # check_full_does_not_repeat <descricao> <trecho>
	local desc="$1" needle="$2" body
	body="$(awk '/^full\(\) \{/ { inside = 1 } /^case / { inside = 0 } inside' \
		"${ROOT}/scripts/ci-local.sh")"
	if [[ "${body}" != *"${needle}"* ]]; then
		printf 'ok      %s\n' "${desc}"
		passed=$((passed + 1))
		return
	fi
	printf 'FALHOU  %s\n        full() repete "%s", que fast() ja executa\n' \
		"${desc}" "${needle}"
	failed=$((failed + 1))
}

# --- Contrato de custo: push verifica apenas o diff publicado ------------------

check_source_contains "pre-push verifica whitespace do diff publicado" \
	"${ROOT}/.githooks/pre-push" 'git diff --check'
check_source_absent "pre-push nao repete o baseline rapido" \
	"${ROOT}/.githooks/pre-push" 'scripts/ci-local.sh'
check_full_does_not_repeat "full() nao repete o gate de assercao vacua" \
	'scripts/vacuous-assert/gate-test.sh'
check_full_does_not_repeat "full() nao repete o gate de contrato CLI" \
	'scripts/contract/gate-test.sh'
check_full_does_not_repeat "full() nao repete o gate de invariantes de parser" \
	'scripts/parser-invariants/gate-test.sh'
check_full_does_not_repeat "full() nao repete o gate de metricas" \
	'scripts/metrics/gate-test.sh'

# --- full() recusa antes de qualquer trabalho real, sem hooks ativos ------------

box="$(sandbox sem_git)"
check 1 "sem repositorio git nenhum, full() recusa" "${box}" "hooks versionados nao estao ativos"
check_not "sem repositorio git nenhum, nenhum passo real chega a rodar" "${box}" "=== formatacao"
check_verify_all 1 "verify-all preserva a recusa sem hooks ativos" "${box}" "hooks versionados nao estao ativos"

box="$(sandbox git_sem_hookspath)"
(cd "${box}" && git init --quiet)
check 1 "git init sem core.hooksPath, full() recusa" "${box}" "hooks versionados nao estao ativos"
check_not "git init sem core.hooksPath, nenhum passo real chega a rodar" "${box}" "=== formatacao"

box="$(sandbox hookspath_errado)"
(cd "${box}" && git init --quiet && git config core.hooksPath outro-diretorio)
check 1 "core.hooksPath apontando para outro lugar, full() recusa" "${box}" "hooks versionados nao estao ativos"
check_not "core.hooksPath errado, nenhum passo real chega a rodar" "${box}" "=== formatacao"

# --- core.hooksPath absoluto para o mesmo diretorio tambem conta -----------------

box="$(sandbox hookspath_absoluto)"
(cd "${box}" && git init --quiet && git config core.hooksPath "${box}/.githooks")
check 1 "core.hooksPath absoluto apontando para .githooks, full() passa do check_hooks" \
	"${box}" "=== formatacao"
check_not "core.hooksPath absoluto correto, a mensagem de hooks inativos nao aparece" \
	"${box}" "hooks versionados nao estao ativos"

# --- com os hooks ativos (caminho relativo), full() passa do check_hooks --------

box="$(sandbox hookspath_certo)"
(cd "${box}" && git init --quiet && git config core.hooksPath .githooks)
# Sem Cargo.toml na raiz sintetica, full() passa do check_hooks e cai no
# primeiro passo real (formatacao) — a prova de que a recusa dos casos acima
# era especificamente do check_hooks, e nao de full() falhar por qualquer
# outro motivo.
check 1 "core.hooksPath certo, full() chega ate o primeiro passo real" "${box}" "=== formatacao"
check_not "core.hooksPath certo, a mensagem de hooks inativos nao aparece" \
	"${box}" "hooks versionados nao estao ativos"

# --- Resultado --------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
	echo "ci-local-test: ${passed} passaram, ${failed} falharam." >&2
	exit 1
fi
echo "ci-local-test: ${passed} casos, todos passaram."
