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

## Fora do roadmap

Runtime JavaScript embutido, instalador de pacotes próprio, interface gráfica ou
de editor, e hospedagem de inferência. São non-goals declarados na
[spec](../../.specs/nycode-rs/spec.md#fora-de-escopo), não itens adiados.

Integração com servidor de linguagem, controle de depurador e automação de
navegador são diferenciais reais em 2026 e ficaram fora desta emenda. Entram por
spec própria se entrarem.
