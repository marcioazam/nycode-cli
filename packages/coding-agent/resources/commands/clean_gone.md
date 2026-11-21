---
description: "Limpa branches locais [gone] (remoto apagado) e seus worktrees, só as de PR mergeado (via git-delivery)"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /commit-commands:clean_gone (plugin desligado no Claude). O original apagava toda
branch [gone] com `git branch -D` e `git worktree remove --force`, e [gone] só diz que a branch remota sumiu: um PR
fechado sem merge ou commits locais não enviados se perdiam. Aqui só sai a branch cujo PR foi mergeado e cujo head
local é o head do PR (`git-deliver cleanup`, que nunca usa --force); o resto é listado para o usuário decidir. -->

## Tarefa

1. Atualize as refs remotas pelo git-delivery: `subagent` `{agent: "git-delivery", task: ...}` com o repositório
   (cwd), a autorização literal `"usuário invocou /clean_gone: fetch --prune e limpar branches de PR mergeado"` e o
   comando `git-deliver sync --main-checkout <raiz do worktree principal>` (a primeira linha de `git worktree list`).
2. Somente leitura, na conversa: `git branch -vv` (branches com `[...: gone]`; `+` na frente = tem worktree) e
   `git worktree list`. Nenhuma `[gone]`: diga "Nada para limpar" e pare.
3. Para cada branch `[gone]`: `gh pr list --head <branch> --state merged --json number,headRefOid --limit 1`.
   - PR mergeado e `git rev-parse <branch>` igual a `headRefOid`: entra na limpeza, com o worktree dela, se houver.
   - Sem PR mergeado, head diferente ou sem `gh`: fica, com o motivo (PR fechado sem merge, commits locais a mais).
4. Se houver branches para limpar, um único brief ao git-delivery com a mesma autorização e um
   `git-deliver cleanup --pr <n> [--worktree <caminho>]` por branch, rodados da raiz do worktree principal.
5. Responda numa tabela curta: branch, PR, ação (removida / mantida) e motivo.
