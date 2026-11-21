---
description: "Cria um commit das mudanças atuais (via git-delivery: paths explícitos, varredura de segredos, Conventional Commit)"
disable-model-invocation: true
argument-hint: "[paths...] [-- mensagem]"
---

<!-- Porte para o pi (2026-11-11) do /commit-commands:commit (commit-commands, plugin desligado no Claude). Mudanças: o
commit não roda na conversa principal, vai para o agente git-delivery (`git-deliver commit`: stage só dos paths
pedidos, varredura de segredos, nunca --no-verify); numa branch protegida ele cria uma branch nova em vez de commitar
na base. allowed-tools saiu: no pi ele restringe o turno inteiro e bloquearia o `subagent`. -->

## Contexto (somente leitura)

- Status: !`git status --short --branch`
- Diff (staged e unstaged, resumo): !`git diff HEAD --stat`
- Branch atual: !`git branch --show-current`
- Commits recentes: !`git log --oneline -10`

Argumentos do usuário: `$ARGUMENTS`

## Tarefa

Faça **um** commit com as mudanças acima.

1. Paths: os que o usuário passou; sem nenhum, todos os arquivos modificados e novos do status, menos os que parecem
   segredo ou artefato local (`.env*`, chaves, `*.log`, diretórios de build), que você lista para o usuário sem
   incluir. Para escrever a mensagem, leia o diff desses paths com `git diff HEAD -- <paths>` (somente leitura).
2. Mensagem: a que veio depois de `--`, se houver; senão um Conventional Commit (`tipo(escopo): resumo`, até 72
   caracteres) no estilo dos commits recentes, com corpo curto só se o porquê não for óbvio.
3. Delegue com `subagent` `{agent: "git-delivery", task: ...}`, num brief que traga: o repositório (cwd), a
   autorização literal `"usuário invocou /commit $ARGUMENTS"`, e o comando
   `git-deliver commit --path <paths> -m "<mensagem>"`; se a branch atual for a base (main/master), acrescente
   `--branch <tipo>/<tópico-curto>` (nunca commite direto na base).
4. Responda em uma linha por item: o SHA e o assunto do commit (do JSON do git-delivery), a branch, e os arquivos que
   ficaram de fora e por quê. Status `blocked`: mostre o motivo do JSON e pare, sem tentar outro caminho.
