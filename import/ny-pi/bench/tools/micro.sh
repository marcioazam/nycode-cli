#!/usr/bin/env bash
# S7 micro: startup time (hyperfine) and peak RSS (/usr/bin/time -v) of an arm binary.
# usage: micro.sh <arm-bin> [--paid MODEL]   -> JSON on stdout. --paid also times a trivial headless prompt (spends tokens).
set -euo pipefail
bin=${1:?arm binary}
shift || true
paid=""
if [ "${1:-}" = "--paid" ]; then paid=${2:?model}; fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
hyperfine --warmup 1 --runs 5 --export-json "$tmp/v.json" "$bin --version" >/dev/null
/usr/bin/time -v -o "$tmp/t.txt" "$bin" --version >/dev/null 2>&1 || true
rss=$(awk -F': ' '/Maximum resident set size/ {print $2}' "$tmp/t.txt")
headless=null
if [ -n "$paid" ]; then
  hyperfine --runs 3 --export-json "$tmp/h.json" "$bin -p --model $paid 'reply with ok'" >/dev/null
  headless=$(jq -c '(.results[0].summary.time_wall_clock // .results[0]) | {mean_s: .mean, min_s: .min, max_s: .max}' "$tmp/h.json")
fi
jq -c --argjson rss "${rss:-null}" --argjson headless "$headless" \
  '{startup: ((.results[0].summary.time_wall_clock // .results[0]) | {mean_s: .mean, stddev_s: .stddev, min_s: .min, max_s: .max}), max_rss_kb: $rss, headless: $headless}' "$tmp/v.json"
