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
  terminal. Entra quando alguém pedir.
- **`/import` e `/session`.** `/export` cobre o caminho de saída, que é o que
  resolve "quero levar esta conversa para outro lugar". A volta exige decidir o
  que fazer com um histórico que referencia arquivos que mudaram, e isso é uma
  spec, não um comando.
- **Paridade contra o harness de referência.** O job existe e falha fechado, mas
  a comparação completa espera um gateway configurado. Até lá, o que trava é a
  suíte do próprio harness, que garante que ele continua capaz de acusar
  divergência.

## Depois

- **Distribuição.** Pacotes por plataforma além do binário do workflow de
  release.
- **Reset de contexto com artefato de handoff.** A compactação preserva
  continuidade sem dar página limpa, e há relato de que a "context anxiety"
  sobrevive a ela. Só faz sentido depois de FR-14, que é o que torna o histórico
  completo recuperável.

## Pendências da adoção do SOTA-2026 (ADR-0032)

O [ADR-0032](../architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md)
declarou conformidade L2 com o padrão externo `base-software-rules`. O que
ficou de fora da primeira fatia, cada item já citando o ID de regra que fecha:

*(O que já satisfaz o padrão, com data e nota, vive na tabela de
reconciliação do [`AGENTS.md`](../../AGENTS.md) — não repetido aqui para não
divergir. Esta lista é só o que falta.)*

- **Complexidade cognitiva e ciclomática por função.** `GATE-05`, `GATE-06`,
  `ARCH-10`. Pesquisa de ferramenta concluída em 2026-08-14: escolhida
  `codemetrics` (github.com/richardwooding/codemetrics), binário Go com
  backend tree-sitter para Rust, flags `--diff`/`--max-cognitive`/
  `--max-cyclomatic`/`--baseline` já prontas pro formato de gate deste
  repositório.
- **Duplicação de código, teto de 5%.** `GATE-08`. Ferramenta recomendada
  pela mesma pesquisa: `jscpd` v5 / motor Rust (`cargo install jscpd`),
  `.rs` como formato nativo, flag `--threshold`.
- **Trilha test-first automatizada** — commit RED só toca teste, commit
  GREEN não toca teste. `GATE-16`. **Não é mais um "falta fazer": é um
  waiver formal** ([ADR-0033](../architecture/decisions/0033-gate-16-fica-sem-instrumento-conflito-com-hook-e-squash-merge.md),
  expira 2027-02-14) — o gate, como o padrão externo especifica, conflita
  com o hook `pre-commit` deste repositório (que já impede um commit RED
  de existir) e com squash-merge (que apaga a separação RED/GREEN de
  `main` no merge). Reabrir exige mudar uma dessas duas políticas.
- **Proteção de branch + exigência de aprovação do `CODEOWNERS` no GitHub.**
  Configuração de infraestrutura compartilhada — precisa de confirmação
  explícita antes de qualquer mudança.

## Fora do roadmap

Runtime JavaScript embutido, instalador de pacotes próprio, interface gráfica ou
de editor, e hospedagem de inferência. São non-goals declarados na
[spec](../../.specs/nycode-rs/spec.md#fora-de-escopo), não itens adiados.

Integração com servidor de linguagem, controle de depurador e automação de
navegador são diferenciais reais em 2026 e ficaram fora desta emenda. Entram por
spec própria se entrarem.
