# Índice de documentação — NyCode CLI

Desenvolvimento guiado por spec: o documento é a fonte de verdade, o código segue
o documento. Uma divergência entre os dois é um defeito de um dos lados, nunca
uma diferença tolerada.

## Mapa

| Documento | Papel |
|---|---|
| [`.specs/nycode-rs/spec.md`](../.specs/nycode-rs/spec.md) | WHAT e WHY: problema, objetivo, FR-1..20, NFR-1..7, non-goals, critérios de aceite |
| [`.specs/nycode-rs/research.md`](../.specs/nycode-rs/research.md) | RECON que fundamentou a decisão de portar |
| [`.specs/nycode-rs/research-sota-2026.md`](../.specs/nycode-rs/research-sota-2026.md) | RECON que fundamenta a emenda de escopo de 2026-08-13 |
| [`.specs/nycode-rs/research-paridade-2026.md`](../.specs/nycode-rs/research-paridade-2026.md) | RECON que fundamenta a spec 002 e a emenda de escopo de integração com editor |
| [`sources/`](../sources/README.md) | Material bruto das pesquisas, com as passagens efetivamente usadas |
| [`PRD.md`](../PRD.md) | Produto: usuários, métricas de sucesso, estado de entrega por requisito |
| [`requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md) | Requisitos consolidados, com os invariantes travados no CI |
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | Estrutura em crates, fluxo de execução, conceitos transversais |
| [`architecture/decisions/`](architecture/decisions/README.md) | ADRs: decisões significativas e o porquê delas |
| [`product/ROADMAP.md`](product/ROADMAP.md) | Ondas de trabalho: agora, próximo, depois |
| [`specs/SPEC_TEMPLATE.md`](specs/SPEC_TEMPLATE.md) | Modelo para a spec de uma feature nova |
| [`specs/001-fronteira-de-confianca/`](specs/001-fronteira-de-confianca/spec.md) | Fronteira de confiança do agente: consentimento de extensão, confinamento e contenção de caminho |
| [`specs/002-paridade-e-sota-2026/`](specs/002-paridade-e-sota-2026/spec.md) | Paridade com a referência e elevação a SOTA 2026: o inventário de sessenta deltas, triado, com o que se adota, o que se recusa e o que fica adiado |
| [`specs/003-sota-2026-dev-harness/`](specs/003-sota-2026-dev-harness/spec.md) | Harness SOTA-2026 portátil: FRs, perfis e matriz de conformidade deste repositório |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Histórico de mudanças |
| [`../README.md`](../README.md) | Porta de entrada: instalação, uso, números medidos |
| [`../NOTICE`](../NOTICE) | Atribuições de terceiros e aviso de risco |
| [`../CLAUDE.md`](../CLAUDE.md) | Ponte para `AGENTS.md`, sem conteúdo normativo próprio |
| [`../SECURITY.md`](../SECURITY.md) | Como reportar vulnerabilidade, escopo, riscos já aceitos |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Fluxo mecânico de contribuição; regras vivem no `AGENTS.md` |
| [`../.github/CODEOWNERS`](../.github/CODEOWNERS) | Caminhos críticos com dono nomeado |
| [`../test_map`](../test_map) | Inventário por crate de onde os testes vivem (`AI-10`); gerado, nunca editado à mão |
| [`GLOSSARY.md`](GLOSSARY.md) | Linguagem ubíqua — os termos, com o mesmo significado no código e nos ADRs |
| [`business-rules.md`](business-rules.md) | Regras que atravessam requisitos individuais (`BR-N`) — segurança-antes-de-performance, proveniência, o que nunca degrada em silêncio |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Ativos, fronteiras de confiança, ameaças e mitigação — vista de alto nível sobre o [checklist de segurança](specs/001-fronteira-de-confianca/checklists/security.md) |
| [`RUNBOOK.md`](RUNBOOK.md) | Detecção, confirmação, mitigação e escalonamento dos três modos de falha mais prováveis |
| [`ONBOARDING.md`](ONBOARDING.md) | Do clone ao primeiro teste passando |
| [`SLO.md`](SLO.md) | Os indicadores de nível deste CLI (não há serviço no ar, então não há burn-rate) |
| [`CONVENTIONS.md`](CONVENTIONS.md) | Nomenclatura e organização de arquivo/pasta/documento já praticadas, escritas em vez de tribal |

A spec de produto vive em `.specs/nycode-rs/`. Specs de feature e o harness SOTA-2026 ficam em `docs/specs/`. Os ADRs da spec de produto a referenciam por caminho relativo; mover esse arquivo quebraria esses links.

## Onde cada coisa é decidida

- **O que o produto faz e para quem** — `PRD.md` e a seção de requisitos da spec.
- **Como é construído** — `ARCHITECTURE.md`.
- **Por que foi construído assim** — um ADR. Uma escolha significativa que não
  tem ADR é uma escolha que ninguém poderá revisar depois.
- **Se está pronto** — os gates de CI, não a opinião de quem escreveu. E o
  critério é o caminho de produção executar o código, não ele existir: três
  requisitos estiveram marcados como entregues por módulos implementados,
  testados e nunca chamados pelo binário. Cobertura alta não distingue os dois
  casos, porque o teste chama o que a produção não chama.

## Invariantes travados no CI

Não são aspirações; o build quebra quando qualquer um deles regride.

| Invariante | Piso | Onde |
|---|---|---|
| Cobertura agregada de produção | 95% | [`scripts/coverage-gate.sh`](../scripts/coverage-gate.sh) |
| Dependências sem aviso de segurança nem licença incompatível | obrigatório | [`deny.toml`](../deny.toml), job `supply-chain` |
| Cobertura por arquivo de produção | 90% | [`scripts/coverage-gate.sh`](../scripts/coverage-gate.sh) |
| Relatório de cobertura completo e mais novo que o código | obrigatório | [`scripts/coverage-gate.sh`](../scripts/coverage-gate.sh) |
| O gate de cobertura continua capaz de reprovar | obrigatório | [`scripts/coverage-gate-test.sh`](../scripts/coverage-gate-test.sh) |
| Teto de 500 linhas por arquivo, com ratchet para o legado (`GATE-07`/`RAT-04`) | 500, ou o baseline registrado | [`scripts/file-length-gate.sh`](../scripts/file-length-gate.sh) |
| O gate de tamanho de arquivo continua capaz de reprovar | obrigatório | [`scripts/file-length-gate-test.sh`](../scripts/file-length-gate-test.sh) |
| Teto de PR assistido por IA (`GATE-11`/`AI-01`), só no job `pr-size` do CI | 400 linhas / 15 arquivos | [`scripts/agent-pr-size-gate.sh`](../scripts/agent-pr-size-gate.sh) |
| Idade mínima de dependência nova (`SP-04`), só no job `pr-size` do CI | 30 dias | [`scripts/dependency-age-gate.sh`](../scripts/dependency-age-gate.sh) |
| Cobertura de diff (`GATE-01`), só no job `coverage` em PR | 80% | [`scripts/diff-coverage-gate.sh`](../scripts/diff-coverage-gate.sh) |
| Nenhum mutante sobrevivente nas linhas tocadas (`GATE-04`), só no job `mutation` em PR | 0 mutantes | [`scripts/mutation-gate.sh`](../scripts/mutation-gate.sh) |
| [`test_map`](../test_map) em dia (`AI-10`) | obrigatório | [`scripts/gen-test-map.sh --check`](../scripts/gen-test-map.sh) |
| Grafo de dependência entre crates bate com a allowlist (`GATE-15`) | 0 arestas não declaradas | [`scripts/architecture-boundary-gate.sh`](../scripts/architecture-boundary-gate.sh) |
| Complexidade cognitiva/ciclomática por função, com ratchet (`GATE-05`/`GATE-06`) | 15 / 15, ou o baseline registrado | [`scripts/complexity-gate.sh`](../scripts/complexity-gate.sh) |
| Duplicação de código (`GATE-08`) | 5% de linhas | [`scripts/duplication-gate.sh`](../scripts/duplication-gate.sh) |
| Startup da sessão montada (NFR-1) | 15.000 µs | [`scripts/perf-gate.sh`](../scripts/perf-gate.sh) |
| Startup de chegada do processo (NFR-1) | 3.000 µs, ou baseline ÷ 3 | [`scripts/perf-gate.sh`](../scripts/perf-gate.sh) |
| Memória de sessão ociosa (NFR-2) | 14 MiB | [`scripts/perf-gate.sh`](../scripts/perf-gate.sh) |
| Memória na chegada (NFR-2) | 8 MiB, ou baseline ÷ 2 | [`scripts/perf-gate.sh`](../scripts/perf-gate.sh) |
| Binário auto-contido (NFR-3) | 16 MiB, ou baseline ÷ 5 | [`scripts/perf-gate.sh`](../scripts/perf-gate.sh) |
| O gate de performance continua capaz de reprovar | obrigatório | [`scripts/perf-gate-test.sh`](../scripts/perf-gate-test.sh) |
| Performance não é medida antes de a política de dependências passar (NFR-8) | obrigatório | `needs: [supply-chain]` no job `perf` do [`ci.yml`](../.github/workflows/ci.yml) |
| O artefato do concorrente tem digest fixado antes de ser executado (NFR-8) | obrigatório | [`perf-baseline.yml`](../.github/workflows/perf-baseline.yml) |
| `subscription-oauth` fora do build padrão | obrigatório | [`ci.yml`](../.github/workflows/ci.yml) |
| O harness de paridade continua capaz de acusar divergência | obrigatório | [`scripts/parity-gate.sh`](../scripts/parity-gate.sh), job `parity` |
| A imagem de container builda, passa no `hadolint` e roda (`--version`) | obrigatório | [`Dockerfile`](../Dockerfile), job `docker` |

Cada métrica de performance tem dois pisos e vale o mais apertado dos dois: um
absoluto, perto do valor medido, que pega regressão nossa; e um relativo ao
[baseline do concorrente](../scripts/perf-baseline.txt), que pega o mercado
passando na frente ([ADR-0012](architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)).
A carga da sessão montada só tem piso absoluto, porque não há sonda equivalente
do outro lado para comparar
([ADR-0013](architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).

A comparação de paridade completa precisa de um gateway e do harness de
referência. Quando eles não estão configurados, o job diz isso em voz alta e o
que continua travado é que o próprio harness ainda detecta divergência — um
harness que não pode falhar é pior que nenhum.

## Ciclo de trabalho

Spec antes de código. Para uma feature nova: escrever a spec a partir do
[modelo](specs/SPEC_TEMPLATE.md), registrar as decisões significativas como ADR,
implementar com o teste que falha primeiro, e só então atualizar o
[`CHANGELOG.md`](../CHANGELOG.md).
