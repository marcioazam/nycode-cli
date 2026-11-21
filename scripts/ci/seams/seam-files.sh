#!/usr/bin/env bash
# Prints, one per line, the files of the active (ativa) seams of scripts/fork/seams.txt: upstream files that carry a
# nycode marker. run-static skips shell lint on them (08 section 7, rule 2: never reformat upstream files).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
while IFS= read -r line; do
  case $line in '' | '#'*) continue ;; esac
  IFS=$'\t' read -r _ files _ _ state <<<"${line// | /$'\t'}"
  if [ "$state" = ativa ]; then for f in $files; do printf '%s\n' "$f"; done; fi
done <scripts/fork/seams.txt
