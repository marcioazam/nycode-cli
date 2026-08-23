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
| [0018](0018-a-contencao-de-caminho-e-imposta-na-abertura.md) | A contenção de caminho é imposta na abertura, não na validação | aceito | 2026-08-13 |
| [0019](0019-a-busca-usa-o-motor-do-ripgrep-como-biblioteca.md) | A busca usa o motor do ripgrep como biblioteca, e o `.gitignore` decide o que é derivado | aceito | 2026-08-13 |
| [0020](0020-o-despacho-de-ferramentas-e-sequencial.md) | O despacho de ferramentas é sequencial, divergindo da referência | aceito | 2026-08-13 |
| [0021](0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md) | Terminar um processo é sinalizar o grupo, não o líder | aceito | 2026-08-13 |
| [0022](0022-o-post-tool-use-recebe-a-saida-cortada-e-o-tamanho-dela.md) | O `post-tool-use` recebe a saída cortada e o tamanho dela | aceito | 2026-08-13 |
| [0023](0023-o-registro-de-filhos-destacados-morre-com-o-processo.md) | O registro de filhos destacados morre com o processo | aceito | 2026-08-13 |
| [0024](0024-o-grupo-morre-quando-o-lider-sai-nao-quando-o-cano-cala.md) | O grupo morre quando o líder sai, não quando o cano cala | aceito | 2026-08-13 |
| [0025](0025-o-nivel-de-raciocinio-e-um-conceito-do-harness.md) | O nível de raciocínio é um conceito do harness, e o dialeto traduz | aceito | 2026-08-13 |
| [0026](0026-o-preco-vem-do-catalogo-descoberto.md) | O preço vem do catálogo descoberto, e o custo é calculado no cliente | aceito | 2026-08-13 |
| [0027](0027-a-compactacao-dispara-por-limiar-e-o-erro-e-a-rede.md) | A compactação dispara por limiar, e o erro passa a ser a rede de segurança | aceito | 2026-08-13 |
| [0028](0028-o-consentimento-fixa-a-definicao-declarada.md) | O consentimento fixa a definição declarada, e não só o que é executado | aceito | 2026-08-13 |
| [0029](0029-a-integracao-com-editor-fala-acp.md) | A integração com editor fala ACP, e não um protocolo próprio | aceito | 2026-08-13 |
| [0030](0030-toda-action-de-terceiro-e-fixada-por-sha-verificado.md) | Toda action de terceiro é fixada por SHA verificado, com carência de sete dias | aceito | 2026-08-14 |
| [0031](0031-o-piso-relativo-de-chegada-do-processo-absorve-a-variancia-do-runner-do-ci.md) | O piso relativo de "chegada do processo" absorve a variância do runner do CI | aceito | 2026-08-14 |
| [0032](0032-adota-padrao-externo-sota-2026-nivel-l2.md) | Adota o padrão externo SOTA-2026 (base-software-rules) no nível L2 | aceito | 2026-08-14 |
| [0033](0033-gate-16-fica-sem-instrumento-conflito-com-hook-e-squash-merge.md) | GATE-16 (trilha test-first) fica sem instrumento — conflita com o hook de commit e com squash-merge | aceito | 2026-08-14 |
| [0034](0034-protecao-de-branch-exige-ci-verde-sem-aprovacao-separada.md) | Proteção de branch em `main` exige CI verde, sem aprovação humana separada | aceito | 2026-08-14 |
| [0035](0035-a-referencia-de-paridade-e-apontada-por-models-json.md) | A referência de paridade é apontada por `models.json` num diretório efêmero | aceito | 2026-08-16 |
| [0036](0036-gate-17-fica-em-waiver-enquanto-o-dono-humano-for-unico.md) | GATE-17 fica em waiver enquanto o dono humano for único | aceito | 2026-08-17 |
| [0037](0037-o-contrato-do-agente-tem-orcamento-de-bytes-e-de-linhas.md) | O contrato do agente tem orçamento de bytes e de linhas | aceito | 2026-08-17 |
| [0038](0038-proibicao-do-agente-e-mecanica-e-portatil.md) | A proibição do agente é mecânica e portátil | aceito | 2026-08-17 |

Os ADRs [0005](0005-sandbox-de-so-por-processo-auxiliar.md),
[0009](0009-hooks-sao-executaveis-com-contrato-json.md) e
[0021](0021-terminar-e-sinalizar-o-grupo-nao-o-lider.md) receberam emenda em
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
