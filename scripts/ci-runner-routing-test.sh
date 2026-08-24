#!/usr/bin/env bash
# Garante que branches confiaveis usem o runner local dedicado e forks usem
# GitHub-hosted, sem depender de executar um workflow remoto.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
workflow="${ROOT}/.github/workflows/ci.yml"
readonly workflow

selector="runs-on: \"\${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository && 'ubuntu-latest' || 'nycode-trusted' }}\""
readonly selector

expected_jobs=13
actual_jobs="$(grep -Fxc -- "    ${selector}" "${workflow}" || true)"
if [[ "${actual_jobs}" != "${expected_jobs}" ]]; then
	echo "ci-runner-routing-test: esperava ${expected_jobs} jobs com o seletor confiavel; encontrou ${actual_jobs}." >&2
	exit 1
fi

if grep -Fq -- 'runs-on: ubuntu-latest' "${workflow}"; then
	echo "ci-runner-routing-test: runner GitHub-hosted incondicional encontrado." >&2
	exit 1
fi

echo "ci-runner-routing-test: ${expected_jobs} jobs roteiam fork para GitHub-hosted e branch confiavel para nycode-trusted."
