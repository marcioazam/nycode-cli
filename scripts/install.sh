#!/usr/bin/env bash
# Instalador do nycode.
#
# Baixa o binario da release correspondente a esta plataforma e o coloca em
# ~/.local/bin. Nao ha runtime a instalar: o nycode e um binario estatico
# (NFR-3), e o instalador nao precisa de node, python nem de um gerenciador de
# pacotes.
#
#   curl -fsSL https://raw.githubusercontent.com/nylla/nycode-cli/main/scripts/install.sh | bash
#
# Variaveis:
#   NYCODE_VERSION   tag a instalar (padrao: a ultima)
#   NYCODE_BIN_DIR   destino (padrao: ~/.local/bin)

set -euo pipefail

readonly REPO="nylla/nycode-cli"
VERSION="${NYCODE_VERSION:-latest}"
BIN_DIR="${NYCODE_BIN_DIR:-${HOME}/.local/bin}"

die() {
	echo "install: $*" >&2
	exit 1
}

# --- Alvo -----------------------------------------------------------------
detect_target() {
	local os arch
	os="$(uname -s)"
	arch="$(uname -m)"

	case "${os}" in
	Linux) os="unknown-linux-gnu" ;;
	Darwin) os="apple-darwin" ;;
	*) die "sistema nao suportado: ${os}" ;;
	esac

	case "${arch}" in
	x86_64 | amd64) arch="x86_64" ;;
	aarch64 | arm64) arch="aarch64" ;;
	*) die "arquitetura nao suportada: ${arch}" ;;
	esac

	echo "${arch}-${os}"
}

for tool in curl tar; do
	command -v "${tool}" >/dev/null 2>&1 || die "${tool} e obrigatorio"
done
if command -v sha256sum >/dev/null 2>&1; then
	readonly CHECKSUM_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
	readonly CHECKSUM_TOOL="shasum"
else
	die "sha256sum ou shasum e obrigatorio"
fi

TARGET="$(detect_target)"
readonly TARGET

if [[ "${VERSION}" == "latest" ]]; then
	URL="https://github.com/${REPO}/releases/latest/download/nycode-${TARGET}.tar.gz"
else
	URL="https://github.com/${REPO}/releases/download/${VERSION}/nycode-${TARGET}.tar.gz"
fi

echo "Instalando nycode (${TARGET}) em ${BIN_DIR}"

TMP="$(mktemp -d)"
trap 'rm -rf -- "${TMP}"' EXIT

curl -fsSL "${URL}" -o "${TMP}/nycode.tar.gz" ||
	die "download falhou: ${URL}"
curl -fsSL "${URL}.sha256" -o "${TMP}/nycode.tar.gz.sha256" ||
	die "checksum ausente: ${URL}.sha256"

read -r expected _ <"${TMP}/nycode.tar.gz.sha256" || die "checksum invalido"
[[ "${expected}" =~ ^[[:xdigit:]]{64}$ ]] || die "checksum invalido"
if [[ "${CHECKSUM_TOOL}" == "sha256sum" ]]; then
	read -r actual _ < <(sha256sum "${TMP}/nycode.tar.gz")
else
	read -r actual _ < <(shasum -a 256 "${TMP}/nycode.tar.gz")
fi
[[ "${actual}" == "${expected}" ]] || die "checksum nao confere"

tar -xzf "${TMP}/nycode.tar.gz" -C "${TMP}" ||
	die "arquivo corrompido"
[[ -f "${TMP}/nycode" ]] || die "o pacote nao contem o binario"

mkdir -p "${BIN_DIR}"
# Movimento atomico: substituir um binario em uso quebraria uma sessao aberta.
mv "${TMP}/nycode" "${BIN_DIR}/nycode.new"
chmod +x "${BIN_DIR}/nycode.new"
mv -f "${BIN_DIR}/nycode.new" "${BIN_DIR}/nycode"

echo "Instalado: $("${BIN_DIR}/nycode" --version)"

case ":${PATH}:" in
*":${BIN_DIR}:"*) ;;
*)
	echo ""
	echo "Aviso: ${BIN_DIR} nao esta no PATH. Adicione ao seu shell:"
	echo "  export PATH=\"${BIN_DIR}:\$PATH\""
	;;
esac

echo ""
echo "Aponte para o seu gateway e comece:"
echo "  export NYCODE_BASE_URL=https://seu-gateway/v1"
echo "  export NYCODE_API_KEY=..."
echo "  nycode -p \"explique este repositorio\""
