#!/usr/bin/env bash
# overlay_sha DIR LIST: 16-hex hash of the files under DIR named by the overlay list LIST (comments and blank
# lines skipped). A listed path that does not exist is skipped, wherever it sits in the list.
overlay_sha() {
  (cd "$1" && grep -v -e '^#' -e '^$' "$2" | while read -r rel; do
    if [ -e "$rel" ]; then find -L "$rel" -type f -print0; fi
  done | sort -z | xargs -0 -r sha256sum | sha256sum | cut -c1-16)
}

# overlay_freeze SRC DST LIST: copy the listed paths from SRC into a fresh DST (mode 700) and print its hash.
# DST must not exist: a frozen copy is replaced on purpose, together with the baseline, never updated in place.
overlay_freeze() {
  [ ! -e "$2" ] || {
    echo "overlay_freeze: $2 already exists" >&2
    return 1
  }
  (umask 077 && mkdir -p "$2") || return 1
  grep -v -e '^#' -e '^$' "$3" | while read -r rel; do
    if [ -e "$1/$rel" ]; then mkdir -p "$(dirname "$2/$rel")" && cp -a "$1/$rel" "$2/$rel"; fi
  done
  overlay_sha "$2" "$3"
}
