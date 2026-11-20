#!/usr/bin/env bash
# Remedição do cache (docs/pi-memory-cache-sota-2026-11-13.md, passo 6), disparada por ~/.config/systemd/user/pi-cache-remeasure.timer.
set -u
CH=$HOME/.pi/agent/claude-home; OUT=$CH/docs/cache-remeasure-$(date +%F).txt
{ date -Is; echo '== cache-misses.sh 2026-11-13'; "$CH/bin/cache-misses.sh" 2026-11-13
  echo '== gatilhos (cache_probe_join.py)'; python3 "$CH/bin/telemetry/cache_probe_join.py" 2026-11-13; } > "$OUT" 2>&1
notify-send 'pi: remedição do cache pronta' "$OUT: peça ao pi para fechar o passo 6" 2>/dev/null || true
