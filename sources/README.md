# sources/

Material bruto das pesquisas que fundamentam decisões deste repositório.

Existe para que um achado citado num ADR ou numa spec possa ser conferido sem
refazer a busca — e para que se saiba o que foi lido, e não só o que foi
concluído. Uma página que muda ou sai do ar depois da decisão não invalida o
registro.

Cada arquivo nomeia a pesquisa que o originou e carrega, por fonte, a URL, a
data de acesso e as passagens efetivamente usadas. Não são cópias integrais: são
os trechos que sustentam uma afirmação, com contexto suficiente para julgá-los.

| Arquivo | Pesquisa | Alimenta |
|---|---|---|
| [`research_sota-2026-harnesses.md`](research_sota-2026-harnesses.md) | O que "SOTA 2026" exige de um harness de terminal | [`research-sota-2026.md`](../.specs/nycode-rs/research-sota-2026.md), ADRs 0004 a 0009 |
| [`research_paridade-pi-e-sota-2026.md`](research_paridade-pi-e-sota-2026.md) | O que a referência entrega que este repositório não, e o que 2026 pede além dela | [`research-paridade-2026.md`](../.specs/nycode-rs/research-paridade-2026.md), [spec 002](../docs/specs/002-paridade-e-sota-2026/spec.md), ADRs 0025 a 0029 |

Um arquivo pode carregar fonte que **não** deve ser usada. O
[`research_paridade-pi-e-sota-2026.md`](research_paridade-pi-e-sota-2026.md)
abre com uma, marcada como contaminada por proveniência. O registro existe
para que a próxima pesquisa a reencontre já sabendo disso, em vez de a
descobrir de novo — ou pior, de não a descobrir.
