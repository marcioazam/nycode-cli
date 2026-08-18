# ADR-0039: FR-17, FR-18, FR-8 e FR-24 ficam em waiver até instrumento próprio

- **Status:** aceito
- **Data:** 2026-08-18
- **Contexto relacionado:** [ADR-0036](0036-o-pin-sota-2026-sobe-para-v1-4-0-com-tres-perfis.md), `CI-16`, `SDD-17`, `ADV-05`, `AI-13`
- **Waiver:** CI-16, SDD-17, ADV-05, AI-13
- **Expira:** 2027-02-18

## Contexto

O pin v1.4.0 torna visíveis FRs de Núcleo/Autoria que este repositório ainda
não instrumenta: testes de contrato do lado do consumidor (`CI-16`/`FR-17`),
testes de invariante gerados em parsers tocados (`SDD-17`/`FR-18`), detecção
de asserção que não pode falhar (`ADV-05`/`FR-8`) e métricas de entrega
separadas por origem (`AI-13`/`FR-24`). Mutation no diff e cobertura são
backstop, não esses IDs.

## Decisão

Essas quatro FRs ficam em waiver. Controle compensatório: mutation `--in-diff`
com zero sobreviventes, cobertura 95%/90%/80%, `nycode-parity` como paridade
de harness (não contrato de consumidor). **Owner:** marcioazam.

`SDD-17` passa a aplicar no PR que tocar parser/codec/validador de entrada
não confiável — aí o waiver daquele arquivo cai e o instrumento é exigido
naquele diff, não nesta fatia.

## Consequências

Positivas: a matriz não marca `instrumentado` o que nunca falhou de propósito
nesses IDs.

Negativas: parsers continuam só com fixtures até um PR os tocar com
proptest.

Descartadas:

- **Marcar `não se aplica`.** Há interface publicada (CLI) e parsers de
  protocolo.

## Revisão

Expira **2027-02-18**. Cai por ID quando o instrumento mergear.
