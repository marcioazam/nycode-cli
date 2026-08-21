#!/usr/bin/env bash
# Bateria do gate de atribuicao (AI-07..09).
set -euo pipefail

# Hooks recebem GIT_DIR do repositorio que os chamou. O teste cria repositorios
# temporarios e precisa deixar o git -C escolher o sandbox, nao o repositorio do
# hook.
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/attribution/gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

sandbox_gate() {
	local box="$1"
	mkdir -p "${box}/scripts/attribution"
	cp "${GATE}" "${box}/scripts/attribution/gate.sh"
	chmod +x "${box}/scripts/attribution/gate.sh"
}

run_gate() {
	local box="$1"
	shift
	bash "${box}/scripts/attribution/gate.sh" "$@" 2>&1
}

setup() {
	local box="$1"
	mkdir -p "${box}"
	git -C "${box}" init --quiet
	git -C "${box}" config user.email "dev@example.com"
	git -C "${box}" config user.name "Dev"
	printf 'a\n' >"${box}/f.txt"
	git -C "${box}" add f.txt
	git -C "${box}" commit --quiet -m "base"
	sandbox_gate "${box}"
}

box="${WORK}/humano"
setup "${box}"
printf 'b\n' >>"${box}/f.txt"
git -C "${box}" add f.txt
git -C "${box}" commit --quiet -m "feat: so humano"
output="$(run_gate "${box}" "HEAD~1" "HEAD")" && status=0 || status=$?
if [[ "${status}" -eq 0 ]]; then
	printf 'ok      %s\n' "commit humano sem Assisted-by passa"
	passed=$((passed + 1))
else
	printf 'FALHOU  humano sem Assisted-by deveria passar:\n%s\n' "${output}"
	failed=$((failed + 1))
fi

box="${WORK}/coauthor"
setup "${box}"
printf 'b\n' >>"${box}/f.txt"
git -C "${box}" add f.txt
git -C "${box}" commit --quiet -m "$(printf 'feat: x\n\nCo-Authored-By: Grok <grok@x.ai>\n')"
output="$(run_gate "${box}" "HEAD~1" "HEAD")" && status=0 || status=$?
if [[ "${status}" -eq 1 && "${output}" == *"Co-Authored-By"* ]]; then
	printf 'ok      %s\n' "Co-Authored-By de modelo reprova"
	passed=$((passed + 1))
else
	printf 'FALHOU  Co-Authored-By de modelo: exit %s\n%s\n' "${status}" "${output}"
	failed=$((failed + 1))
fi

box="${WORK}/signoff"
setup "${box}"
printf 'b\n' >>"${box}/f.txt"
git -C "${box}" add f.txt
git -C "${box}" commit --quiet -m "$(printf 'feat: x\n\nAssisted-by: cursor:grok-4.6\nSigned-off-by: Bot <bot@x>\n')"
output="$(run_gate "${box}" "HEAD~1" "HEAD")" && status=0 || status=$?
if [[ "${status}" -eq 1 && "${output}" == *"Signed-off-by"* ]]; then
	printf 'ok      %s\n' "Assisted-by mais Signed-off-by reprova"
	passed=$((passed + 1))
else
	printf 'FALHOU  sign-off de maquina: exit %s\n%s\n' "${status}" "${output}"
	failed=$((failed + 1))
fi

box="${WORK}/assisted"
setup "${box}"
printf 'b\n' >>"${box}/f.txt"
git -C "${box}" add f.txt
git -C "${box}" commit --quiet -m "$(printf 'feat: x\n\nAssisted-by: cursor:grok-4.6\n')"
output="$(run_gate "${box}" "HEAD~1" "HEAD")" && status=0 || status=$?
if [[ "${status}" -eq 0 ]]; then
	printf 'ok      %s\n' "Assisted-by sem sign-off de maquina passa"
	passed=$((passed + 1))
else
	printf 'FALHOU  Assisted-by valido deveria passar:\n%s\n' "${output}"
	failed=$((failed + 1))
fi

echo ""
if [[ "${failed}" -gt 0 ]]; then
	echo "attribution-gate-test: ${passed} passaram, ${failed} falharam." >&2
	exit 1
fi
echo "attribution-gate-test: ${passed} casos, todos passaram."
