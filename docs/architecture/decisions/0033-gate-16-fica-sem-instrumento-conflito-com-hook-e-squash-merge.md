# ADR-0033: GATE-16 (trilha test-first) fica sem instrumento — conflita com o hook de commit e com squash-merge

- **Status:** aceito
- **Data:** 2026-08-14
- **Contexto relacionado:** [ADR-0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md), `GATE-16`

## Contexto

`GATE-16` do padrão SOTA-2026 (guia normativo em
`guides/tdd-trail-guide.md` do padrão externo) exige que a trilha
test-first fique mecanicamente checável a partir do histórico do git: um
commit **RED** que toca só arquivo de teste e cuja pipeline falha naquele
ponto, seguido de um commit **GREEN** que toca só implementação. O
mecanismo listado tem quatro propriedades: (1) RED precede GREEN, (2) o
diff do RED só toca caminho de teste, (3) a pipeline falha no RED por
asserção — não por erro de compilação —, (4) o diff do GREEN não toca
caminho de teste.

Foi desenhada uma implementação (`scripts/test-trail-gate.sh`, nunca
mergeada) que tentava cobrir (2)+(4) via classificação por linha —
necessário porque o idioma dominante deste workspace é `#[cfg(test)] mod
tests { ... }` **dentro do mesmo arquivo** da implementação (121 arquivos,
`test_map`), então classificação por arquivo inteiro seria inerte pra
quase todo o Rust do repositório. Uma revisão adversarial em contexto
limpo (`doubt-driven-reviewer`) encontrou quatro defeitos Críticos,
verificados de forma independente contra o código real deste repositório
antes deste ADR ser escrito:

- **O hook de commit já impede um commit RED de existir.**
  `.githooks/pre-commit` executa `scripts/ci-local.sh --fast`, que roda
  `cargo test --workspace --all-features`. Um commit cujo teste novo falha
  é recusado pelo próprio hook antes de existir no histórico — a não ser
  que alguém use `--no-verify`, que as regras deste projeto proíbem sem
  autorização explícita e pontual. Nenhuma reformulação do gate em bash
  resolve isso: o conflito é entre duas políticas já adotadas
  (hook que barra teste quebrado vs. gate que exige um commit onde o teste
  está quebrado), não um bug de implementação.
- **`squash-merge` apaga a trilha no momento em que ela seria útil.**
  `git log --oneline` em `main` mostra que toda PR mergeada até aqui é um
  commit único squashado (`(#18)`, `(#17)`, ...). Mesmo uma separação
  RED/GREEN corretamente feita na branch da PR deixa de existir no
  histórico alcançável de `main` assim que a PR é mergeada e a branch
  apagada — o objetivo do guia ("uma propriedade que um revisor consegue
  checar... meses depois") nunca seria alcançado aqui, só verificado
  em trânsito durante o CI da própria PR.
- **O idioma de teste deste repositório tem formas que a classificação por
  linha não cobre com segurança.** Além do `mod tests` inline já
  considerado, existem 9 arquivos de teste dedicados fora do padrão
  assumido (`crates/nycode-agent/src/agent_test.rs`,
  `crates/nycode-cli/src/screen/screen_test.rs`, entre outros — já
  reconhecidos corretamente por `is_production()` em
  `scripts/diff-coverage-gate.sh:37`, mas por um predicado que a nova
  tentativa não reaproveitou), um `#[cfg(test)]` anotando uma *statement*
  dentro de função de produção
  (`crates/nycode-agent/src/session/store.rs:181`), módulo de teste
  fora-de-linha sem chave (`#[cfg(test)] mod agent_test;` em
  `crates/nycode-agent/src/lib.rs:25`), e um predicado composto
  (`#[cfg(all(test, unix))]` em
  `crates/nycode-agent/src/policy/confinement/process.rs:148`) que um
  casamento exato de `#[cfg(test)]` não pega.
- **O evento `pull_request` do GitHub Actions faz `HEAD` ser um commit de
  merge.** `actions/checkout` resolve `github.ref` para
  `refs/pull/N/merge` nesse evento — então qualquer gate que diferencie
  commit-a-commit (em vez de diferenciar o *intervalo* inteiro, como os
  quatro gates PR-only já existentes fazem) trataria a PR inteira como um
  único commit "RED+GREEN misturado" e reprovaria uma PR corretamente
  dividida.

## Decisão

`GATE-16` **não é instrumentado** por este repositório enquanto pelo menos
uma das duas políticas abaixo não mudar deliberadamente — e mudar
qualquer uma delas é, por si, uma decisão de peso equivalente a este ADR,
não um efeito colateral de implementar o gate:

1. O hook `pre-commit` passa a permitir um commit com teste falhando
   (ex.: um modo `RED=1 git commit` que pula só a suíte, mantendo
   `clippy`/formatação), ou
2. A estratégia de merge deixa de ser squash — merge commit ou rebase
   preservando o histórico da branch — para que a separação RED/GREEN
   sobreviva no `main`.

Até lá, `GATE-16` continua listado na tabela "O que ainda não tem
instrumento" do `AGENTS.md`, ao lado de `GATE-05`/`GATE-06`/`GATE-08`, e
não como "satisfeito" na tabela de reconciliação. A tentativa de
implementação (`scripts/test-trail-gate.sh`) não foi commitada.

## Consequências

Positivas: nenhum gate falso é publicado. Um `GATE-16` que classificasse
errado 12 pontos já identificados no código atual, ou que reprovasse toda
PR pelo formato do evento `pull_request`, seria pior que nenhum gate —
ensinaria a confiar numa checagem que não checa o que diz checar, o mesmo
argumento que `AGENTS.md` já usa para `test_map` ("um mapa errado ensina a
confiar onde não devia").

Negativas: o repositório continua sem prova mecânica de trilha test-first
— a disciplina real (observar o RED rodando o teste no terminal antes de
implementar, como a regra `tdd` exige) permanece uma prática não
verificável por fora de quem a executa, exatamente o problema que o guia
do padrão externo nomeia como motivação. Isso é uma lacuna real, registrada,
não uma lacuna escondida.

Descartadas:
- **Implementar a versão mais fraca (só a propriedade "nenhum commit
  mistura teste e produção", sem ordem nem verificação de falha).** Ainda
  colide com o evento `pull_request` tratando a PR inteira como um commit,
  e com squash apagando o resultado do `main` de qualquer forma — o
  esforço de manter a heurística de região por linha correta (9 formas
  distintas de `#[cfg(test)]` já catalogadas) não se paga por uma
  propriedade que nem sobrevive ao merge.
- **Usar `--no-verify` para permitir o commit RED.** Proibido pelas
  regras deste projeto sem autorização explícita e pontual do usuário;
  adotar isso como prática permanente para satisfazer um gate seria
  contornar uma proteção para fingir satisfazer outra.
- **Trocar a estratégia de merge para satisfazer o gate, decidido
  autonomamente nesta sessão.** Squash-merge é a prática já estabelecida
  neste repositório ao longo de toda a Onda de adoção do SOTA-2026 (PRs
  #8–#18); mudar a forma como todo PR futuro é mergeado é uma decisão de
  infraestrutura compartilhada, da mesma categoria que proteção de branch
  e `CODEOWNERS` — fica fora do escopo autônomo do `/goal termine tudo`.

## Revisão

Este ADR é revisto se o usuário decidir deliberadamente por uma das duas
mudanças de política da seção "Decisão", ou se o padrão externo passar a
aceitar uma prova mais fraca (ex.: uma trilha verificada só em trânsito
durante a PR, sem exigir sobrevivência no histórico de `main`) — o que
tornaria a versão descartada acima viável. Expira em **2027-02-14** (dois
trimestres); se nenhuma das duas condições acima se concretizar até lá,
o item permanece sem instrumento e este ADR é renovado com a razão de
continuar assim.
