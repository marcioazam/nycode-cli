#!/usr/bin/env bash
# E2E da tarefa docs/pi-terminal-sota-2026-11-13.md: pi interativo real no tmux, dados isolados em mktemp.
# Uma chamada de modelo (resposta com bloco de código para /copy-code). Restaura a área de transferência.
set -u
unset PI_CODE_SUBAGENT PI_CODE_SUBAGENT_DEPTH TMUX
T=$(mktemp -d /tmp/pi-e2e-XXXX); S=pie2e$$; FAIL=0
chk() { local name=$1 ec=$2 info=$3; [ "$ec" = 0 ] && echo "PASS $name: $info" || { echo "FAIL $name (exit $ec): $info"; FAIL=1; }; }
pane() { tmux capture-pane -p -t $S -S -60; }
waitfor() { local re=$1 secs=$2 i; for ((i = 0; i < secs * 4; i++)); do pane | rg -q -- "$re" && return 0; sleep 0.25; done; return 1; }
keys() { tmux send-keys -t $S "$@"; sleep 0.6; }
type_() { tmux send-keys -t $S -l -- "$1"; sleep 0.6; }
clip_saved=0; timeout 3 wl-paste -n >$T/clip.bak 2>/dev/null && clip_saved=1
cleanup() {
  tmux kill-session -t $S 2>/dev/null
  [ $clip_saved = 1 ] && [ -s $T/clip.bak ] && wl-copy <$T/clip.bak
  find $T -delete 2>/dev/null
}
trap cleanup EXIT

# repositório git descartável com uma mudança para /diff
mkdir -p $T/repo $T/sessions && cd $T/repo && git init -q && printf 'linha um\nlinha dois\n' >a.txt && git add a.txt &&
  git -c user.name=e2e -c user.email=e2e@x commit -qm base && printf 'linha um\nlinha DOIS\nlinha tres\n' >a.txt
tmux new-session -d -s $S -x 150 -y 45 "cd $T/repo && $HOME/.local/bin/pi --session-dir $T/sessions; sleep 30"
waitfor '─{10}' 40; chk "0 pi abriu" $? "$(pane | rg -c '─')"
sleep 3

# U1 Ctrl+S: guarda, borda marca, devolve
type_ 'rascunho guardado e2e'; keys C-s
p=$(pane); echo "$p" | rg -q '✎ rascunho' && ! echo "$p" | rg -q 'rascunho guardado e2e'; chk "1 Ctrl+S guarda e limpa (borda ✎ rascunho)" $? "$(echo "$p" | rg -o '✎ rascunho' | head -1)"
keys C-s; p=$(pane); echo "$p" | rg -q 'rascunho guardado e2e' && ! echo "$p" | rg -q '✎ rascunho'; chk "2 Ctrl+S devolve" $? "$(echo "$p" | rg -o 'rascunho guardado e2e' | head -1)"

# U1 Ctrl+C com texto limpa; ↑ devolve
keys C-c; p=$(pane); ! echo "$p" | rg -q 'rascunho guardado e2e'; a=$?
keys Up; p=$(pane); echo "$p" | rg -q 'rascunho guardado e2e'; b=$?
[ $a = 0 ] && [ $b = 0 ]; chk "3 Ctrl+C limpa e ↑ devolve o rascunho" $? "limpou=$a voltou=$b"
keys C-c

# uma chamada de modelo: resposta com bloco de código
type_ 'Responda apenas com um bloco de codigo sh que imprime a palavra oi-e2e usando echo, sem mais nada.'; keys Enter
waitfor 'echo .?oi-e2e' 120; x=$?; sleep 6; chk "4 resposta do modelo com bloco" $x "$(pane | rg -o 'echo .?oi-e2e.?' | head -1)"

# U1 Ctrl+R: overlay, filtro, Enter põe no editor sem enviar
keys C-r; waitfor 'Histórico de prompts' 10; a=$?
type_ 'imprime oi-e2e'; p=$(pane); echo "$p" | rg -q '→ Responda apenas'; b=$?
keys Enter; sleep 1; p=$(pane); ! echo "$p" | rg -q 'Histórico de prompts'; c=$?
n=$(echo "$p" | rg -c 'Responda apenas com um bloco')
[ $a = 0 ] && [ $b = 0 ] && [ $c = 0 ] && [ "$n" -ge 2 ]; chk "5 Ctrl+R abre, filtra e põe o prompt no editor" $? "abriu=$a filtrou=$b fechou=$c ocorrencias=$n"
keys C-c

# U4 /copy-code: copia o bloco
type_ '/copy-code'; keys Enter; waitfor 'copiado' 5 || { keys Enter; waitfor 'copiado' 5; }
x=$?; c=$(timeout 3 wl-paste -n 2>/dev/null); echo "$c" | rg -q 'echo .?oi-e2e'; y=$?
[ $x = 0 ] && [ $y = 0 ]; chk "6 /copy-code copia o bloco" $? "aviso=$(pane | rg -o 'Bloco [0-9]+ copiado[^│]*' | tail -1) clip=[$c]"

# U2 /diff: comentar linha '+' e mandar ao editor
type_ '/diff'; keys Enter; waitfor 'Mudanças: 1 arquivo' 10 || { keys Enter; waitfor 'Mudanças: 1 arquivo' 10; }; a=$?
keys Enter; waitfor 'linha DOIS' 10; b=$?
# diff, header, index, ---, +++, @@, ' linha um', '-linha dois', '+linha DOIS': cursor 0 → 7 (+linha DOIS)
for i in $(seq 7); do keys Down; done
keys c; type_ 'trocar por minusculas'; keys Enter; p=$(pane); echo "$p" | rg -q '●'; c=$?
keys Escape; keys Escape; sleep 1; p=$(pane)
echo "$p" | rg -q 'Comentários da revisão' && echo "$p" | rg -q 'a.txt:2` — trocar por minusculas'; d=$?
[ $a = 0 ] && [ $b = 0 ] && [ $c = 0 ] && [ $d = 0 ]; chk "7 /diff comenta linha e envia ao editor" $? "lista=$a diff=$b marca=$c editor=$d ref=$(echo "$p" | rg -o 'a.txt:[0-9]+[^—]*— [a-z ]+' | head -1)"
keys C-c

# U4 /keybindings: abre o editor; Esc cancela sem gravar
type_ '/keybindings'; keys Enter; waitfor 'keybindings.json' 8 || keys Enter; sleep 1; keys Escape; sleep 1
waitfor 'Edição cancelada' 5; chk "8 /keybindings abre e cancela sem gravar" $? "$(pane | rg -o 'Edição cancelada[^│]*' | tail -1)"

echo "--- tela final ---"; pane | tail -15
echo "E2E_EXIT=$FAIL"; exit $FAIL
