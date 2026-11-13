#!/usr/bin/env bash
# Gate final da tarefa pi-ui-sota (docs/pi-ui-sota.md). Somente leitura fora de mktemp. Sai 0 só se tudo passar.
set -u
unset PI_CODE_SUBAGENT
A=$HOME/.pi/agent; P=$A/claude-home/patches/pi-code; E=$A/npm/node_modules/pi-code/extensions
FILES="$A/extensions $A/themes/mono.json $P $E $HOME/.local/bin/pi $A/claude-home/bin/hud $A/claude-home/plugins/claude-hud/statusline.mjs $A/claude-home/bin/tests/sound-notify.test.ts $A/claude-home/hooks $A/claude-home/bin/checks/check-instructions.py"
man() { find $FILES -type f ! -path '*/node_modules/*' ! -name '*.pyc' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16; }
FAIL=0
chk() { local name=$1 ec=$2 info=$3; [ "$ec" = 0 ] && echo "PASS $name: $info" || { echo "FAIL $name (exit $ec): $info"; FAIL=1; }; }
nt() { "$@" >/tmp/g.log 2>&1; local ec=$?; echo "$ec|$(rg '^ℹ (tests|pass|fail) ' /tmp/g.log | tr -s ' ' | tr '\n' ' ')"; }
B=$(man); echo "manifesto antes: $B"

r=$(nt timeout 120 node --experimental-strip-types --test --experimental-test-coverage $A/extensions/ui/test/*.test.ts)
cov=$(rg '^ℹ +(a11y|terminal|editor|btw|diff)\.ts' /tmp/g.log | awk -F'|' '{gsub(/[ ℹ]/,"",$1); gsub(/ /,"",$2); printf "%s=%s ", $1, $2}')
low=$(rg '^ℹ +(a11y|terminal|editor|btw|diff)\.ts' /tmp/g.log | awk -F'|' '$2+0 < 80' | wc -l)
chk "1 ui tests + cobertura>=80" $(( ${r%%|*} || low )) "${r#*|}| $cov"

r=$(nt timeout 300 node --experimental-strip-types --test --experimental-test-coverage $P/rewind-tree.test.ts $P/todo-collapse.test.ts $P/notify-focus.test.ts)
cov=$(rg '^ℹ +(git-checkpoint|todo|notify)\.ts' /tmp/g.log | awk -F'|' '{gsub(/[ ℹ]/,"",$1); gsub(/ /,"",$2); printf "%s=%s ", $1, $2}')
low=$(rg '^ℹ +(git-checkpoint|todo|notify)\.ts' /tmp/g.log | awk -F'|' '$2+0 < 80' | wc -l)
chk "2 patches da tarefa + cobertura>=80" $(( ${r%%|*} || low )) "${r#*|}| $cov"

r=$(nt timeout 400 node --experimental-strip-types --test $P/*.test.ts $P/subagent-panel/*.test.ts); chk "3 pi-code todos os testes" ${r%%|*} "${r#*|}"
r=$(nt timeout 120 node --test $A/claude-home/bin/hud/tests/*.test.mjs); chk "4 hud" ${r%%|*} "${r#*|}"
r=$(nt timeout 120 node --experimental-strip-types --test $A/claude-home/bin/tests/sound-notify.test.ts $A/extensions/bash-clamp/index.test.ts $A/extensions/syntax-check/index.test.ts $A/extensions/pi-docs/index.test.ts); chk "5 som+bash-clamp+syntax-check+pi-docs" ${r%%|*} "${r#*|}"
(cd $A/claude-home/hooks && python3 -m unittest test_*.py >/tmp/g.log 2>&1); chk "6 hooks" $? "$(tail -1 /tmp/g.log)"
(cd $A/claude-home/hooks/dispatch && python3 -m unittest test_*.py >/tmp/g.log 2>&1); chk "6 dispatch" $? "$(tail -1 /tmp/g.log)"
bash -n $HOME/.local/bin/pi; chk "7 bash -n wrapper" $? ok
f=$(python3 ~/.pi/agent/claude-home/bin/structure/structure.py --project-root $A/extensions --json | jq -c .findings); [ "$f" = "[]" ]; chk "8 structure.py" $? "findings=$f"
python3 $A/claude-home/bin/checks/check-instructions.py >/tmp/g.log 2>&1; chk "9 check-instructions" $? "$(tail -1 /tmp/g.log)"

# 10: pilha. Desfaz tudo (ordem reversa, real); depois, para cada patch na ordem da pilha: dry-run e aplicação real.
T=$(mktemp -d); cp -r $E $T/e; cp -r $T/e $T/inst; ec=0; out=""
for p in $(ls -r $P/*.patch); do patch -d $T/e -p1 -R -s -f < $p >/dev/null 2>&1; x=$?; out="$out R:$(basename $p .patch)=$x"; ec=$((ec||x)); done
for p in $(ls $P/*.patch); do
  patch -d $T/e -p1 -N -s -f --dry-run < $p >/dev/null 2>&1; d=$?
  patch -d $T/e -p1 -N -s -f --no-backup-if-mismatch < $p >/dev/null 2>&1; x=$?
  out="$out F:$(basename $p .patch)=dry$d/apply$x"; ec=$((ec||d||x))
done
diff -rq $T/e $T/inst >/tmp/g.log; x=$?; ec=$((ec||x)); rm -r $T
chk "10 pilha de patches (dry-run+apply por patch; refeita==instalada)" $ec "$out | diff=$x $(head -2 /tmp/g.log)"

O=$(mktemp -d); cp -r $P/orig/. $O; ec=0; out=""
for p in rewind-tree todo-collapse notify-focus; do patch -d $O -p1 -N -s -f --dry-run < $P/$p.patch >/dev/null 2>&1; x=$?; out="$out $p=$x"; ec=$((ec||x)); done; rm -r $O
chk "11 patches da tarefa sobre orig" $ec "$out"

# 12: a pilha de patches está inteira aplicada nos alvos (patch velho ou alvo editado quebra o reverso). Conteúdo, não mtime.
T=$(mktemp -d); cp -r $E $T/e; sx=0; for p in $(ls -r $P/*.patch); do patch -d $T/e -p1 -R -s -f < $p >/dev/null 2>&1 || { sx=1; bad=${p##*/}; break; }; done; rm -r $T
chk "12 pilha de patches aplicada (reverso limpo)" $sx "${bad:-ok}"

cd /tmp; out=$(timeout 40 $HOME/.local/bin/pi --no-session -p 'responda apenas: ok' 2>/tmp/g.err); x=$?
[ "$x" = 0 ] && [ "$out" = ok ] && [ ! -s /tmp/g.err ]; chk "13 pi -p sem aviso" $? "stdout=[$out] stderr=[$(cat /tmp/g.err)]"

D=$(man); [ "$B" = "$D" ]; chk "14 manifesto inalterado durante o gate" $? "antes=$B depois=$D"
echo "GATE_EXIT=$FAIL"; exit $FAIL
