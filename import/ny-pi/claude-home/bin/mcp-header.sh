#!/bin/sh
# Valor de header para o MCP nativo do pi (~/.pi/agent/mcp.json usa "!<este script> <servidor>").
# Lê ~/.config/claude-secrets/<servidor>: "Bearer <key>" sai inteiro; "Nome: valor" sai só o valor.
f="${HOME}/.config/claude-secrets/${1:?servidor}"
[ -r "$f" ] || { echo "missing $f" >&2; exit 1; }
s=$(head -n 1 "$f" | tr -d '\r')
case "$s" in
  [A-Za-z]*:\ *) printf '%s' "${s#*: }" ;;
  *) printf '%s' "$s" ;;
esac
