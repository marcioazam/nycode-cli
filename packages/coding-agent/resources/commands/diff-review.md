---
description: Revisão diferencial de segurança de um PR, commit ou diff (skill differential-review, Trail of Bits)
disable-model-invocation: true
argument-hint: "<pr-url|commit-sha|diff-path> [--baseline <ref>]"
---

<!-- Porte para o pi (2026-11-11) do /differential-review:diff-review (trailofbits/differential-review 1.1.4). Sem
allowed-tools: no pi ele restringe o turno inteiro e cortaria o `subagent` (adversarial-modeler) e o codegraph que a
skill usa. A skill vive em ~/.pi/agent/claude-home/skills/differential-review/. -->

# Differential Security Review

**Argumentos:** `$ARGUMENTS`

1. Interprete os argumentos:
   - **Alvo** (obrigatório): URL de PR (`gh pr diff <url>` e `gh pr view <url> --json baseRefName,headRefName`), SHA de
     commit (`git show <sha>`) ou caminho de um arquivo `.diff`/`.patch`.
   - **Baseline** (opcional): `--baseline <ref>`, a referência de comparação (padrão: o pai do commit ou a base do PR).
   - Sem alvo, pare e mostre o uso: `/diff-review <pr-url|commit-sha|diff-path> [--baseline <ref>]`.
2. Leia `~/.pi/agent/claude-home/skills/differential-review/SKILL.md` com `read` e siga o workflow completo dela com esse
   alvo e essa baseline, incluindo os arquivos de referência que ela manda ler (`methodology.md`, `adversarial.md`,
   `reporting.md`, `patterns.md`, na mesma pasta).
3. Mudanças HIGH RISK vão para o agente `adversarial-modeler` via `subagent`, como a skill descreve. A revisão é somente
   leitura: não corrija nada no código revisado; o único arquivo escrito é o relatório que a skill pede.
4. Responda em português, começando pelo veredito e pelos achados por severidade, com `arquivo:linha`, e diga o que não
   foi verificado (por exemplo cobertura de testes não medida).
