---
description: "Audita um arquivo, diretório ou o repositório atrás de padrões inseguros (segredos de fallback, credenciais padrão, chaves fail-open, cripto fraca, acesso permissivo, debug exposto): varreduras paralelas coletam candidatos e verificadores que tentam refutar rastreiam cada um até a decisão de segurança antes de relatar"
argument-hint: "[caminho]  (vazio: .)"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /insecure-defaults:audit (trailofbits/insecure-defaults 2.0.3). O original chamava a
ferramenta Workflow (audit-pipeline), que o pi não tem; a orquestração está na skill insecure-defaults, com a parte
determinística em scripts/pipeline.py. -->

# Auditoria de padrões inseguros

Escopo: `${ARGUMENTS:-.}`. Se houver mais de um caminho, rode uma auditoria por caminho, uma de cada vez.
(O original passava `"\$1" or "."`; no Claude os índices começam em 0, então `\$1` era o segundo argumento e o
primeiro se perdia. Aqui o escopo é a linha inteira, com `.` quando vazia.)

1. Leia `~/.pi/agent/claude-home/skills/insecure-defaults/SKILL.md` com `read`.
2. Siga a seção "Passos" de ponta a ponta com esse escopo, a partir do diretório do projeto (o cwd desta sessão).
3. Responda em português, começando pelo status da execução (o `status` do `pipeline.py`) e depois o que o passo 7
   da skill manda imprimir para esse status.
