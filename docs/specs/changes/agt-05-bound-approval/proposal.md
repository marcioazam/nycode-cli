# Proposta — AGT-05 aprovação ligada

Parent: #70. Waiver ADR-0038. Pesquisa: `sota-2026-onda2-instruments/research.md`.

## Por que

`Approver` hoje devolve bool. Um “sim” de sessão sem chave aprova outro alvo.

## O que não muda

`Never` default. Gate antes do approver. AGT-04 fica noutro PR.

## Fora de escopo

Persistir grants em disco. `Always` como grant.
