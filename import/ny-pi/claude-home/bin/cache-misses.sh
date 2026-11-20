#!/usr/bin/env bash
# Perdas totais de cache (cacheRead == 0) no meio das sessões do pi, por faixa de pausa, e custo do aquecimento.
# Uso: cache-misses.sh [desde, ISO; padrão 2026-11-11]. Spec: claude-home/docs/pi-memory-cache-sota-2026-11-13.md.
set -euo pipefail
SINCE=${1:-2026-11-11}
cd ~/.pi/agent/sessions

echo "== custo por componente (chamadas do assistente)"
rg --no-filename '"role":"assistant"' -g '*.jsonl' . | jq -s --arg s "$SINCE" '
  [.[] | select(.timestamp >= $s) | .message.usage] |
  {calls: length, total: (map(.cost.total // 0) | add),
   read: (map(.cost.cacheRead // 0) | add), write: (map(.cost.cacheWrite // 0) | add),
   output: (map(.cost.output // 0) | add)}'

echo "== aquecimento (cache_warm)"
rg --no-filename '"kind":"cache_warm"' -g '*.jsonl' . | jq -s --arg s "$SINCE" '
  [.[] | select(.timestamp >= $s)] |
  {n: length, cost: (map(.usage.cost.total // 0) | add), cacheWrite: (map(.usage.cacheWrite) | add)}'

echo "== perdas totais no meio da sessão por pausa desde a chamada anterior (warms = aquecimentos na pausa)"
rg --with-filename --no-line-number '"role":"assistant"|"kind":"cache_warm"' -g '*.jsonl' . | jq -R -s -c --arg s "$SINCE" '
  def ts: sub("\\.[0-9]+Z$"; "Z") | fromdate;
  def bucket: if . <= 3 then "a:<=3m" elif . <= 30 then "b:3-30m" elif . <= 60 then "c:30-60m" else "d:>60m" end;
  split("\n") | map(select(length > 0) | (index(":{")) as $i | {f: .[:$i], j: (.[$i+1:] | fromjson)})
  | map(select(.j.timestamp >= $s) | {f, t: (.j.timestamp | ts), warm: (.j.type == "usage"),
      r: (.j.message.usage.cacheRead // .j.usage.cacheRead), w: (.j.message.usage.cacheWrite // 0),
      c: (.j.message.usage.cost.cacheWrite // 0)})
  | group_by(.f) | map(sort_by(.t) | . as $a | [range(1; length)
      | select(($a[.].warm | not) and $a[.].r == 0 and $a[.].w > 0) | . as $k
      | ([range(0; $k) | select($a[.].warm | not)] | last) as $p | select($p != null)
      | {gap: (($a[$k].t - $a[$p].t) / 60), c: $a[$k].c, warms: ([range($p + 1; $k) | select($a[.].warm)] | length)}])
  | flatten | group_by(.gap | bucket)
  | map({bucket: (.[0].gap | bucket), n: length, cost: (map(.c) | add * 100 | round / 100),
         with_warm: (map(select(.warms > 0)) | length)})
  | .[]'
