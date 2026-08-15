# ADR-0034: Proteção de branch em `main` exige os 12 checks de CI, sem aprovação humana separada

- **Status:** aceito
- **Data:** 2026-08-14
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), `GATE-17`/`AI-02`

## Contexto

Até esta data, `main` não tinha proteção nenhuma configurada no GitHub —
confirmado consultando a API (`GET
/repos/marcioazam/nycode-cli/branches/main/protection` retornava `404
Branch not protected`). O `.github/CODEOWNERS` já existia desde a Fase 0 da
adoção do SOTA-2026, mas sem uma regra de proteção que o tornasse
obrigatório, o arquivo era só documentação — ninguém era de fato impedido
de mergear sem passar por ele. `docs/product/ROADMAP.md` já citava isso
como pendência explícita, fora do escopo autônomo de qualquer sessão até o
usuário confirmar.

Este repositório já impõe disciplina equivalente do lado local: os hooks em
`.githooks/` bloqueiam merge e push sem `scripts/ci-local.sh --full` verde,
e o comentário em `.github/workflows/ci.yml` sobre o gatilho `merge_group`
já registrava a intenção — "a fila de merge é a peça do lado remoto que
impõe o mesmo bloqueio que os hooks locais impõem do lado do
desenvolvedor: sem isto o 'CI verde para merge' só valia na máquina de quem
commitou." A proteção de branch é essa peça do lado remoto.

## Decisão

`main` exige que os 12 jobs de CI atuais passem antes de qualquer merge —
`lint`, `layout`, `pr-size`, `workflows`, `test`,
`default-build-has-no-subscription-oauth`, `mutation`, `coverage`, `perf`,
`supply-chain`, `parity`, `docker` — com `strict: true` (a branch precisa
estar atualizada com `main` antes do merge, não só ter passado em algum
commit anterior). Force-push e deleção de `main` ficam bloqueados do lado
do GitHub, espelhando o que `.githooks/block-dangerous-git.sh` já bloqueia
localmente.

**Deliberadamente sem exigência de aprovação humana separada** —
`required_pull_request_reviews` fica `null`, e sem `enforce_admins`. O
usuário escolheu essa opção diretamente (entre três apresentadas: só CI,
CI+1 aprovação, trava total com CODEOWNERS+admins) depois de eu confirmar
que a proteção estava ausente e pedir a decisão explícita, exigida desde
que este item entrou no roadmap. A razão declarada: o fluxo já estabelecido
nesta sessão — PR aberta, CI verde nos 12 jobs, merge — continua
funcionando sem mudança, porque este repositório tem mantenedor único
(`@marcioazam`, único nome em `.github/CODEOWNERS`) e uma exigência de
aprovação nesse cenário só adicionaria um clique de auto-aprovação, não
uma segunda perspectiva de verdade.

`checks` (não `contexts`) é usado no payload da API — a forma mais nova,
que amarra o `app_id` do GitHub Actions a cada nome de job, mais precisa
que a lista de strings livre da API antiga.

## Consequências

Positivas: nenhum PR chega a `main` com um dos 12 gates falhando ou
pendente, nem por push direto (o próprio git recusa a atualizar a branch
protegida sem o status exigido) nem por merge apressado. Documentado, não
mais implícito na disciplina de quem está commitando naquele momento.

Negativas: nenhuma segunda pessoa revisa uma mudança antes dela chegar a
`main` — a proteção aqui é inteiramente mecânica (CI), não de julgamento
humano independente. Isso é aceitável hoje porque o mantenedor é único; se
um segundo colaborador regular aparecer, esta decisão precisa ser revista
antes que a ausência de revisão vire um ponto cego real, não hipotético.

Descartadas:
- **CI + 1 aprovação.** Rejeitada porque, com mantenedor único, a
  aprovação exigida seria auto-aprovação — teatro de processo, não
  revisão de verdade.
- **Trava total (CI + aprovação + CODEOWNERS + `enforce_admins`).**
  Rejeitada pelo mesmo motivo, com o custo adicional de que
  `enforce_admins: true` removeria até a válvula de escape do dono do
  repositório em caso de emergência genuína (ex.: reverter algo quebrado
  quando o CI está indisponível) — um risco novo, não uma mitigação.
- **Ativar `merge_group`/fila de merge agora.** O gatilho já existe em
  `ci.yml`, mas ativar a fila de merge muda a mecânica de como todo merge
  acontece (lote, CI rerodado em fila), o que não foi descrito nem
  aprovado nesta decisão — fica fora de escopo até virar pedido explícito
  separado.

## Revisão

Revisado se: um segundo colaborador regular passar a abrir PRs (a ausência
de revisão humana deixa de ser aceitável), ou se o usuário decidir ativar a
fila de merge (`merge_group`) que `ci.yml` já expõe.
