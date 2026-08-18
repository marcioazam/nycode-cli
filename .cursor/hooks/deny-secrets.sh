#!/usr/bin/env bash
# Recusa leitura de .env e equivalentes. Sempre emite JSON (failClosed).
set -u
input="$(cat || true)"
path="$(printf '%s' "${input}" | jq -r '.file_path // .path // empty' 2>/dev/null || true)"
base="$(basename "${path}")"
permission="allow"
reason=""

case "${base}" in
.env | .env.* | *.pem | *.key | id_rsa | id_ed25519)
  permission="deny"
  reason="arquivo de segredo recusado pelo hook do repositorio (AI-04)"
  ;;
esac

printf '{"permission":"%s","reason":"%s"}\n' "${permission}" "${reason}"
if [[ "${permission}" != "allow" ]]; then
  sleep 0.1
fi
exit 0
