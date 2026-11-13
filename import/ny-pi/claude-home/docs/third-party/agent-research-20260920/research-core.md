# Pesquisa principal — decisões anteriores à aplicação

As dez páginas REST, dez itens por página, contêm 100 repositórios distintos.
HTML 1–9 retornou apenas o shell de busca; HTML 10 retornou 429. A API preserva
`q=agents`, `sort=stars`, `order=desc`; não alegamos navegação visual do ranking.
A triagem usa READMEs capturados, não estrelas como medida de qualidade.

## Fontes fixas e adaptação

As revisões, URLs, SHA de blob Git e SHA-256 de 63 arquivos de conteúdo/licença
estão em source-manifest.json. Coleções principais: ECC, Agency Agents,
wshobson/agents e Awesome Copilot, todas com LICENSE MIT capturada. A síntese
local é seletiva e original; as licenças completas permanecem junto às fontes.
Nenhum runtime, hook ou instalador upstream foi executado.

| Fonte ECC (`sources/affaan-m__ECC/agents/`) | Aproveitamento / proprietário |
| --- | --- |
| architect | Contexto atual, fluxo de dados, alternativas e consequências → architecture_reviewer; rejeitar escalas numéricas genéricas e arquitetura prescrita. |
| code-explorer | Entrada→transformação→falha→saída com fronteiras async → code_mapper; manter grafo e evidência de cobertura locais. |
| code-reviewer | Linha, gatilho, consequência e checagem de guards antes do achado → code_reviewer. Consolidar causas iguais. Sem nota arbitrária de 80% de confiança, revisão obrigatória universal ou critérios menos estritos de tamanho. |
| database-reviewer | Plano/cardinalidade/pool/lock → performance_reviewer; coexistência/rollback → contract_migration_reviewer; RLS/autorização → security_reviewer. Rejeitar EXPLAIN ANALYZE automático em produção, índice sempre obrigatório e ganho de 10x sem medição. |
| doc-updater | Documentos derivados do código, links/exemplos/callers atualizados → docs-architect; sem gerar codemap paralelo indiscriminadamente. |
| docs-lookup | Resolver versão e citar documentação realmente obtida → research_scout; ferramenta disponível, sem dependência obrigatória de Context7. |
| e2e-runner | Jornadas críticas, waits por condição, isolamento e traces → test-author; rejeitar install global, quarantine/skip para passar e repetição universal. |
| fastapi-reviewer | Ownership de sessão/dependency, resposta sem campos internos e overrides reais nos testes → fastapi-pro. |
| flutter-reviewer | Ciclo de vida, dispose/cancel, estado explícito, keys, convenção existente → flutter-expert; sem impor nova biblioteca ou severidade mecânica. |
| go-reviewer / rust-reviewer | Cancelamento, concorrência, erros, bounded channels, invariantes unsafe → gateway-engineer; estilo/review continuam no proprietário existente. Sem reviewers adicionais por linguagem. |
| harness-optimizer / agent-evaluator | Casos ligados a requisitos e evidência independente → agent_systems_auditor. Rejeitar auto-score como prova, rollback que sobrescreve terceiros, SHIP IT, aprovação genérica adicional, hooks automáticos e loops de otimização. |
| mle-reviewer | Separação temporal/por entidade, leakage, skew treino/serving, artefato e rollback → mlops-engineer; dados de ingestão continuam em data-engineer. |
| performance-optimizer | Perfil antes de recomendação, carga e baseline comparáveis → performance_reviewer / web_performance_auditor conforme superfície. Rejeitar lazy-load de imagem LCP, números universais e memoização sem causa medida. |
| pr-test-analyzer / tdd-guide | Assertions observáveis, boundary/failure e testes que pegam implementação errada → test_reviewer / test-author. Não repetir skills de TDD nem exigir testes para toda alteração cosmética. |
| security-reviewer | Caminho de abuso contextualizado, authz/SSRF/deserialização/webhook → security_reviewer; nenhuma rotação automática ou coleta de secrets. |
| silent-failure-hunter | Erro distinguível de vazio, fallback e perda de cancelamento → reliability_reviewer; unificar no proprietário já existente. |
| seo-specialist | Robots/canonical/redirect/sitemap/schema → novo technical_seo_reviewer, por falta de proprietário nativo de auditoria de crawl/indexação. CWV permanece em web_performance_auditor. |

Opencode `explore.txt` corrobora escopo de busca orientado pela profundidade
solicitada; já coberto pelo code_mapper. Não importar sua referência contraditória
a comandos de copiar/mover num papel somente leitura.

LangGraph README apresenta persistência/retomada e inspeção de estado; tratado
como descrição de capacidade, sem prova de implementação do runtime local.
AutoGen tutorial termination (CC-BY-4.0 para documentação; LICENSE-CODE MIT para
código) demonstra limite de mensagem/token/tempo e sinais de término compostos.
A auditoria local deve separar parada por limite de sucesso e verificar retomada;
nenhum código ou texto do tutorial é incorporado. Regras de memória do usuário
continuam válidas. CrewAI foi triado como framework; nenhuma instalação necessária.

## Mapa local e não redundância

Os 20 papéis atuais permanecem úteis em engenharia e aplicações: falta de uso
recente não prova que FastAPI, Flutter ou MLOps estejam fora da área do usuário.
Todos receberão contratos concretos; modelos, effort e sandbox serão preservados.

Consolidar responsabilidades, sem aliases adicionais: review geral faz integração;
especialistas fazem uma dimensão profunda sob gatilho. UX retira performance;
web performance possui CWV; runtime performance possui CPU/DB/concorrência;
security possui exploração de trust boundary, agent systems possui fidelidade
de contrato/eval/custo. Migrations revisa coexistência; data implementa ingestão;
MLOps possui treinamento/serving. Documentação escreve, research verifica fontes.

Novos: `gateway-engineer` (Go/Rust e protocolos), `web-platform-engineer`
(Astro/TS e Worker app), `technical-seo-reviewer` (auditoria técnica de busca).
Cada novo papel tem superfície e saída distintas de reviewers, Terraform e dados.
Não adicionar persona geral backend/frontend, browser tester, silent failure hunter,
SQL optimizer, language reviewer, planner ou orchestrator: já há proprietário.

Contrato compartilhado em docs/agent-contract.md evita repetir limites em cada
prompt. Agent routing será tabela de responsabilidade, não segundo catálogo de
prompts. Inventário estrito continua rejeitando ausências, extras e nomes duplicados.
Testes adicionais locais confirmarão metadados e restrições sem mudar os gates.
