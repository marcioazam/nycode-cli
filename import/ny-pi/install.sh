#!/usr/bin/env bash
# pi-harness installer.
#   install.sh [--with-optional]      install pi 1.5.2 + pi-code 1.7.0 + pinned third parties (fail closed)
#   install.sh --link [--apply]       symlink publish.list files into ~/.pi/agent (dry-run unless --apply)
#   install.sh --restore [<ts>]       undo a --link --apply from ~/.pi-backup/<ts>/link-manifest.tsv
# Honours HOME. Never touches auth*.json, mcp.json, sessions/ or other personal state.
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MANIFEST=${PI_HARNESS_MANIFEST:-$REPO/third-party.json}
# shellcheck source=scripts/install-lib.sh
. "$REPO/scripts/install-lib.sh"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

STAGE=
cleanup() { [ -z "$STAGE" ] || rm -r "$STAGE" </dev/null 2>/dev/null || true; }
trap cleanup EXIT

# ---- default install ------------------------------------------------------------------------
do_install() {
  local with_optional=$1 names
  preflight
  verify_npm_pin
  jq -e '.components | type=="array"' "$MANIFEST" >/dev/null || die "invalid manifest $MANIFEST"
  STAGE=$(mktemp -d)
  mapfile -t names < <(manifest_names "$([ "$with_optional" = 1 ] && echo all || echo required)")
  fetch_third_party "${names[@]}"          # aborts here, before HOME is written, on any mismatch
  install_pi_core
  install_npm_deps
  install_ext_deps
  install_third_party "${names[@]}"
  log "done: pi $PI_VERSION, pi-code $PI_CODE_VERSION, ${#names[@]} third-party component(s)."
  log "next: install.sh --link (dry-run) then --link --apply to wire the harness files."
}

# ---- --link / --restore ---------------------------------------------------------------------
# publish.list: <target template with literal $HOME><TAB><repo path>; bin/pi lands in ~/.local/bin.
TEMPLATES=("settings.json.example:settings.json" "mcp.json.example:mcp.json" "lsp.json.example:lsp.json" "local.env.example:local.env" "claude-home/settings.json.example:claude-home/settings.json")

list_links() { # prints "<target>\t<repo file>"
  local dst src
  while IFS=$'\t' read -r dst src; do
    [ -n "$dst" ] || continue
    case "$dst" in '$HOME/'*) dst=$HOME/${dst#'$HOME/'} ;; *) die "publish.list: unexpected target '$dst'" ;; esac
    case "$dst" in
      */auth*.json|*/mcp.json|*/mcp-auth.json|*/.env*|*/sessions/*) die "publish.list targets protected path: $dst" ;;
    esac
    printf '%s\t%s\n' "$dst" "$REPO/$src"
  done < "$REPO/publish.list"
}

link_state() { # target repo-file -> link | replace | skip(same)
  if [ -L "$1" ] && [ "$(readlink "$1")" = "$2" ]; then echo 'skip(same)'
  elif [ -e "$1" ] || [ -L "$1" ]; then echo replace
  else echo link; fi
}

orig_sha() { if [ -L "$1" ]; then printf 'link:%s' "$(readlink "$1")"; else sha256 "$1"; fi; }

mkparents() { # records directories this run creates so --restore can remove them if empty
  local d=$1 missing=()
  while [ ! -d "$d" ]; do missing+=("$d"); d=$(dirname "$d"); done
  local i
  for ((i=${#missing[@]}-1; i>=0; i--)); do
    mkdir "${missing[$i]}"; printf '%s\t-\t-\tdir\n' "${missing[$i]}" >> "$MAN"
  done
}

do_link() {
  local apply=$1 target src st rel n=0 t a b
  command -v sha256sum >/dev/null || die "sha256sum required"
  if [ "$apply" = 1 ]; then
    TS=$(date +%Y%m%dT%H%M%S); backup_dir; MAN=$BACKUP/link-manifest.tsv; : > "$MAN"; chmod 600 "$MAN"
  fi
  while IFS=$'\t' read -r target src; do
    st=$(link_state "$target" "$src")
    if [ "$apply" = 0 ]; then printf '%s\t%s\n' "$st" "$target"; continue; fi
    [ "$st" != 'skip(same)' ] || continue
    mkparents "$(dirname "$target")"
    if [ "$st" = replace ]; then
      rel=${target#"$HOME"/}
      mkdir -p "$BACKUP/replaced/$(dirname "$rel")"
      printf '%s\t%s\t%s\tfile\n' "$target" "$BACKUP/replaced/$rel" "$(orig_sha "$target")" >> "$MAN"
      mv "$target" "$BACKUP/replaced/$rel"
    else
      printf '%s\t-\t-\tfile\n' "$target" >> "$MAN"
    fi
    ln -s "$src" "$target"; n=$((n+1))
  done < <(list_links)
  for t in "${TEMPLATES[@]}"; do
    a=$REPO/${t%%:*}; b=$(agent_dir)/${t##*:}
    [ -f "$a" ] || continue
    if [ -e "$b" ] || [ -L "$b" ]; then
      [ "$apply" = 0 ] && printf 'skip(exists)\t%s\n' "$b"; continue
    fi
    if [ "$apply" = 0 ]; then printf 'template\t%s\n' "$b"; continue; fi
    mkparents "$(dirname "$b")"
    cp "$a" "$b"; [ "${b##*/}" != local.env ] || chmod 600 "$b"
    printf '%s\t-\t%s\ttemplate\n' "$b" "$(sha256 "$b")" >> "$MAN"
  done
  [ "$apply" = 0 ] || install_ext_deps
  if [ "$apply" = 1 ]; then log "linked $n file(s); manifest $MAN"; else log "dry-run only; add --apply to change anything"; fi
}

do_restore() {
  local ts=${1:-} dir man bad=0 target backup sum kind rows=() i
  if [ -z "$ts" ]; then
    ts=$(ls -1 "$HOME/.pi-backup" 2>/dev/null | sort | while read -r d; do if [ -f "$HOME/.pi-backup/$d/link-manifest.tsv" ]; then echo "$d"; fi; done | tail -n 1)
  fi
  [ -n "$ts" ] || die "no link-manifest.tsv under ~/.pi-backup"
  dir=$HOME/.pi-backup/$ts; man=$dir/link-manifest.tsv
  [ -f "$man" ] || die "missing $man"
  mapfile -t rows < "$man"
  for ((i=${#rows[@]}-1; i>=0; i--)); do   # reverse: files before the directories made for them
    IFS=$'\t' read -r target backup sum kind <<< "${rows[$i]}"
    case "$kind" in
      dir) rmdir "$target" 2>/dev/null || true ;;
      template)
        if [ -f "$target" ] && [ "$(sha256 "$target")" = "$sum" ]; then rm "$target"; else log "kept modified template $target"; fi ;;
      file)
        if [ -L "$target" ]; then rm "$target"; elif [ -e "$target" ]; then log "not a link, left alone: $target"; bad=1; continue; fi
        [ "$backup" != - ] || continue
        if [ ! -e "$backup" ] && [ ! -L "$backup" ]; then log "backup missing: $backup"; bad=1; continue; fi
        if [ "$(orig_sha "$backup")" != "$sum" ]; then log "sha256 mismatch for $backup"; bad=1; continue; fi
        mv "$backup" "$target" ;;
    esac
  done
  [ "$bad" -eq 0 ] || die "restore finished with errors (see above)"
  log "restored from $dir"
}

main() {
  local mode=install apply=0 optional=0 ts=
  while [ $# -gt 0 ]; do
    case "$1" in
      --link) mode=link ;;
      --apply) apply=1 ;;
      --with-optional) optional=1 ;;
      --restore) mode=restore; if [ $# -gt 1 ] && [[ "$2" != --* ]]; then ts=$2; shift; fi ;;
      -h|--help) usage 0 ;;
      *) echo "unknown option: $1" >&2; usage 2 ;;
    esac
    shift
  done
  case "$mode" in
    install) do_install "$optional" ;;
    link) do_link "$apply" ;;
    restore) do_restore "$ts" ;;
  esac
}
main "$@"
