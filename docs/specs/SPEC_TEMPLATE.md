# spec — <feature>

> Modelo para a spec de uma feature. WHAT e WHY apenas: nenhuma decisão de
> implementação, nenhum nome de biblioteca. O COMO vive nos
> [ADRs](../architecture/decisions/README.md).
>
> A spec do produto inteiro é [`.specs/nycode-rs/spec.md`](../../.specs/nycode-rs/spec.md);
> use este modelo para uma feature que mereça documento próprio.

## Problema

Qual dor existe hoje, para quem, e qual é o custo de não resolver. Sem solução
aqui.

## Objetivo

Uma frase. Se precisar de duas, provavelmente são duas features.

## Requisitos funcionais

- **FR-1** <comportamento observável, na voz do usuário>
- **FR-2** …

Cada FR precisa ser verificável: se não dá para escrever o teste que falha, o
requisito ainda está vago.

## Requisitos não-funcionais

- **NFR-1** <orçamento numérico e como é medido>

Herdados do produto e sempre aplicáveis: startup, memória e tamanho de binário
(NFR-1..3), fidelidade de wire (NFR-4) e os pisos de cobertura de 95% agregado e
90% por arquivo (NFR-5).

## Cenários

- Caminho feliz.
- Caminho de erro — e o que o usuário vê.
- Caso de borda que não é óbvio.

## Fora de escopo

O que esta feature explicitamente não faz, para que a ausência não seja lida
como esquecimento.

## Critérios de aceite

- [ ] Dado <estado>, quando <ação>, então <resultado observável>.

## Questões em aberto

Marcar com `[NEEDS CLARIFICATION]`. Nenhum marcador pode sobreviver à
implementação.

---
Autor: · Status: rascunho · Data:
