---
description: "Inicia um Ralph Loop nesta sessão: o mesmo prompt volta a cada parada até a promessa ou o limite de iterações"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXTO]"
disable-model-invocation: true
---

<!-- Porte para o nycode (2026-11-11) do /ralph-loop:ralph-loop (ralph-loop 1.0.1, Apache-2.0). Pacote opcional,
instalado com `nycode install git:github.com/marcioazam/ralph-loop@<sha>` (docs/optional-packages.md); o Stop hook não
se registra sozinho: entra em hooks.Stop de ~/.nycode/agent/settings.json (o nycode roda Stop hooks com a semântica do
Claude: decision block devolve o prompt). O hook lê o transcript do nycode, que tem o mesmo formato que ele espera
(`"role":"assistant"`, `.message.content[].text`). A sessão vem de ${CLAUDE_SESSION_ID}, porque o span de command não
exporta CLAUDE_CODE_SESSION_ID. Os argumentos entram por heredoc em start-ralph-loop.sh (shlex), porque o original os
colava crus no shell: `<promise>X</promise>` no prompt virava redirecionamento. Alternativa nativa do nycode: /goal
(avaliado por outro modelo). (optional) -->

# Ralph Loop

Rode o script de setup para iniciar o loop:

```!
$HOME/.nycode/agent/git/github.com/marcioazam/ralph-loop/scripts/start-ralph-loop.sh '${CLAUDE_SESSION_ID}' <<'NYCODE_RALPH_ARGS_EOF'
$ARGUMENTS
NYCODE_RALPH_ARGS_EOF
```

Trabalhe na tarefa. Quando você tentar parar, o Ralph Loop devolve O MESMO PROMPT para a próxima iteração. Você vê o seu
trabalho anterior nos arquivos e no histórico do git, e pode iterar e melhorar.

REGRA CRÍTICA: se houver uma promessa de conclusão, você só pode escrevê-la (`<promise>TEXTO</promise>`) quando a
afirmação for total e inequivocamente VERDADEIRA. Não escreva promessa falsa para sair do loop, mesmo achando que está
travado ou que deveria parar por outro motivo. O loop foi feito para continuar até a conclusão real. Para parar antes,
o usuário usa `/cancel-ralph`.
