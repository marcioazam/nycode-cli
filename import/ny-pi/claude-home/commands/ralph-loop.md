---
description: "Inicia um Ralph Loop nesta sessão: o mesmo prompt volta a cada parada até a promessa ou o limite de iterações"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXTO]"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /ralph-loop:ralph-loop (ralph-loop 1.0.1, Apache-2.0). Scripts do plugin em
claude-home/vendor/ralph-loop; o Stop hook está registrado em claude-home/settings.json (o pi-code roda Stop hooks com a
semântica do Claude: decision block devolve o prompt). O hook lê o transcript do pi, que tem o mesmo formato que ele
espera (`"role":"assistant"`, `.message.content[].text`). A sessão vem de ${CLAUDE_SESSION_ID}, porque o span de
command não exporta CLAUDE_CODE_SESSION_ID. Os argumentos entram por heredoc em pi-ralph-start.sh (shlex), porque o
original os colava crus no shell: `<promise>X</promise>` no prompt virava redirecionamento. Alternativa nativa do pi: /goal (avaliado por outro modelo). -->

# Ralph Loop

Rode o script de setup para iniciar o loop:

```!
${CLAUDE_CONFIG_DIR:-$HOME/.pi/agent/claude-home}/vendor/ralph-loop/scripts/pi-ralph-start.sh '${CLAUDE_SESSION_ID}' <<'PI_RALPH_ARGS_EOF'
$ARGUMENTS
PI_RALPH_ARGS_EOF
```

Trabalhe na tarefa. Quando você tentar parar, o Ralph Loop devolve O MESMO PROMPT para a próxima iteração. Você vê o seu
trabalho anterior nos arquivos e no histórico do git, e pode iterar e melhorar.

REGRA CRÍTICA: se houver uma promessa de conclusão, você só pode escrevê-la (`<promise>TEXTO</promise>`) quando a
afirmação for total e inequivocamente VERDADEIRA. Não escreva promessa falsa para sair do loop, mesmo achando que está
travado ou que deveria parar por outro motivo. O loop foi feito para continuar até a conclusão real. Para parar antes,
o usuário usa `/cancel-ralph`.
