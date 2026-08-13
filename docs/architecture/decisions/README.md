# Architecture Decision Records

Registro cronológico das decisões significativas do NyCode CLI. Uma decisão que
custa caro reverter, que fecha uma alternativa razoável, ou que alguém vai
questionar em seis meses, vira um ADR — para que a discussão aconteça uma vez só.

| ADR | Título | Status | Data |
|---|---|---|---|
| [0001](0001-subscription-oauth-is-a-flagged-accepted-risk.md) | OAuth de assinatura é um risco aceito, atrás de flag e desligado por padrão | aceito | 2026-08-13 |
| [0002](0002-extensions-are-out-of-process.md) | Extensões são out-of-process, sem runtime JavaScript embutido | aceito | 2026-08-13 |
| [0003](0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md) | Pisos de cobertura: 95% agregado e 90% por arquivo de produção | aceito | 2026-08-13 |
| [0004](0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md) | O cliente MCP usa o SDK oficial `rmcp`, não um JSON-RPC próprio | aceito | 2026-08-13 |
| [0005](0005-sandbox-de-so-por-processo-auxiliar.md) | O confinamento do shell é do sistema operacional, aplicado no processo filho | aceito | 2026-08-13 |
| [0006](0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md) | A sessão é uma árvore gravada no mesmo arquivo append-only | aceito | 2026-08-13 |
| [0007](0007-subagentes-sao-in-process-divergindo-da-referencia.md) | Subagentes existem e são in-process, divergindo da referência | aceito | 2026-08-13 |
| [0008](0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md) | A TUI mantém o renderizador próprio sobre o scrollback, sem alt-screen | aceito | 2026-08-13 |
| [0009](0009-hooks-sao-executaveis-com-contrato-json.md) | Hooks são executáveis com contrato JSON e podem vetar uma chamada | aceito | 2026-08-13 |
| [0010](0010-o-gate-de-cobertura-exige-relatorio-completo-e-fresco.md) | O gate de cobertura exige relatório completo e fresco | aceito | 2026-08-13 |
| [0011](0011-seguranca-antes-de-performance.md) | Segurança precede performance quando as duas se opõem | aceito | 2026-08-13 |
| [0012](0012-performance-e-medida-contra-um-concorrente-nomeado.md) | Performance é medida contra um concorrente nomeado, com dois pisos | aceito | 2026-08-13 |
| [0013](0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md) | O gate de performance mede a sessão montada, e o `--version` vira a métrica comparável | aceito | 2026-08-13 |
| [0014](0014-prazos-de-rede-do-cliente-de-wire.md) | Prazos de rede do cliente de wire são de ociosidade, não de duração | aceito | 2026-08-13 |
| [0015](0015-o-cancelamento-e-por-turno.md) | O cancelamento é por turno, e cancelar termina o processo | aceito | 2026-08-13 |
| [0016](0016-extensao-do-workspace-exige-consentimento.md) | Uma extensão declarada pelo workspace exige consentimento registrado antes da primeira execução | aceito | 2026-08-13 |
| [0017](0017-duas-politicas-de-confinamento.md) | O confinamento tem duas políticas, e quem invoca escolhe qual | aceito | 2026-08-13 |

Os ADRs [0005](0005-sandbox-de-so-por-processo-auxiliar.md) e
[0009](0009-hooks-sao-executaveis-com-contrato-json.md) receberam emenda em
2026-08-13, depois de uma auditoria encontrar restrições declaradas neles sem
correspondência no código. Cada um traz a seção `Emenda` no fim, dizendo o que
subiu até o documento e o que desceu até o código.

> **Sobre os números 0011 a 0017.** Três arquivos reivindicaram o 0011 e três o
> 0012, resultado de trabalhos paralelos que escolheram "o próximo número" ao
> mesmo tempo. A disputa foi resolvida dando 0011 e 0012 ao par
> segurança/performance, porque o 0013 já citava esse 0012 e reapontá-lo
> custaria mais do que deslocar os outros; extensão e confinamento desceram para
> 0016 e 0017, com as citações corrigidas nos dois sentidos. Quem procurar um
> "ADR-0011" citado antes de 2026-08-13 num documento externo pode estar
> procurando o 0016.

## Como adicionar

Copiar [`ADR_TEMPLATE.md`](ADR_TEMPLATE.md) para `NNNN-titulo-curto.md`,
incrementando `NNNN`, e acrescentar a linha na tabela acima. Um ADR não é um
relatório do que foi feito: ele registra a alternativa descartada e o que faria
a decisão ser revista.
