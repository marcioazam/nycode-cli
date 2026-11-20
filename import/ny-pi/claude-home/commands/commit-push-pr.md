---
description: "Commit, push e PR das mudanças atuais (via git-delivery; sem merge)"
disable-model-invocation: true
argument-hint: "[paths...] [-- título do PR]"
---

<!-- Porte para o pi (2026-11-11) do /commit-commands:commit-push-pr (plugin desligado no Claude). Mudanças: o trabalho
de git vai para o agente git-delivery (`git-deliver commit` + `publish`), com varredura de segredos, branch nova quando
o HEAD está na base e PR com corpo do repositório; o original fazia `git push` e `gh pr create` direto da conversa.
Para levar até o merge com CI verde use /skill:atualizador. allowed-tools saiu (restringiria o turno inteiro no pi). -->

## Contexto (somente leitura)

- Status: !`git status --short --branch`
- Diff (resumo): !`git diff HEAD --stat`
- Branch atual: !`git branch --show-current`
- Branch padrão do remoto: !`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo "origin/main (suposto)"`

Argumentos do usuário: `$ARGUMENTS`

## Tarefa

1. Paths e mensagem como no `/commit`: os paths pedidos ou todos os modificados e novos, menos segredos e artefatos
   locais (liste-os); Conventional Commit de até 72 caracteres a partir de `git diff HEAD -- <paths>`.
2. Título do PR: o que veio depois de `--`, senão o assunto do commit. Corpo: escreva num arquivo temporário
   (`mktemp`) seguindo `~/.pi/agent/claude-home/skills/git-workflow/references/pr-body.md` (o que muda, por quê, como
   foi verificado), sem inventar verificação que não aconteceu.
3. Delegue com `subagent` `{agent: "git-delivery", task: ...}` um brief com: repositório (cwd), autorização literal
   `"usuário invocou /commit-push-pr $ARGUMENTS: commit, push e abrir PR, sem merge"`, base (a branch padrão acima, sem
   o `origin/`), e os comandos em ordem:
   - `git-deliver commit --path <paths> -m "<mensagem>"`, com `--branch <tipo>/<tópico-curto>` se o HEAD está na base;
   - `git-deliver publish --base <base> --title "<título>" --body-file <arquivo>`.
4. Responda: SHA, branch, URL do PR (do JSON). `blocked`: o motivo do JSON, e pare.
