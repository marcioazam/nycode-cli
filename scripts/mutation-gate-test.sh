#!/usr/bin/env bash
# Bateria do gate de mutation testing por diff (GATE-04 do padrao externo
# SOTA-2026).
#
# Mutar o workspace inteiro nao cabe num gate de PR: contamos 2144 mutantes
# no dia em que este gate foi desenhado, e cada um exige rebuild + retest
# completo -- horas, nao minutos. `cargo mutants --in-diff` restringe aos
# mutantes dentro do que o PR de fato tocou, o mesmo principio de
# scripts/diff-coverage-gate.sh (GATE-01) aplicado a um instrumento
# diferente. Em compensacao, uma rodada real de `cargo mutants` nunca e
# barata (a mais simples observada levou 18s so para o baseline) -- esta
# bateria roda UMA vez contra um crate sintetico minusculo para provar a
# fiacao de verdade, e testa toda a logica de decisao (o que conta como
# "reprovado") de forma pura, sem cargo, contra arquivos missed.txt
# sinteticos.
#
# Uso: scripts/mutation-gate-test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly GATE="${ROOT}/scripts/mutation-gate.sh"

WORK="$(mktemp -d)"
readonly WORK
trap 'rm -rf "${WORK}"' EXIT

passed=0
failed=0

ok() {
	printf 'ok      %s\n' "$1"
	passed=$((passed + 1))
}
falhou() {
	printf 'FALHOU  %s\n        %s\n' "$1" "$2"
	failed=$((failed + 1))
}

git_() { git -c user.email=test@test -c user.name=test -c commit.gpgsign=false "$@"; }

# shellcheck source=/dev/null
source "${GATE}" --source-only

if no_mutation_targets "INFO No mutants to filter"; then
	ok "cargo mutants sem alvos mutaveis -> gate passaria"
else
	falhou "cargo mutants sem alvos mutaveis -> gate passaria" "nao reconheceu a saida"
fi

# ============================================================================
# Parte 1: decisao a partir de missed.txt (pura, sem cargo)
# ============================================================================

vazio="${WORK}/vazio.txt"
: >"${vazio}"
if missed_is_empty "${vazio}"; then
	ok "missed.txt vazio -> gate passaria"
else
	falhou "missed.txt vazio -> gate passaria" "acusou mutante perdido"
fi

com_conteudo="${WORK}/com_conteudo.txt"
printf 'crates/x/src/a.rs:10:5: replace + with - in f\n' >"${com_conteudo}"
if ! missed_is_empty "${com_conteudo}"; then
	ok "missed.txt com conteudo -> gate reprovaria"
else
	falhou "missed.txt com conteudo -> gate reprovaria" "nao acusou"
fi

# ============================================================================
# Parte 2: diff scoping (pura, sem cargo -- so git)
# ============================================================================

repo() {
	local box="${WORK}/$1"
	mkdir -p "${box}/crates/x/src"
	(
		cd "${box}"
		git_ init --quiet --initial-branch=main
		printf 'pub fn f() -> i32 {\n    1\n}\n' >crates/x/src/lib.rs
		git_ add .
		git_ commit --quiet -m base
		git_ checkout --quiet -b feature
	)
	printf '%s' "${box}"
}

box="$(repo com_mudanca_rust)"
(
	cd "${box}"
	printf 'pub fn f() -> i32 {\n    2\n}\n' >crates/x/src/lib.rs
	git_ add crates/x/src/lib.rs
	git_ commit --quiet -m "muda o retorno"
)
diff_file="$(cd "${box}" && mktemp)"
(cd "${box}" && rust_diff main feature >"${diff_file}")
if [[ -s "${diff_file}" ]]; then
	ok "rust_diff produz um arquivo nao vazio quando ha mudanca em .rs"
else
	falhou "rust_diff produz um arquivo nao vazio" "veio vazio"
fi
rm -f "${diff_file}"

box="$(repo sem_mudanca_rust)"
(
	cd "${box}"
	printf 'nao e rust\n' >README.md
	git_ add README.md
	git_ commit --quiet -m "so documentacao"
)
diff_file="$(cd "${box}" && mktemp)"
(cd "${box}" && rust_diff main feature >"${diff_file}")
if [[ ! -s "${diff_file}" ]]; then
	ok "rust_diff produz arquivo vazio quando so muda .md"
else
	falhou "rust_diff produz arquivo vazio quando so muda .md" "veio com conteudo"
fi
rm -f "${diff_file}"

# ============================================================================
# Parte 3: fiacao real, contra um crate sintetico minusculo (uma vez so)
# ============================================================================

if command -v cargo-mutants >/dev/null 2>&1 || cargo mutants --version >/dev/null 2>&1; then
	crate_box="${WORK}/crate_real"
	mkdir -p "${crate_box}/src"
	cat >"${crate_box}/Cargo.toml" <<'EOF'
[package]
name = "gate-mutation-fixture"
version = "0.1.0"
edition = "2021"
EOF
	cat >"${crate_box}/src/lib.rs" <<'EOF'
pub fn soma(a: i32, b: i32) -> i32 {
    0
}
EOF
	(
		cd "${crate_box}"
		git_ init --quiet --initial-branch=main
		git_ add .
		git_ commit --quiet -m "scaffold vazio"
	)
	cat >"${crate_box}/src/lib.rs" <<'EOF'
pub fn soma(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soma_dois_mais_dois() {
        assert_eq!(soma(2, 2), 4);
    }
}
EOF
	(
		cd "${crate_box}"
		git_ add src/lib.rs
		git_ commit --quiet -m "implementa soma"
	)
	out="$(cd "${crate_box}" && bash "${GATE}" HEAD~1 HEAD 2>&1)" || true
	# A propria funcao soma() e testada por um unico caso que so cobre 2+2=4;
	# cargo-mutants tende a achar pelo menos um mutante sobrevivente aqui
	# (ex.: `a - b` tambem daria um resultado que este teste sozinho nao
	# distingue de `a + b` para alguma mutacao especifica, mas o que importa
	# para o teste e' so que o comando real rodou e produziu mutants.out.
	if [[ -d "${crate_box}/mutants.out" ]]; then
		ok "fiacao real: cargo mutants roda de ponta a ponta contra um crate de verdade"
	else
		falhou "fiacao real: cargo mutants roda de ponta a ponta" "mutants.out nao apareceu; saida: ${out}"
	fi
else
	echo "aviso: cargo-mutants nao instalado -- pulando o teste de fiacao real (partes 1 e 2 ja cobrem a logica pura)"
fi

# --- Erro de uso ----------------------------------------------------------------

check_status() {
	local want="$1" desc="$2" box="$3" base="$4" head="$5" needle="${6:-}"
	local output status=0
	output="$(cd "${box}" && bash "${GATE}" "${base}" "${head}" 2>&1)" || status=$?
	if [[ "${status}" -ne "${want}" ]]; then
		falhou "${desc}" "esperava exit ${want}, veio ${status}: ${output}"
		return
	fi
	if [[ -n "${needle}" && "${output}" != *"${needle}"* ]]; then
		falhou "${desc}" "exit ${status} correto, mas a saida nao diz \"${needle}\": ${output}"
		return
	fi
	ok "${desc}"
}

box="$(repo ref_invalida)"
check_status 2 "ref base inexistente e erro de uso" "${box}" "nao-existe" feature "nao encontrada"

# --- Resultado ------------------------------------------------------------------

echo ""
if [[ "${failed}" -gt 0 ]]; then
	echo "mutation-gate-test: ${passed} passaram, ${failed} falharam." >&2
	exit 1
fi
echo "mutation-gate-test: ${passed} casos, todos passaram."
