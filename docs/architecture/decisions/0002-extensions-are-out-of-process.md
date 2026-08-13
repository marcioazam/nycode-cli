# ADR-0002: Extensões são out-of-process, sem runtime JavaScript embutido

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-7, NFR-2, NFR-3

## Contexto

O harness de referência estende-se por módulos TypeScript carregados no processo.
Reproduzir essa ergonomia em Rust exige embutir um runtime JavaScript, o que entra
em conflito direto com os requisitos de tamanho de binário e memória que motivam o
projeto.

Medição de referência, em Apple arm64, de um binário de CLI de agente com e sem
runtime embutido:

| Configuração | Tamanho | Delta |
|---|---:|---:|
| Controle sobre Node | 17.209.648 B | — |
| QuickJS embutido | 18.526.432 B | +1,26 MiB (+7,65%) |
| V8 embutido | 68.314.656 B | +51,1 MB |

Um binário Rust com V8 embutido seria quase quatro vezes maior que o executável
Node que ele substituiria. O ganho que justifica o projeto desapareceria.

O projeto `loadr` chegou de forma independente à mesma conclusão no seu ADR-001,
escolhendo QuickJS sobre `deno_core` por startup e footprint, e aceitando a
ausência de JIT porque a carga é dominada por I/O. Um harness de agente é ainda
mais dominado por I/O: ele passa a sessão inteira esperando tokens.

## Decisão

O NyCode CLI não embute runtime JavaScript. A extensibilidade é composta por
três mecanismos que já existem e já têm ecossistema:

- **Servidores MCP** para ferramentas e recursos, falados por protocolo, em
  processo separado e em qualquer linguagem.
- **Hooks de ciclo de vida** como executáveis, recebendo e devolvendo JSON.
- **Arquivos de skill** em markdown com frontmatter, carregados como instrução.

Ferramentas nativas adicionais, quando necessárias, são compiladas no binário.

## Consequências

Positivas: o binário permanece pequeno; o isolamento entre extensão e harness é o
do sistema operacional, não o de um sandbox interno; extensões podem ser escritas
em qualquer linguagem; e os três mecanismos escolhidos já são padrões com
implementações e conteúdo existentes.

Negativas: extensões do harness de referência não são portáveis para o
NyCode CLI — a compatibilidade é conceitual, não binária. Uma extensão precisa
de um salto de processo para cada interação, o que a torna inadequada para
caminhos de altíssima frequência. Não há API tipada in-process para lógica
proprietária; ela precisa virar ferramenta nativa ou servidor MCP.

Descartadas: `deno_core` com V8, rejeitado por medição; `rquickjs`, que custaria
apenas 1,26 MiB e preservaria ergonomia parecida, rejeitado por adicionar um
segundo modelo de extensão sem eliminar a necessidade de MCP; e plugins WASM via
`extism`, rejeitado porque exigir compilação eleva demais a barreira de autoria
para o ganho que oferece sobre MCP.

## Revisão

Reabrir se surgir demanda concreta por extensões in-process de alta frequência que
o custo de salto de processo inviabilize. Nesse caso o candidato é `rquickjs`, não
V8, e a decisão precisa vir acompanhada de medição do caminho quente em questão.
