# ADR-0004: O cliente MCP usa o SDK oficial `rmcp`, não um JSON-RPC próprio

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7, NFR-3

## Contexto

O [ADR-0002](0002-extensions-are-out-of-process.md) elegeu MCP como o primeiro
dos três mecanismos de extensão. O que existe hoje no repositório é a metade de
cima: `mcp::config::discover` lê `.mcp.json`, `.claude/mcp.json` e
`.nycode/mcp.json`, e `mcp::tool::McpTool` faz a ponte de uma ferramenta remota
para o catálogo do agente com nome qualificado `servidor__ferramenta`. Ambos
estão cobertos por teste. Falta a metade de baixo: o trait `Transport` não tem
nenhuma implementação real, apenas um fake de teste, e nada constrói um
`McpTool` fora dos próprios testes. FR-7 está declarado entregue e não executa.

O protocolo mudou de forma relevante desde a redação da spec. A revisão
`2026-07-28` tornou o núcleo stateless, substituiu as requisições
servidor-para-cliente de `elicitation/create`, `sampling/createMessage` e
`roots/list` por Multi Round-Trip Requests, exige os headers `Mcp-Method` e
`Mcp-Name` no Streamable HTTP, elevou `inputSchema` e `outputSchema` a JSON
Schema 2020-12 completo, reclassificou HTTP+SSE como depreciado e trocou o
código de erro de recurso ausente de `-32002` para o `-32602` padrão. São
mudanças que quebram implementações ingênuas, e a política de depreciação
formal do próprio protocolo garante que virão outras.

Reimplementar isso à mão significa assinar um contrato de manutenção com um
padrão que revisa a cada poucos meses, para ganhar bytes num binário que já tem
folga de 21 MiB no orçamento de memória e cujo gargalo declarado é startup, não
tamanho.

## Decisão

O transporte MCP vem do `rmcp`, o SDK oficial em Rust, sob Apache-2.0, com as
obrigações de atribuição cumpridas no [`NOTICE`](../../../NOTICE).

Quatro restrições fazem parte da decisão:

- **Só as features de cliente.** `transport-child-process` para stdio e
  `transport-streamable-http-client-reqwest` para HTTP. Nada de servidor, nada
  de macros: o NyCode CLI é cliente de MCP, não hospedeiro.
- **O `reqwest` é o mesmo do `nycode-ai`**, com `rustls`, para não trazer uma
  segunda pilha de TLS ao binário.
- **O trait `Transport` de `nycode-agent` permanece.** O `rmcp` entra atrás
  dele, num crate `nycode-mcp` próprio, para que o loop de agente não conheça o
  SDK e o fake de teste continue válido.
- **O custo em binário é medido e registrado a cada onda.** Se `rmcp` empurrar o
  binário além do que NFR-3 tolera, a decisão é reaberta, não silenciada.

## Consequências

Positivas: as mudanças de protocolo chegam por bump de dependência em vez de
leitura de changelog; os transportes stdio e Streamable HTTP vêm prontos, o
segundo deles com a semântica stateless nova; o esquema de ferramenta é validado
contra JSON Schema 2020-12 sem código próprio; e a superfície de manutenção sai
do repositório.

Negativas: uma dependência grande entra no caminho crítico de uma feature
central, com o risco de abandono que qualquer dependência carrega. O peso em
binário pressiona NFR-3, e o número real só se conhece depois de integrar. O
`rmcp` traz o próprio modelo de erro, que precisa ser traduzido para
`nycode_agent::Error` sem achatar detalhe — NFR-4 vale para o erro de um
servidor MCP tanto quanto para o do gateway.

Descartadas: **JSON-RPC próprio sobre `serde_json`**, rejeitado porque o custo
não é escrever o cliente, é persegui-lo por revisão de protocolo; o repositório
tem seis crates e nenhum deles quer ser mantenedor de um SDK. **Adiar MCP para
depois da TUI**, rejeitado porque FR-7 já consta como entregue em documento e a
correção da declaração sem a correção do código apenas troca uma dívida por
outra. **Suportar apenas stdio**, rejeitado porque servidores remotos são o caso
que mais cresce e a diferença de esforço, com o SDK, é uma feature de cargo.

## Revisão

Reabrir se o `rmcp` custar mais que 2 MiB no binário final, se o projeto ficar
seis meses sem acompanhar uma revisão do protocolo, ou se a licença mudar. A
ação padrão em qualquer desses casos é implementar stdio à mão — que é a metade
simples — e manter Streamable HTTP atrás de feature opcional.
