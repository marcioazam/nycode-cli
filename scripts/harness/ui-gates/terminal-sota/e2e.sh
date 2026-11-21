#!/usr/bin/env bash
# E2E of the terminal-sota task: the repo's nycode, interactive, in tmux. Data isolated in mktemp.
# One model call (a reply with a code block for /copy-code) with the Claude account's model: --model
# $NYCODE_E2E_MODEL (default anthropic/claude-haiku-5-5), not the settings default. Credentials come from
# $NYCODE_E2E_AUTH_DIR (default ~/.nycode/agent); only auth.json and settings.json are copied (umask 077) into the
# scratch agent dir, which the EXIT trap deletes; their content is never printed. Without auth.json the model steps
# (4, 5, 6) print SKIP and the script exits 1 (a skip is not green). Restores the clipboard.
# Exits 0 only if all pass.
# Converted from ny-pi's claude-home/bin/tests/terminal-sota/e2e.sh: the binary is the repo build, not ~/.local/bin/pi.
# Needs: npm run build, tmux, rg, git; wl-paste/wl-copy optional (clipboard check 6 reads it).
set -u
umask 077
unset NYCODE_SUBAGENT NYCODE_SUBAGENT_DEPTH TMUX
ROOT=$(git rev-parse --show-toplevel) || exit 2
CLI=$ROOT/packages/coding-agent/dist/bundle/cli.js
T=$(mktemp -d /tmp/nycode-e2e-XXXX)
S=nye2e$$
FAIL=0
chk() {
  local name=$1 ec=$2 info=$3
  if [ "$ec" = 0 ]; then echo "PASS $name: $info"; else
    echo "FAIL $name (exit $ec): $info"
    FAIL=1
  fi
}
pane() { tmux capture-pane -p -t $S -S -60; }
waitfor() {
  local re=$1 secs=$2 i
  for ((i = 0; i < secs * 4; i++)); do
    pane | rg -q -- "$re" && return 0
    sleep 0.25
  done
  return 1
}
keys() {
  tmux send-keys -t $S "$@"
  sleep 0.6
}
type_() {
  tmux send-keys -t $S -l -- "$1"
  sleep 0.6
}
clip_saved=0
timeout 3 wl-paste -n >"$T/clip.bak" 2>/dev/null && clip_saved=1
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  tmux kill-session -t "$S" 2>/dev/null
  [ "$clip_saved" = 1 ] && [ -s "$T/clip.bak" ] && wl-copy <"$T/clip.bak"
  find "$T" -delete 2>/dev/null
}
trap cleanup EXIT

command -v tmux >/dev/null || {
  echo "FAIL 0 tmux ausente"
  exit 1
}
[ -f "$CLI" ] || {
  echo "FAIL 0 build ausente: npm run build"
  exit 1
}
AUTH=${NYCODE_E2E_AUTH_DIR:-$HOME/.nycode/agent}
mkdir -p "$T/agent" "$T/home" "$T/repo" "$T/sessions"
MODEL=${NYCODE_E2E_MODEL:-anthropic/claude-haiku-5-5}
HAVE_AUTH=0
[ -f "$AUTH/auth.json" ] && HAVE_AUTH=1
for f in auth.json settings.json; do [ -f "$AUTH/$f" ] && cp "$AUTH/$f" "$T/agent/$f"; done
SKIPPED=0
skip() {
  echo "SKIP $1: sem credenciais (auth.json em NYCODE_E2E_AUTH_DIR ou ~/.nycode/agent)"
  SKIPPED=1
}

# throwaway git repo with a change for /diff
cd "$T/repo" && git init -q && printf 'linha um\nlinha dois\n' >a.txt && git add a.txt &&
  git -c user.name=e2e -c user.email=e2e@x commit -qm base && printf 'linha um\nlinha DOIS\nlinha tres\n' >a.txt
tmux new-session -d -s $S -x 150 -y 45 "cd $T/repo && HOME=$T/home NYCODE_CODING_AGENT_DIR=$T/agent node $CLI --model $MODEL --session-dir $T/sessions; sleep 30"
waitfor '─{10}' 40
chk "0 nycode abriu" $? "$(pane | rg -c '─')"
sleep 3

# U1 Ctrl+S: stash, border marks it, gives it back
type_ 'rascunho guardado e2e'
keys C-s
p=$(pane)
echo "$p" | rg -q '✎ rascunho' && ! echo "$p" | rg -q 'rascunho guardado e2e'
chk "1 Ctrl+S guarda e limpa (borda ✎ rascunho)" $? "$(echo "$p" | rg -o '✎ rascunho' | head -1)"
keys C-s
p=$(pane)
echo "$p" | rg -q 'rascunho guardado e2e' && ! echo "$p" | rg -q '✎ rascunho'
chk "2 Ctrl+S devolve" $? "$(echo "$p" | rg -o 'rascunho guardado e2e' | head -1)"

# U1 Ctrl+C with text clears; Up gives it back
keys C-c
p=$(pane)
! echo "$p" | rg -q 'rascunho guardado e2e'
a=$?
keys Up
p=$(pane)
echo "$p" | rg -q 'rascunho guardado e2e'
b=$?
rc=1
[ $a = 0 ] && [ $b = 0 ] && rc=0
chk "3 Ctrl+C limpa e ↑ devolve o rascunho" "$rc" "limpou=$a voltou=$b"
keys C-c

if [ "$HAVE_AUTH" = 1 ]; then
  # one model call: a reply with a code block
  type_ 'Responda apenas com um bloco de codigo sh que imprime a palavra oi-e2e usando echo, sem mais nada.'
  keys Enter
  waitfor 'echo .?oi-e2e' 120
  x=$?
  sleep 6
  chk "4 resposta do modelo com bloco" $x "$(pane | rg -o 'echo .?oi-e2e.?' | head -1)"

  # U1 Ctrl+R: overlay, filter, Enter puts the prompt in the editor without sending
  keys C-r
  waitfor 'Histórico de prompts' 10
  a=$?
  type_ 'imprime oi-e2e'
  p=$(pane)
  echo "$p" | rg -q '→ Responda apenas'
  b=$?
  keys Enter
  sleep 1
  p=$(pane)
  ! echo "$p" | rg -q 'Histórico de prompts'
  c=$?
  n=$(echo "$p" | rg -c 'Responda apenas com um bloco')
  rc=1
  [ $a = 0 ] && [ $b = 0 ] && [ $c = 0 ] && [ "$n" -ge 2 ] && rc=0
  chk "5 Ctrl+R abre, filtra e põe o prompt no editor" "$rc" "abriu=$a filtrou=$b fechou=$c ocorrencias=$n"
  keys C-c

  # U4 /copy-code: copies the block
  type_ '/copy-code'
  keys Enter
  waitfor 'copiado' 5 || {
    keys Enter
    waitfor 'copiado' 5
  }
  x=$?
  c=$(timeout 3 wl-paste -n 2>/dev/null)
  echo "$c" | rg -q 'echo .?oi-e2e'
  y=$?
  rc=1
  [ $x = 0 ] && [ $y = 0 ] && rc=0
  chk "6 /copy-code copia o bloco" "$rc" "aviso=$(pane | rg -o 'Bloco [0-9]+ copiado[^│]*' | tail -1) clip=[$c]"
else
  skip "4 resposta do modelo com bloco"
  skip "5 Ctrl+R abre, filtra e põe o prompt no editor"
  skip "6 /copy-code copia o bloco"
fi

# U2 /diff: comment on a '+' line and send it to the editor
type_ '/diff'
keys Enter
waitfor 'Mudanças: 1 arquivo' 10 || {
  keys Enter
  waitfor 'Mudanças: 1 arquivo' 10
}
a=$?
keys Enter
waitfor 'linha DOIS' 10
b=$?
# diff, header, index, ---, +++, @@, ' linha um', '-linha dois', '+linha DOIS': cursor 0 -> 7 (+linha DOIS)
for _ in $(seq 7); do keys Down; done
keys c
type_ 'trocar por minusculas'
keys Enter
p=$(pane)
echo "$p" | rg -q '●'
c=$?
keys Escape
keys Escape
sleep 1
p=$(pane)
echo "$p" | rg -q 'Comentários da revisão' && echo "$p" | rg -q 'a.txt:2` — trocar por minusculas'
d=$?
rc=1
[ $a = 0 ] && [ $b = 0 ] && [ $c = 0 ] && [ $d = 0 ] && rc=0
chk "7 /diff comenta linha e envia ao editor" "$rc" "lista=$a diff=$b marca=$c editor=$d ref=$(echo "$p" | rg -o 'a.txt:[0-9]+[^—]*— [a-z ]+' | head -1)"
keys C-c

# U4 /keybindings: opens the editor; Esc cancels without writing
type_ '/keybindings'
keys Enter
waitfor 'keybindings.json' 8 || keys Enter
sleep 1
keys Escape
sleep 1
waitfor 'Edição cancelada' 5
chk "8 /keybindings abre e cancela sem gravar" $? "$(pane | rg -o 'Edição cancelada[^│]*' | tail -1)"

echo "--- tela final ---"
pane | tail -15
[ "$SKIPPED" = 0 ] || FAIL=1
echo "E2E_EXIT=$FAIL (skipped=$SKIPPED)"
exit $FAIL
