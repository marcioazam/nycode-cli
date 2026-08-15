# ADR-0032: Adota o padrão externo SOTA-2026 (base-software-rules) no nível L2

- **Status:** aceito
- **Data:** 2026-08-14
- **Contexto relacionado:** [`AGENTS.md`](../../../AGENTS.md), seção "Padrão
  externo — SOTA-2026 v1.1.0, nível L2"

## Contexto

Existe um documento de padrão de engenharia externo a este repositório
(`base-software-rules`, SOTA-2026 v1.1.0) — dez pilares, cerca de 180 regras
com ID estável, uma tabela única de gates numéricos, agnóstico de stack. O
pedido foi que este repositório passe a declarar conformidade formal com ele
em vez de manter suas próprias convenções (cobertura, layout, pinning de
action, postura de segurança) como um sistema paralelo sem rastreabilidade
cruzada.

Este repositório não é greenfield: já tem `AGENTS.md` vinculante, 31 ADRs e
gates de CI que, medidos contra a tabela do padrão, batem ou excedem vários
números — a cobertura 95%/90% é idêntica a `GATE-03`/`GATE-02`; o teto de 7
arquivos por diretório é mais rígido que o `ADV-01` do padrão (consultivo, a
partir de 9). Adotar o padrão por cima é trabalho de reconciliação e
rastreabilidade, não de substituição.

O padrão em si proíbe pull request de agente acima de 400 linhas / 15 arquivos
(`GATE-11`/`AI-01`) — o que significa que aplicá-lo por completo (novos gates
de CI que exigem pesquisa de ferramenta Rust, lacunas de `docs/`, configuração
de proteção de branch no GitHub) não cabe numa única mudança sem violar a
própria regra que está sendo adotada.

## Decisão

Declara-se conformidade **L2 (standard)** com o SOTA-2026 v1.1.0, per a
definição do `CONFORMANCE.md` do padrão: "qualquer serviço, biblioteca ou
produto do qual outra pessoa ou sistema dependa". Não é L1 (protótipo com
expiração) — este repositório já publica release
([`release.yml`](../../../.github/workflows/release.yml)) e documenta
instalação no `README.md`.

Restrições que fazem parte desta decisão, não negociáveis:

- **Nenhum número do padrão é restatado como valor independente** em qualquer
  arquivo deste repositório. A tabela de reconciliação no `AGENTS.md` cita o
  ID da regra e aponta para a seção onde o número real já vive (as próprias
  seções de gate deste `AGENTS.md`, ou `scripts/*-gate.sh`).
- **A política de zero exemption `below-floor` para cobertura não vira uso do
  mecanismo de waiver do padrão.** Waiver, por definição, expira em no máximo
  dois trimestres; a política deste repositório é permanente. O mecanismo de
  waiver formal (regra, escopo, razão, controle compensatório, dono,
  expiração) é adotado só para os gates novos que entrarem depois desta
  decisão.
- **A spec normativa continua em `.specs/nycode-rs/spec.md`**, fora de
  `docs/specs/` — desvio deliberado do template do padrão, documentado aqui
  para não ser confundido com uma pendência: mover o arquivo quebraria os
  links relativos que os 31 ADRs já fazem para ele.
- **Esta fatia (Fase 0) cobre só documentação aditiva** — `CLAUDE.md`,
  `SECURITY.md`, `CONTRIBUTING.md`, `.github/CODEOWNERS`, a seção nova do
  `AGENTS.md`, este ADR. Nenhum gate de CI novo, nenhuma ferramenta Rust nova,
  nenhuma mudança de configuração no GitHub (proteção de branch fica fora até
  confirmação explícita, por ser infraestrutura compartilhada). O que falta
  está em [`docs/product/ROADMAP.md`](../../product/ROADMAP.md), cada item já
  citando o ID de regra que fecha.

## Consequências

Positivas: toda regra existente ganha um ID citável, o que torna revisão e
comentário de PR mais curtos ("falta `SP-04`" em vez de reexplicar a regra
inteira); lacunas reais (mutation testing, complexidade, duplicação, cobertura
de diff, `test_map`) ficam nomeadas e rastreadas em vez de invisíveis; a
convenção de rodapé de commit se alinha com `AI-07`/`AI-08`/`AI-09` do padrão.

Negativas: mais um documento externo para manter sincronizado — se o padrão
subir de versão, a seção de reconciliação do `AGENTS.md` precisa ser revisada,
e nada neste repositório avisa automaticamente quando isso acontece. O
roadmap cresce com itens que exigem pesquisa de ferramenta ainda não feita
(complexidade e duplicação em Rust não têm candidato confirmado).

Descartadas:

- **Copiar o texto do padrão para dentro deste repositório.** Rejeitado
  porque duplicaria conteúdo que já existe em outro lugar e criaria dois
  documentos para manter sincronizados em vez de um citado por ID.
- **Aplicar tudo de uma vez, incluindo os gates novos de CI e a proteção de
  branch.** Rejeitado porque o próprio padrão proíbe PR de agente acima de
  400 linhas / 15 arquivos, e proteção de branch é mudança de infraestrutura
  compartilhada que pede confirmação explícita antes de mexer.
- **Nível L3 (regulado).** Rejeitado — este repositório não movimenta
  dinheiro nem dado pessoal em escala, não tem obrigação de auditoria legal
  ou contratual declarada.

## Revisão

Reabre se: o padrão externo subir de versão major (mudança de obrigação, per
o próprio `VERSIONING.md` dele); qualquer item do roadmap ganhar instrumento
real (a linha correspondente na tabela de reconciliação do `AGENTS.md` migra
de "sem instrumento" para "satisfeito"); ou este repositório passar a ter mais
de um mantenedor, ponto em que o `CODEOWNERS` de dono único deixa de refletir
a realidade. Ação padrão em qualquer um dos três casos: atualizar a seção do
`AGENTS.md` e este ADR na mesma mudança que motivou a revisão — nunca deixar
os dois divergirem.
