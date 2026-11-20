---
description: Roda a tarefa atual (ou a dos argumentos) como enxame - a sessão só orquestra, lanes swarm-worker (Sonnet) e gate-runner (Haiku) em paralelo, gate único, review e correções limitadas
argument-hint: "[tarefa]  (vazio: a tarefa atual da conversa)"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do ~/.claude/commands/swarm.md: sem o workflow swarm-lanes nem modelo por chamada;
lanes por `subagent` paralelo, tier pelo `model:` do agente (swarm-worker Sonnet, gate-runner Haiku). -->

Tarefa: `$ARGUMENTS`. Se vazio, use a tarefa em andamento nesta conversa, com o escopo e as decisões já combinados.

Leia `~/.pi/agent/claude-home/skills/swarm-orchestration/SKILL.md` e siga a seção "Run a multi-lane task" de ponta
a ponta. Esta invocação é o opt-in do usuário para lanes paralelas de `subagent` (no máximo 4 writers ao mesmo tempo,
o limite do pi; o pi não tem o workflow `swarm-lanes`). Você orquestra: mapeia com o codegraph (`tool_search` antes),
faz a engenharia do grafo (unidades, donos de arquivo, dependências, `unit_graph.py suggest` e `check`) e do loop
(gate antes do review, condições de parada, orçamento de tokens, estado no registro `/docs`), escolhe o agente de cada
unidade (o tier vem do `model:` do agente) e julga o resultado. Tarefa que não se divide em unidades independentes vira
um único `swarm-worker`, não um enxame. Passe as restrições duras do usuário e do repositório (ações proibidas, gates
de aprovação, trailers) verbatim em cada brief; chame `lane-integrator` só quando branches ou worktrees separados
precisarem ser combinados. Lanes no mesmo checkout nunca dividem arquivo; se dois writers precisariam do mesmo arquivo,
junte as unidades ou ordene-as por `after`. Entrega (commit, PR, merge) só pelo agente `git-delivery` e só com a
autorização em vigor. Responda em português, começando pelo status (`green`, `needs_attention`, `needs_decision` ou
`not_verified`), com o agente e o tier de cada lane, as escaladas, o resultado do gate e o que não rodou.
