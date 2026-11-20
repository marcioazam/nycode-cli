#!/usr/bin/env bash
# Gate da tarefa docs/pi-terminal-sota-2026-11-13.md. Somente leitura fora de mktemp. Sai 0 só se tudo passar.
set -u
unset PI_CODE_SUBAGENT PI_CODE_SUBAGENT_DEPTH
A=$HOME/.pi/agent; X=$A/extensions; H=$A/claude-home
D=$A/install/releases/$(cat $A/install/current-version)/node_modules/@earendil-works/pi-coding-agent/dist
FAIL=0; L=$(mktemp)
chk() { local name=$1 ec=$2 info=$3; [ "$ec" = 0 ] && echo "PASS $name: $info" || { echo "FAIL $name (exit $ec): $info"; FAIL=1; }; }
# testes node com cobertura: exige todos os arquivos listados com >=80% de linhas. Cada teste copia o módulo para o
# próprio tmp, então o mesmo arquivo aparece uma vez por cópia; vale o maior valor (limite inferior da união real).
cov() { local re=$1; shift; timeout 300 node --experimental-strip-types --test --experimental-test-coverage "$@" >$L 2>&1; local ec=$?
  local sum; sum=$(rg '^ℹ (tests|pass|fail) ' $L | tr -s ' ' | tr '\n' ' ')
  local best; best=$(rg "^ℹ +($re)\.ts " $L | awk -F'|' '{gsub(/[ ℹ]/,"",$1); v=$2+0; if (!($1 in m) || v > m[$1]) m[$1]=v} END {for (k in m) printf "%s=%.2f\n", k, m[k]}' | sort)
  local n; n=$(echo "$best" | rg -c '=' || echo 0); local want; want=$(echo "$re" | tr '|' '\n' | wc -l)
  local low; low=$(echo "$best" | awk -F= '$2+0 < 80' | wc -l)
  [ "$ec" = 0 ] && [ "$low" = 0 ] && [ "$n" = "$want" ]; echo "$?|$sum| $(echo $best)"; }

r=$(cov 'a11y|terminal|editor|btw|diff|history' $X/ui/test/*.test.ts); chk "1 ui (U1+U2) + cobertura>=80" ${r%%|*} "${r#*|}"
[ "${r%%|*}" = 0 ] || rg -n "not ok|Error|AssertionError" $L | head -20
r=$(cov 'copy-code|keybindings|index' $X/dev-commands/test/*.test.ts); chk "2 dev-commands (U4) + cobertura>=80" ${r%%|*} "${r#*|}"
[ "${r%%|*}" = 0 ] || rg -n "not ok|Error|AssertionError" $L | head -20
r=$(cov 'sticky' $X/sticky-prompt/sticky.test.ts); chk "3 sticky-prompt (U3) + cobertura>=80" ${r%%|*} "${r#*|}"
[ "${r%%|*}" = 0 ] || rg -n "not ok|Error|AssertionError" $L | head -20

# 4: tema válido no esquema do pi e com o mapeamento oficial do tokyonight.nvim
cat >$L.mjs <<EOF
import { loadThemeFromPath, setThemeJsonValidator } from '$D/modes/interactive/theme/theme.js'
import { validateThemeJson } from '$D/modes/interactive/theme/theme-schema.js'
setThemeJsonValidator(validateThemeJson)
const t = loadThemeFromPath('$A/themes/tokyo-night.json', 'truecolor') // 2º parâmetro = modo de cor
const want = { syntaxKeyword: '157;124;216', syntaxOperator: '137;221;255', mdLink: '26;188;156', mdListBullet: '137;221;255', mdCode: '158;206;106' }
const bad = Object.entries(want).filter(([k, rgb]) => !t.getFgAnsi(k).includes(rgb)).map(([k]) => k + '=' + JSON.stringify(t.getFgAnsi(k)))
console.log(bad.length ? 'divergem: ' + bad.join(' ') : 'ok ' + Object.keys(want).join(','))
process.exit(bad.length ? 1 : 0)
EOF
out=$(node $L.mjs 2>&1); chk "4 tema tokyo-night (esquema + cores oficiais)" $? "$out"

# 5: HUD aceita as cores (loadConfig real do claude-hud com a config do pi)
HUD=$HOME/.claude/plugins/cache/claude-hud/claude-hud/0.10.0/dist
cat >$L.hud.mjs <<EOF
import { readFileSync } from 'node:fs'
import { mergeConfig } from '$HUD/config.js'
const raw = JSON.parse(readFileSync('$H/plugins/claude-hud/config.json', 'utf8'))
const c = mergeConfig(raw).colors
const bad = Object.entries(raw.colors).filter(([k, v]) => c[k] !== v).map(([k, v]) => k + ':' + v + '→' + c[k])
console.log(bad.length ? 'rejeitadas: ' + bad.join(' ') : 'ok ' + Object.keys(raw.colors).length + ' cores')
process.exit(bad.length ? 1 : 0)
EOF
out=$(node $L.hud.mjs 2>&1); chk "5 HUD colors aceitas pelo mergeConfig" $? "$out"

f=$(python3 $H/bin/structure/structure.py --project-root $X --json | jq -c .findings); [ "$f" = "[]" ]; chk "6 structure.py extensions" $? "findings=$f"
python3 $H/bin/checks/check-agents.py >$L 2>&1; chk "7 check-agents" $? "$(tail -1 $L)"
j=$(python3 $H/skills/harness-audit/scripts/pi_harness_check.py --json 2>&1 | jq -c .counts); [ "$(echo "$j" | jq .error)" = 0 ]; chk "8 pi_harness_check error=0" $? "$j"
timeout 120 python3 -m pytest -q -p no:cacheprovider $H/skills/harness-audit/scripts/tests/ >$L 2>&1; chk "9 harness-audit pytest" $? "$(tail -1 $L)"
python3 $H/bin/checks/check-instructions.py >$L 2>&1; chk "10 check-instructions" $? "$(tail -1 $L)"

# 11: o pi carrega os comandos novos e a skill cua-driver pelo caminho próprio (RPC, sem modelo)
cd /tmp; { sleep 4; echo '{"id":"q1","type":"get_commands"}'; sleep 20; } | timeout 60 $HOME/.local/bin/pi --mode rpc --no-session >$L 2>$L.err
resp=$(rg '"type":"response"' $L | head -1)
got=$(echo "$resp" | jq -r '.data.commands[] | select(.name|test("^(copy-code|keybindings|diff|skill:cua-driver)$")) | "\(.name)=\(.sourceInfo.path // "")"' | sort | tr '\n' ' ')
n=$(echo "$got" | wc -w); echo "$got" | rg -q "skill:cua-driver=$HOME/.cua-driver/skills/cua-driver/SKILL.md"; x=$?
[ "$n" = 4 ] && [ "$x" = 0 ]; chk "11 RPC get_commands (comandos novos, cua-driver fora de ~/.agents)" $? "$got"
ls -A $HOME/.agents/skills >$L 2>&1; [ ! -s $L ]; chk "12 ~/.agents/skills vazio (Codex sem link)" $? "conteúdo=[$(cat $L)]"

rm -f $L $L.mjs $L.hud.mjs $L.err
echo "GATE_EXIT=$FAIL"; exit $FAIL
