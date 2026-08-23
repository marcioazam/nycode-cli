# Matriz de conformidade

> Estado de migração. Este arquivo registra o alvo SOTA-2026 v1.4.0 e não
> transforma lacunas em conformidade declarada. O pin vigente continua sendo o
> declarado em `AGENTS.md` até que cada MUST tenha instrumento ou waiver válido.

Fonte normativa: `base-software-rules/standard/HARNESS.md`, pin alvo v1.4.0.
Os textos dos pilares não são copiados aqui. Os números continuam somente em
`standard/GATES.md` da fonte.

Estados durante a migração:

- `instrumentado`: o entry point único falhou deliberadamente e a evidência foi
  registrada.
- `waiver`: existe ADR com regra, escopo, razão, controle compensatório, owner e
  expiração.
- `pendente`: ainda não pode ser apresentado como conformidade.
- `não se aplica`: somente quando o perfil ou pré-requisito realmente não se
  aplica.

Perfis alvo: Núcleo, Autoria por agente e Produto agente. Regulado não se aplica
ao nível L2 atual.

| FR | Perfil | IDs | Estado | Evidência |
|---|---|---|---|---|
| FR-1 | Núcleo | `CI-03` | pendente | CI ainda reimplementa `ci-local.sh` |
| FR-2 | Núcleo | `CI-04` | pendente | confirmar falha deliberada no entry point único |
| FR-3 | Núcleo | `GATE-14`, `CI-10` | pendente | expiração de waiver ainda não é lida pela pipeline |
| FR-4 | Núcleo | processo de waiver | pendente | ADRs existentes precisam dos seis campos |
| FR-5 | Núcleo | `GATE-01`..`GATE-03`, `CI-06` | pendente | gates existem; falta prova pelo entry point único |
| FR-6 | Núcleo | `GATE-04`, `CI-07` | pendente | mutation sem ratchet/classificação completos |
| FR-7 | Núcleo | `SEC-11` | pendente | lint de descarte de erro ainda não fecha |
| FR-8 | Núcleo | `SDD-13`, `ADV-05` | pendente | auditoria de asserts ainda não é gate |
| FR-9 | Núcleo | `CI-14`, `GATE-14` | pendente | quarentena de flakes ainda não existe |
| FR-10 | Núcleo | `GATE-13`, `AI-11`, `SEC-09` | pendente | vetting precisa ser ligado ao entry point |
| FR-11 | Núcleo | `GATE-10` | pendente | scanner de artefato ainda ausente |
| FR-12 | Núcleo | `GATE-12` | pendente | secret scan existente precisa de prova completa |
| FR-13 | Núcleo | `GATE-15` | pendente | fronteira atual cobre crates, não todos os slices |
| FR-14 | Núcleo | `GATE-05`..`GATE-09` | pendente | thresholds e ratchets divergem da v1.4.0 |
| FR-15 | Núcleo | `CI-05` | pendente | estado remoto precisa ser consultado novamente |
| FR-16 | Núcleo | `CI-11`, `SP-06` | instrumentado | actions versionadas por SHA em `.github/workflows/` |
| FR-17 | Núcleo | `CI-16` | pendente | contratos publicados precisam de inventário |
| FR-18 | Núcleo | `SDD-17` | pendente | invariantes gerados ainda não estão no fluxo de mudança |
| FR-19 | Autoria por agente | `GATE-11`, `AI-01` | instrumentado | `scripts/agent-pr-size-gate.sh` no CI |
| FR-20 | Autoria por agente | `AI-07`..`AI-09` | pendente | trailer precisa ser verificado no entry point |
| FR-21 | Autoria por agente | `AI-03` | pendente | revisão independente precisa ser provada |
| FR-22 | Autoria por agente | `AI-06` | pendente | policy-as-code de agentes ainda não fecha |
| FR-23 | Autoria por agente | `AI-10` | instrumentado | `test_map` gerado e verificado pelo CI |
| FR-24 | Autoria por agente | `AI-13`..`AI-15` | pendente | métricas por origem ainda não publicadas |
| FR-25 | Autoria por agente | `AI-12`, `SDD-16` | pendente | protocolo de conclusão precisa usar `verify-all` |
| FR-26 | Autoria por agente | `GATE-17`, `AI-02` | pendente | owner único não satisfaz autoaprovação |
| FR-27 | Produto agente | `AGT-01` | pendente | proteção de prompt em implementação |
| FR-28 | Produto agente | `AGT-02` | instrumentado | ferramenta não concedida é recusada pelo gate |
| FR-29 | Produto agente | `AGT-03` | pendente | pin inicial MCP e schema permissivo precisam endurecer |
| FR-30 | Produto agente | `AGT-04` | pendente | shell ainda aceita string de comando |
| FR-31 | Produto agente | `AGT-05` | pendente | aprovação ainda não tem nonce/expiração/recibo |
| FR-32 | Produto agente | `AGT-06` | pendente | credenciais e retenção de sessão precisam política formal |
| FR-33 | Produto agente | `AGT-07` | pendente | memória ainda não tem escopo/TTL verificáveis |
| FR-34 | Produto agente | `AGT-08` | pendente | mensagens entre agentes ainda não têm envelope autenticado |
| FR-35 | Núcleo | `GATE-16` | waiver | ADR-0033; renovar com owner e controle compensatório explícitos |

A migração somente poderá atualizar a declaração pública para v1.4.0 quando
`pendente` não existir mais e os waivers estiverem dentro da validade.
