# ADR-0042: Gates caros usam sentinelas por escopo

- **Status:** aceito
- **Data:** 2026-08-22

## Contexto

Performance, paridade e Docker dependem de builds, downloads ou referências
externas e não acrescentam sinal para mudanças apenas de documentação. Eles
eram executados em toda PR, aumentando custo e tempo de fila.

## Decisão

O job `changes` classifica o diff contra a base real. Os jobs `perf`, `parity`
e `docker` continuam sempre presentes, mas executam a medição completa apenas
quando seu escopo muda; caso contrário, concluem como sentinela explícita.
`push` e `merge_group` sempre executam os gates completos. O gate de idade de
dependência só consulta crates.io quando `Cargo.lock` muda.

## Consequências

Os nomes dos checks obrigatórios não mudam e não ficam pendentes. Um escopo
novo deve ser adicionado ao classificador com teste antes de alterar um gate.
O job `changes` precisa de histórico completo e falha fechado se não conseguir
comparar a base.
