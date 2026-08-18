# ADR-0036: O pin SOTA-2026 sobe para v1.4.0 com três perfis

- **Status:** aceito
- **Data:** 2026-08-18
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), Issue [#70](https://github.com/marcioazam/nycode-cli/issues/70)

## Contexto

[ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md) adotou L2 contra
SOTA-2026 v1.1.0 e proibiu copiar o texto dos pilares. Entre 1.1.0 e 1.4.0 o
padrão ganhou perfis, matriz, regras `AGT-*` (só com Produto agente), harness
de runtime em três camadas e um guia GitHub. O pin antigo não descreve mais o
contrato que este repositório diz seguir. `VERSIONING.md` do padrão exige que
a subida de pin seja um PR deliberado, não um edit incidental.

Este repositório publica release e é um CLI de agente: Núcleo, Autoria por
agente e Produto agente aplicam. Regulado/L3 não.

## Decisão

O pin passa a **SOTA-2026 v1.4.0**, nível **L2**, perfis **Núcleo**, **Autoria
por agente** e **Produto agente**. A matriz vive em
[`docs/CONFORMANCE-MATRIX.md`](../../CONFORMANCE-MATRIX.md). Números continuam
só no `GATES.md` do padrão e nos scripts daqui; o `AGENTS.md` cita o ID.

“100% SOTA-2026” só vale quando cada FR dos três perfis estiver
`instrumentado` ou `waiver` em data. Esta mudança não faz essa reivindicação.

## Consequências

Positivas: o pin e a matriz tornam a conformidade checável; Produto agente
deixa de ser omisso.

Negativas: várias FRs nascem `pendente` ou em waiver — a honestidade aparece
como trabalho, não como verde.

Descartadas:

- **Ficar em v1.1.0.** Honesto só se ninguém citar v1.4.0. O pedido desta
  mudança é o pin novo.
- **Copiar os pilares para `docs/`.** Rejeitado no ADR-0032; um número em dois
  lugares já está errado num deles.
- **Não declarar Produto agente.** O binário planeja, chama tools, persiste
  sessão e executa processo sob direção do modelo.

## Revisão

Quando o padrão publicar um major, ou quando um perfil deixar de se aplicar.
O pin não sobe de passagem num PR de feature.
