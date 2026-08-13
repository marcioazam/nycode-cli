# Requisitos — NyCode CLI

> Consolidação navegável. A fonte normativa é
> [`.specs/nycode-rs/spec.md`](../../.specs/nycode-rs/spec.md); em caso de
> divergência, a spec vence e este documento é o defeito.

## Funcionais

| ID | Requisito | Estado |
|---|---|---|
| FR-1 | `nycode` num diretório abre sessão interativa apontada ao gateway | entregue |
| FR-2 | `nycode -p "<prompt>"` executa headless e escreve o resultado em stdout | entregue |
| FR-3 | Quatro ferramentas de mutação mais um conjunto somente-leitura de busca e listagem | entregue |
| FR-4 | A resposta é transmitida incrementalmente, com cancelamento a qualquer momento sem corromper a sessão | entregue |
| FR-5 | Sessões são persistidas e podem ser continuadas ou retomadas | entregue |
| FR-6 | O catálogo de modelos é descoberto, não hardcoded | entregue |
| FR-7 | Capacidades adicionais chegam por MCP, hooks e skills, sem recompilar | parcial (MCP e skills ligados; hooks não existem) |
| FR-8 | `AGENTS.md`, `SKILL.md` e regras de projeto são lidos sem configuração | entregue |
| FR-9 | Um provider alternativo pode ser configurado por arquivo, incluindo endpoints OpenAI-compatíveis | entregue |
| FR-10 | Credenciais ficam no cofre do sistema operacional, não em texto plano | entregue |
| FR-11 | O comando de shell roda sob sandbox do sistema operacional | entregue (bubblewrap no Linux, Seatbelt no macOS; ausência é avisada) |
| FR-12 | Três modos de saída: interativo, `-p` e stream de eventos JSON | parcial (interativo e `-p`; falta o modo JSON) |
| FR-13 | Slash commands como templates de markdown com argumentos | entregue |
| FR-14 | A sessão é uma árvore navegável, com branching in-place | entregue (formato v2, `/tree`, `/fork`) |
| FR-15 | O agente delega trabalho a subagentes com contexto próprio | entregue (ferramenta `task`) |
| FR-16 | Hooks de ciclo de vida como executáveis com contrato JSON | entregue |
| FR-17 | Plan mode: plano apresentado antes de qualquer mutação | entregue (`/plan`) |
| FR-18 | Mensagens podem ser enfileiradas e direcionadas durante o turno | entregue |
| FR-19 | O modelo pode ser trocado no meio da sessão, com custo visível | entregue (`/model`) |
| FR-20 | Imagens podem ser anexadas ao pedido | entregue (`--image`) |

### Requisitos parcialmente entregues

Três requisitos estiveram marcados como entregues sem que o código
correspondente executasse em produção. O NFR-4 proíbe degradar em silêncio; a
mesma regra vale para este documento.

- **FR-7.** Dois dos três mecanismos estão ligados. MCP fala o protocolo de
  verdade pelo crate `nycode-mcp`, com transporte stdio e Streamable HTTP
  ([ADR-0004](../architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)),
  e as ferramentas dos servidores declarados entram no catálogo do agente.
  Hooks não existem em nenhuma forma
  ([ADR-0009](../architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)
  fixa o contrato; falta implementar).

## Não-funcionais

| ID | Requisito | Verificação |
|---|---|---|
| NFR-1 | **Startup: 3.000 µs na chegada do processo, ou baseline ÷ 3; 15.000 µs na sessão montada** | [`scripts/perf-gate.sh`](../../scripts/perf-gate.sh) e [`perf-gate-test.sh`](../../scripts/perf-gate-test.sh), job `perf` |
| NFR-2 | **Memória residente: 8 MiB na chegada, ou baseline ÷ 2; 14 MiB numa sessão ociosa** | [`scripts/perf-gate.sh`](../../scripts/perf-gate.sh) e [`perf-gate-test.sh`](../../scripts/perf-gate-test.sh), job `perf` |
| NFR-3 | Binário estático, sem runtime externo nem arquivos irmãos obrigatórios, **abaixo de 16 MiB ou baseline ÷ 5** | [`scripts/perf-gate.sh`](../../scripts/perf-gate.sh) e [`perf-gate-test.sh`](../../scripts/perf-gate-test.sh), job `perf` |
| NFR-4 | Fidelidade de wire: nada degradado em silêncio | Testes de dialeto; harness `nycode-parity`, job `parity` |
| NFR-5 | **Cobertura de 95% agregada e 90% por arquivo de produção, com exemptions declaradas que só encolhem** | [`scripts/coverage-gate.sh`](../../scripts/coverage-gate.sh), job `coverage` |
| NFR-6 | Divergência observável da referência precisa ser decisão registrada, não acidente | ADR obrigatório; harness `nycode-parity`, job `parity` |
| NFR-7 | O prefixo do pedido é estável entre turnos, e a taxa de acerto de cache é observável | Teste de estabilidade de prefixo; rodapé mostra a taxa de acerto |
| NFR-8 | **Segurança precede performance; o número de perf vem do build padrão com todo controle ativo, e artefato de terceiro é verificado antes de executar** | `needs: [supply-chain]` no job `perf` do [`ci.yml`](../../.github/workflows/ci.yml); digest fixado em [`perf-baseline.txt`](../../scripts/perf-baseline.txt), conferido em [`perf-baseline.yml`](../../.github/workflows/perf-baseline.yml) |

### NFR-5 em detalhe

Dois pisos, ambos duros, ambos falhando fechado
([ADR-0003](../architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)):

1. **Agregado ≥ 95,0%** de linhas sobre os arquivos de produção.
2. **Todo arquivo de produção** com pelo menos uma linha instrumentada **≥
   90,0%**.

Produção é `crates/*/src/**` menos os arquivos que só existem para os testes —
`*_test.rs`, `tests.rs` e `fakes.rs`. Um arquivo de teste tem cobertura perto de
100% por construção: incluí-lo media o esforço de teste em vez do que ele
protege. **Limitação conhecida:** um `#[cfg(test)] mod tests` embutido num
arquivo de produção continua contando, porque separá-lo exigiria exclusão por
região, que o formato de relatório não expressa por atributo.

O agregado sozinho esconde a própria distribuição: um arquivo no chão custa a ele
um erro de arredondamento, enquanto é exatamente o código que ninguém testou.

Exemptions vivem em
[`scripts/coverage-exemptions.txt`](../../scripts/coverage-exemptions.txt), são
declaradas com tipo e razão, e ratchetam: uma entrada obsoleta falha o gate.
Adicionar `below-floor` é uma decisão revisável, nunca um atalho — escreva o
teste que falha primeiro.

### NFR-1 a NFR-3 em detalhe

Dois pisos por métrica, e vale o mais apertado dos dois
([ADR-0012](../architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)):
um absoluto, perto do valor medido, que pega regressão nossa; e um relativo ao
[baseline do concorrente](../../scripts/perf-baseline.txt), que pega o mercado
passando na frente. O absoluto sozinho não vê o concorrente melhorar — e ser mais
rápido que a alternativa já instalada é a razão declarada de este projeto existir
em Rust.

O gate compara o **menor tempo observado**, não a mediana. Não é preferência: num
runner compartilhado a mediana mede a contenção e o mínimo mede o programa. Sob
load average 89, o mínimo da chegada do processo ficou entre 465 µs e 560 µs
(dispersão 1,2x) enquanto a mediana foi de 1.033 µs a 3.580 µs (dispersão 3,5x).
Com a mediana o gate reprovava um binário sem nenhuma regressão.

A sessão montada só tem piso absoluto, porque o concorrente não expõe sonda
equivalente e um piso relativo sem medição do outro lado seria ficção
([ADR-0013](../architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).

### NFR-8 em detalhe

Segurança precede performance
([ADR-0011](../architecture/decisions/0011-seguranca-antes-de-performance.md)).
Uma regra de prioridade não tem orçamento numérico, então ela vale por três
verificações, e não por declaração:

1. **Os números de NFR-1 a NFR-3 são medidos sobre o build padrão de release,
   com todo controle de segurança ativo.** Medir outro artefato é medir outro
   programa e reportar o número dele.
2. **Controle de segurança que torne um orçamento inalcançável move o
   orçamento**, com o número medido que motivou registrado junto.
3. **Código que baixa artefato de terceiro verifica o digest antes de
   executar**, com o esperado fixado em arquivo versionado.

No CI a precedência é literal: o job `perf` declara `needs: [supply-chain]`, de
modo que o resultado de performance não é sequer produzido enquanto a política
de dependências não passa. Custa a latência do `cargo deny` no retorno de perf —
a consequência negativa está declarada no ADR.

## Restrições

- **Stack:** Rust edition 2024, `rust-version` 1.96, workspace cargo com seis crates.
- **Segurança de linguagem:** `unsafe_code = "forbid"`; `unwrap_used`,
  `expect_used`, `panic` e `todo` são `deny` de clippy em caminho de produção.
- **Proveniência:** o código-fonte vazado do Claude Code e derivados estão
  proibidos como referência, para qualquer contribuidor, humano ou agente.
  Referências permitidas e suas atribuições estão no [`NOTICE`](../../NOTICE).
- **Compliance:** `subscription-oauth` fora do build padrão, verificado no CI
  ([ADR-0001](../architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md)).

## Critérios de aceite

- Um desenvolvedor instala o binário, roda `nycode` num repositório e completa
  uma tarefa real de codificação sem editar arquivo de configuração.
- O harness de paridade roda o mesmo prompt no `nycode` e na referência contra o
  mesmo gateway e não acusa divergência em sequência de tool calls, estado final
  dos arquivos, contabilidade de tokens, `stop_reason` ou envelope de erro.
- Os gates de NFR-1, NFR-2, NFR-3 e NFR-5 passam no CI.
- Nenhum marcador `[NEEDS CLARIFICATION]` permanece.

## Glossário

Ver o [glossário da arquitetura](../architecture/ARCHITECTURE.md#12-glossário).
