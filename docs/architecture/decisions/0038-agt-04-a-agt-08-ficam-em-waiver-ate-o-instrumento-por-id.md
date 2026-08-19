# ADR-0038: AGT-04 a AGT-08 ficam em waiver até o instrumento por ID

- **Status:** superseded
- **Data:** 2026-08-18
- **Contexto relacionado:** [ADR-0036](0036-o-pin-sota-2026-sobe-para-v1-4-0-com-tres-perfis.md), `AGT-04`–`AGT-08`, FR-30–FR-34

## Contexto

O perfil Produto agente aplica. AGT-02 já recusa ferramenta não concedida.
AGT-01 (overlay) e AGT-03 (pin no execute) cabem nesta fatia. AGT-04 exige
argv em vez de `bash -c` do modelo — mudança de contrato da ferramenta `bash`.
AGT-05 exige bind ator/alvo/parâmetros canônicos. AGT-06 exige credencial
de ferramenta de curta duração. AGT-07 exige TTL e validação do JSONL de
sessão. AGT-08 exige autenticação do envelope de subagente. Cada um estoura
`GATE-11` se entrar no mesmo PR do pin.

## Decisão

`AGT-04` fica em waiver até ganhar
instrumento próprio (TDD, falha fechada vista uma vez) numa PR separada.
AGT-05 saiu deste waiver quando `Bound` recusou reusar grant de um path noutro.
AGT-06 saiu quando `redact::apply` tirou o segredo plantado do `ContentBlock`.
AGT-07 saiu quando `store/mac.rs` recusou linha sem MAC, expirada ou estrangeira.
AGT-08 saiu quando `task` recusou spawn sem envelope, com MAC forjado ou expirado.
AGT-04 saiu quando `bash` recusou `command` e interpretador+`-c`, e um slot com
metacaractere chegou literal ao stdout. Sem IDs restantes, este ADR fica
superseded.
Controle compensatório enquanto isso: gate de permissão (AGT-02),
aprovação por chamada (`Approver::Never` por omissão), isolamento de env do
filho, pin MCP no consentimento (ADR-0028), envelope HMAC do filho (ADR-0007).
Isso **não** satisfaz `AGT-04`; só cobre parte do risco.

**Rule:** `AGT-04`. **Scope:** runtime NyCode (`bash`).
**Owner:** marcioazam.

## Consequências

Positivas: a matriz não mente; o trabalho restante tem dono e data.

Negativas: o produto continua com `bash -c` até a PR de `AGT-04`.

Descartadas:

- **Declarar os cinco `instrumentado` com os controles adjacentes.** Controles
  adjacentes não são o ID.
- **Implementar os cinco nesta fatia.** Viola `GATE-11`.

## Revisão

Cada ID sai deste ADR quando o instrumento correspondente mergear. Expira em
**2027-02-18**.
