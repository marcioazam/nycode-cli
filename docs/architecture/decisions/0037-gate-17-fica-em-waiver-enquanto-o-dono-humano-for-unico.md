# ADR-0037: GATE-17 fica em waiver enquanto o dono humano for único

- **Status:** aceito
- **Data:** 2026-08-18
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), [ADR-0034](0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md), `GATE-17`/`AI-02`, FR-26
- **Waiver:** GATE-17, AI-03
- **Expira:** 2027-02-18

## Contexto

`GATE-17` exige aprovação de um dono listado que **não** é o autor.
[ADR-0034](0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md)
já recusou `required_pull_request_reviews`: o único nome em
[`.github/CODEOWNERS`](../../../.github/CODEOWNERS) é `@marcioazam`, e a
aprovação exigida seria auto-aprovação. FR-26 do harness v1.2.0+ proíbe
tratar isso como `GATE-17` satisfeito. O ADR-0034 não tem os seis campos de
waiver; este ADR é o registro que faltava.

## Decisão

`GATE-17` **não é tratado como satisfeito** enquanto o `CODEOWNERS` listar um
único dono humano. Não se liga revisão obrigatória no GitHub para cumprir o ID.

Controle compensatório, os dois juntos:

1. **Lista de caminhos críticos** — o `CODEOWNERS`. Caminho novo de confiança
   entra nessa lista no mesmo PR.
2. **Review automatizado independente** — os 12 jobs exigidos em `main`
   (ADR-0034). Não é segundo humano. É o relatório determinístico que o
   padrão pede enquanto o dono é único.

## Consequências

Positivas: a matriz pode dizer `waiver` em FR-26 sem teatro de auto-aprovação.

Negativas: nenhuma segunda pessoa lê uma mudança crítica antes de `main`. O
risco é o já aceito no ADR-0034; este ADR impede que ele seja relatado como
`GATE-17` verde.

Descartadas:

- **Ativar `required_pull_request_reviews`.** Rejeitada no ADR-0034.
- **Apagar o `CODEOWNERS`.** A lista é o controle (1).

## Revisão

Reaberto no dia em que um segundo colaborador regular passar a abrir PRs —
exigir aprovação de um dono listado que não é o autor e apagar este waiver.
Expira em **2027-02-18**; se o dono continuar único, renova-se com a mesma razão.

**Rule:** `GATE-17`. **Scope:** caminhos do `CODEOWNERS`. **Owner:** marcioazam.
