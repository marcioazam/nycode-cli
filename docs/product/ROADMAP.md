# Roadmap — NyCode CLI

Organizado por ondas. A Wave 0 existia para descobrir em semanas, e não em meses,
se o esforço de port se pagava; o dimensionamento que justifica esse kill-gate
está na [spec](../../.specs/nycode-rs/spec.md#dimensionamento-medido).

A [emenda de escopo de 2026-08-13](../../.specs/nycode-rs/spec.md#emenda-de-escopo--2026-08-13)
acrescentou FR-11 a FR-20 e NFR-7, e reorganizou o que segue em três ondas. O
levantamento que a fundamenta está em
[`research-sota-2026.md`](../../.specs/nycode-rs/research-sota-2026.md).

## Ondas A, B e C — concluídas em 2026-08-13

As três foram entregues. FR-1 a FR-20 e NFR-1 a NFR-7 estão em `entregue` na
[tabela de requisitos](../requirements/REQUIREMENTS.md), e o
[CHANGELOG](../../CHANGELOG.md) registra cada uma com a razão.

Concluídas não significa que o trabalho de produto terminou. No mesmo dia, a
[spec 002](../specs/002-paridade-e-sota-2026/spec.md) abriu um épico de sessenta
deltas contra o harness de referência, e quatro das ondas dele seguem abertas —
a seção "Épico de paridade e SOTA 2026" abaixo.

O que a Onda A fechou não era feature nova: era a distância entre "implementado"
e "executa em produção". A TUI, o cancelamento, o cliente MCP, o catálogo e a
compactação existiam no código e nenhum era chamado — a documentação declarava
entregue o que nunca rodava.

A Onda B trouxe a base de 2026: as ferramentas somente-leitura que o gate de
permissão já nomeava sem que nenhuma existisse, o confinamento de SO do shell, o
modo de eventos JSON, slash commands, prompt caching de verdade e aprovação por
chamada.

A Onda C fez a paridade ampla: sessão em árvore, direcionamento durante o turno,
hooks, subagentes, plan mode, troca de modelo e entrada de imagem.

### O que ficou de fora, e por quê

- **Temas.** Cosmético, e o rodapé e o cabeçalho já respeitam a largura do
  terminal. **Esta recusa foi superada no mesmo dia**: a
  [spec 002](../specs/002-paridade-e-sota-2026/plan.md) trouxe temas para
  dentro do escopo como o delta B36, na Onda 5. Vale a spec, não esta linha —
  ela fica registrada porque a razão original ("entra quando alguém pedir")
  ainda explica por que temas não entraram nas ondas A, B e C.
- **`/import` e `/session`.** `/export` cobre o caminho de saída, que é o que
  resolve "quero levar esta conversa para outro lugar". A volta exige decidir o
  que fazer com um histórico que referencia arquivos que mudaram, e isso é uma
  spec, não um comando.
- **Paridade contra o harness de referência.** O job existe e falha fechado.
  **A causa registrada aqui — "espera um gateway configurado" — deixou de ser
  verdade em 2026-08-13**, quando o `nycode-parity-fixture` passou a servir um
  gateway determinístico e local. O bloqueio real é outro, e foi descoberto ao
  rodar: a referência não lê `ANTHROPIC_BASE_URL`, então apontá-la ao gateway
  local não funciona pelo mecanismo que o harness usava. Está registrado com a
  evidência na
  [rastreabilidade da spec 002](../specs/002-paridade-e-sota-2026/traceability.md),
  seção "Paridade real". Até destravar, o que trava é a suíte do próprio
  harness, que garante que ele continua capaz de acusar divergência.

## Épico de paridade e SOTA 2026 — em andamento

A [spec 002](../specs/002-paridade-e-sota-2026/spec.md) triou sessenta deltas
entre este repositório e o harness de referência em quatro baldes, e o
[plano](../specs/002-paridade-e-sota-2026/plan.md) os distribuiu em seis ondas.
As Ondas 0 e 1 fecharam; as Ondas 2 a 5 estão abertas, e a paridade real está
bloqueada com causa nomeada.

**O estado por onda e por delta vive na
[rastreabilidade](../specs/002-paridade-e-sota-2026/traceability.md), e não
aqui.** Este roadmap aponta para lá de propósito: uma segunda cópia do estado
seria, por construção, a que fica errada primeiro — e foi exatamente esse tipo
de divergência que originou o épico. O que fica aqui é só o suficiente para que
o roadmap não afirme o contrário do que a rastreabilidade registra.

| Onda | Escopo | Depende de |
|---|---|---|
| 2 — contexto e ferramentas | Transformação de mensagem, compactação por limiar, ferramentas, instruções de projeto, Agent Skills, consentimento MCP | Onda 1 |
| 3 — superfície de comando | Flags e comandos que ligam o que a Onda 2 constrói | Onda 2 |
| 4 — Agent Client Protocol | Integração com editor ([ADR-0029](../architecture/decisions/0029-a-integracao-com-editor-fala-acp.md)) | independente |
| 5 — TUI | Autocomplete, localizador, temas, markdown, imagem no terminal | independente |

A Onda 2 tem ordem interna travada pelo plano, e não é preferência de estilo: a
transformação de mensagem precede a compactação por limiar, porque compactar um
histórico que ainda contém chamada de ferramenta órfã produz um resumo que
descreve um estado que nunca existiu — falha silenciosa, não erro de build.

Antes de qualquer uma delas vem destravar a paridade real, pela razão que o
plano dá: o NFR-6 é a regra que o épico inteiro serve, e fechar mais uma onda
sem instrumento em modo completo repetiria a classe de defeito que a spec 002
foi escrita para eliminar.

## Depois

- **Distribuição.** Pacotes por plataforma além do binário do workflow de
  release.
- **Reset de contexto com artefato de handoff.** A compactação preserva
  continuidade sem dar página limpa, e há relato de que a "context anxiety"
  sobrevive a ela. **Não está mais bloqueado**: dependia de FR-14, que está
  entregue. Espera a Onda 2, e não FR-14 — o handoff se sobrepõe aos deltas de
  resumo de compactação (B10, B11), e desenhá-lo agora seria desenhá-lo contra
  uma compactação que está mudando embaixo dele.

## Pendências da adoção do SOTA-2026 (ADR-0032)

O [ADR-0032](../architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md)
declarou conformidade L2 com o padrão externo `base-software-rules`. O que
ficou de fora da primeira fatia, cada item já citando o ID de regra que fecha:

*(O que já satisfaz o padrão, com data e nota, vive na tabela de
reconciliação do [`AGENTS.md`](../../AGENTS.md) — não repetido aqui para não
divergir. Esta lista é só o que falta.)*

Todo gate do padrão já tem instrumento ou waiver formal, e a proteção de
branch já está configurada — nada pendente de ferramenta nem de
infraestrutura abaixo desta linha.

- **Trilha test-first automatizada** — commit RED só toca teste, commit
  GREEN não toca teste. `GATE-16`. **Não é mais um "falta fazer": é um
  waiver formal** ([ADR-0033](../architecture/decisions/0033-gate-16-fica-sem-instrumento-conflito-com-hook-e-squash-merge.md),
  expira 2027-02-14) — o gate, como o padrão externo especifica, conflita
  com o hook `pre-commit` deste repositório (que já impede um commit RED
  de existir) e com squash-merge (que apaga a separação RED/GREEN de
  `main` no merge). Reabrir exige mudar uma dessas duas políticas —
  confirmado com o usuário em 2026-08-14 que o waiver fica como está.

## Fora do roadmap

Runtime JavaScript embutido, instalador de pacotes próprio, interface gráfica ou
web própria, hospedagem de inferência e sessão remota sobre socket. São non-goals
declarados na [spec](../../.specs/nycode-rs/spec.md#fora-de-escopo), não itens
adiados.

"Interface própria" não inclui **falar** com um editor: quem desenha a interface
é o editor, e o `nycode` continua sendo um processo de terminal. É por isso que a
Onda 4 acima não contradiz esta lista — a integração por protocolo padronizado
saiu do não-escopo e entrou como FR-21, pela
[emenda de escopo](../../.specs/nycode-rs/spec.md#emenda-de-escopo--integração-de-editor).

Integração com servidor de linguagem, controle de depurador e automação de
navegador são diferenciais reais em 2026 e ficaram fora desta emenda. Entram por
spec própria se entrarem.
