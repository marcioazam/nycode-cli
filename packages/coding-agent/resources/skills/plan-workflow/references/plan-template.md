# Plan template

The tracker turns every numbered line into a todo and cuts it at 50 characters. Number **only tasks**, globally (1., 2., 3., …). Write everything else as headings or `-` bullets. Scale the template to the tier:

- T0 keeps only the summary and the tasks.
- T1 adds acceptance, assumptions and the checklist.
- T2 and T3 use every section.

```markdown
Tier: T2 (sinais: 3 módulos, contrato interno)

## Resumo
- Objetivo: <1–2 linhas>
- Fora de escopo: <não-objetivos>
- Estimativa: <tarefas, workers, turnos e custo aproximado>
- Registro na execução: /docs/<registro>.md (T2+: com Progresso, Surpresas, Log de decisões e Resultados)

## Decisões e suposições
- D1: <decisão> (motivo; alternativas rejeitadas) [ADR?]
- A1 (~92%, base: convenção em src/x): <suposição> (vete na revisão)
- A2 ⚠ (~60%, sem resposta): <suposição> (validada na tarefa 3)

## Glossário
- <termo>: <definição no contexto X>

## Aceitação
- AC1: WHEN <gatilho> THE SYSTEM SHALL <resposta observável>
- AC2: IF <condição indesejada> THEN THE SYSTEM SHALL <resposta>

## Riscos e rollback
- <risco>: <mitigação>; porta de mão única? <custo de desfazer>
- Rollback: <como reverter>

## Fases

### Fase 1: <marco> (gate: <check observável>)
1. <Verbo + objeto, ≤50 caracteres>
   - agente: swarm-worker (sonnet) · arquivos: src/a.ts, test/a.test.ts
   - ler antes: src/b.ts:40-90
   - ação: <o que muda>
   - after: (nenhum) · AC: AC1
   - check: `npm test -- a.test.ts` · pronto: <critério>
   - passos: escrever teste vermelho; implementar; verde
2. <Próxima tarefa>
   - ...

### Fase 2: <marco> (gate: ...)
3. Spike: validar A2 (≤30 min, saída: decisão D3)

### Fase final: verificação
4. Gate único (gate-runner)
5. Revisão do plano (plan-reviewer)
6. Entrega e captura (se autorizadas)

## Checklist
- [ ] Todo AC tem tarefa e check; toda tarefa tem AC [Coverage]
- [ ] Sem contradição aberta [Conflict]
- [ ] Toda A# tem % e base, e as ⚠ têm tarefa de validação [Assumption]
```

The lint in `plan_mode_complete` rejects a plan that lacks:

- the `Tier: Tn` line or a numbered task (every tier);
- a `%` on an `A#` line (every tier);
- an EARS `AC#`, a task that cites each `AC#`, or a `check:` (T1 and above);
- a risks or rollback line (T2 and above);
- a rollback (T3).
