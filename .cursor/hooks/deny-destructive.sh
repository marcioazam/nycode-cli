#!/usr/bin/env bash
# Recusa force-push e rm destrutivo. Sempre emite JSON: failClosed trata
# stdout vazio como falha do hook, nao como allow.
set -u
input="$(cat || true)"
command="$(printf '%s' "${input}" | jq -r '.command // empty' 2>/dev/null || true)"
permission="allow"
reason=""

if printf '%s' "${command}" | grep -Eq '(^|[[:space:]])git[[:space:]]+push[[:space:]].*(--force|-f)([[:space:]]|$)'; then
  permission="deny"
  reason="force-push recusado pelo hook do repositorio (AI-04)"
elif printf '%s' "${command}" | grep -Eq '(^|[[:space:]])rm([[:space:]]|$)'; then
  permission="deny"
  reason="rm recusado pelo hook do repositorio (AI-04)"
fi

printf '{"permission":"%s","reason":"%s"}\n' "${permission}" "${reason}"
if [[ "${permission}" != "allow" ]]; then
  sleep 0.1
fi
exit 0
