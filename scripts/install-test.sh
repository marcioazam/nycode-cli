#!/usr/bin/env bash
# Teste de contrato do instalador sem rede e sem alterar a maquina do operador.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "${TMP}"' EXIT

fixture="${TMP}/fixture"
fake="${TMP}/bin"
mkdir -p "${fixture}" "${fake}" "${TMP}/home" "${TMP}/dest"
printf '#!/usr/bin/env bash\nprintf "fixture-ok\\n"\n' >"${fixture}/nycode"
chmod +x "${fixture}/nycode"
/usr/bin/tar -czf "${TMP}/nycode-x86_64-unknown-linux-gnu.tar.gz" -C "${fixture}" nycode
read -r digest _ < <(sha256sum "${TMP}/nycode-x86_64-unknown-linux-gnu.tar.gz")
printf '%s  nycode-x86_64-unknown-linux-gnu.tar.gz\n' "${digest}" \
	>"${TMP}/nycode-x86_64-unknown-linux-gnu.tar.gz.sha256"

cat >"${fake}/uname" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -s) printf 'Linux\n' ;;
  -m) printf 'x86_64\n' ;;
  *) exit 1 ;;
esac
EOF
cat >"${fake}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while (($#)); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> "${CURL_LOG}"
if [[ "$url" == *.sha256 ]]; then
  cp "${FIXTURE_CHECKSUM}" "$out"
else
  cp "${FIXTURE_ARCHIVE}" "$out"
fi
EOF
chmod +x "${fake}/uname" "${fake}/curl"

export CURL_LOG="${TMP}/curl.log"
export FIXTURE_ARCHIVE="${TMP}/nycode-x86_64-unknown-linux-gnu.tar.gz"
export FIXTURE_CHECKSUM="${TMP}/nycode-x86_64-unknown-linux-gnu.tar.gz.sha256"
PATH="${fake}:${PATH}" \
	HOME="${TMP}/home" \
	NYCODE_VERSION="v0.1.0" \
	NYCODE_BIN_DIR="${TMP}/dest" \
	"${ROOT}/scripts/install.sh" >"${TMP}/install.log"

grep -Fq '.sha256' "${CURL_LOG}"
[[ "$("${TMP}/dest/nycode")" == fixture-ok ]]
