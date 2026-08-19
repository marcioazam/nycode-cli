# ADR-0036: GATE-17 fica em waiver enquanto o dono humano for único

- **Status:** aceito
- **Data:** 2026-08-17
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), [ADR-0034](0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md), `GATE-17`/`AI-02`. O FR-26 da spec de harness (003) nomeia este waiver quando essa spec estiver na árvore; neste PR ela ainda não está.
- **Waiver:** GATE-17
- **Expira:** 2027-02-17

## Contexto

`GATE-17` do padrão SOTA-2026 exige aprovação humana de um dono listado que
não é o autor, quando a mudança toca um caminho crítico. Este repositório
já lista esses caminhos em [`.github/CODEOWNERS`](../../../.github/CODEOWNERS):
credencial, CI, `deny.toml` e ADRs, além do dono padrão `*`. O único nome
em todas as linhas é `@marcioazam`.

[ADR-0034](0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md)
já recusou `required_pull_request_reviews` nesse cenário: com mantenedor
único, a aprovação exigida seria auto-aprovação — teatro de processo, não
uma segunda perspectiva. Ligar essa trava agora para marcar `GATE-17` como
satisfeito seria exatamente o auto-aprovação que o padrão pede para não fingir.

O que falta, e este ADR registra, é o waiver honesto: não fingir o gate, e
nomear o controle que cobre o buraco enquanto só existe um humano.

## Decisão

`GATE-17` **não é tratado como satisfeito** enquanto
`.github/CODEOWNERS` listar um único dono humano. Não se ativa revisão
obrigatória no GitHub para cumprir o ID.

Controle compensatório, os dois juntos:

1. **Lista de caminhos críticos** — o próprio `CODEOWNERS`, já existente.
   Caminho novo de confiança (credencial, workflow, política de
   dependência, ADR) entra nessa lista no mesmo PR, não depois.
2. **Review automatizado independente** — os 12 jobs que o ADR-0034
   já exige em `main`: lint, layout, pr-size, workflows, test,
   default-build-has-no-subscription-oauth, mutation, coverage, perf,
   supply-chain, parity, docker. Não é segundo humano. Gates de waiver e
   de harness de agente, quando existirem, entram nessa lista no mesmo PR
   em que o job passar a ser exigido — não nesta frase, à frente do
   instrumento.

## Consequências

Positivas: a matriz de conformidade pode dizer `waiver` em `GATE-17`/`FR-26` sem
inventar um clique de auto-aprovação. O `CODEOWNERS` continua sendo a
lista, não um enfeite.

Negativas: nenhuma segunda pessoa lê uma mudança crítica antes de
`main`. O risco é o mesmo já aceito no ADR-0034; este ADR só impede que
ele seja relatado como `GATE-17` verde.

Descartadas:

- **Ativar `required_pull_request_reviews`.** Rejeitada no ADR-0034, e
  rejeitada de novo aqui: o ID do padrão pede dono que não é o autor, não
  um segundo clique do mesmo autor.
- **Apagar o `CODEOWNERS` por não ter segundo dono.** A lista é o
  controle (1). Sem ela, o waiver não tem o que compensar.

## Revisão

Reaberto no dia em que um segundo colaborador regular passar a abrir PRs
— a ação padrão é exigir aprovação de um dono listado que não é o autor,
e então apagar este waiver. Expira em **2027-02-17** (dois trimestres);
se o dono continuar único, renova-se com a mesma razão.
