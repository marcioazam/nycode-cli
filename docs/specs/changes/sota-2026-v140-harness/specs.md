# Delta — SOTA-2026 v1.4.0 harness

Fonte: [ADR-0032](../../../architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md) e a seção de padrão externo do `AGENTS.md` (pin v1.1.0, sem perfis).

## ADDED

- REQ-H-001: O repositório declara em `README.md` e `AGENTS.md` o pin SOTA-2026 v1.4.0, o nível L2 e os perfis Núcleo, Autoria por agente e Produto agente, com matriz em `docs/CONFORMANCE-MATRIX.md`.
- REQ-H-002: Cada FR dos perfis declarados na matriz é `instrumentado`, `waiver` (ADR com os seis campos) ou `não se aplica`. Ausência dos três torna falsa qualquer reivindicação de “100% SOTA-2026”. `pendente` é status honesto e impede a reivindicação.
- REQ-H-003: O contrato de agente cabe bem abaixo de `OB-05`; pontes importam `AGENTS.md`; deny vive no cliente (Cursor, Claude Code) e a prova `AI-04` é a recusa do cliente, não a prosa.
- REQ-H-004: Trabalho não trivial começa por Issue de intake; aceite vive no arquivo de spec; sub-issue só quando a tarefa tem ciclo de vida próprio; um comentário de progresso canônico por item.
- REQ-H-005: `GATE-14` recusa waiver ou quarentena de flake com data passada, campo faltando ou ADR órfão.
- REQ-H-006: Ciclomática por função usa o teto de `GATE-06` do padrão; o que já excedia entra no ratchet, não num teto local mais frouxo.
- REQ-H-007: Commit assistido leva `Assisted-by`; o pipeline recusa sign-off de máquina e `Co-Authored-By` de modelo.
- REQ-H-008: Artefato Docker/release recusa HIGH/CRITICAL sem VEX+expiração (`GATE-10`).
- REQ-H-009: Produção não descarta `Result`/`must_use` sem razão revista (`SEC-11`).
- REQ-H-010: Conteúdo de ferramenta apresentado ao modelo é dado, não instrução (`AGT-01`).
- REQ-H-011: Schema de ferramenta apresentado ao modelo é pinado por hash; execução contra schema mutado falha fechado (`AGT-03`).
- REQ-H-012: Fila de merge GitHub é `não se aplica` enquanto o repositório for de conta pessoal; o substituto são os 12 checks + `strict`. O trigger `merge_group` permanece.

## MODIFIED

- Pin v1.1.0 no README/`AGENTS.md` → v1.4.0 com perfis.
  Reason: o padrão subiu; VERSIONING.md exige pin deliberado no mesmo PR do trabalho de conformidade.
- `MAX_CYCLOMATIC=15` em `scripts/complexity-gate.sh` → teto de `GATE-06`.
  Reason: teto local mais frouxo é waiver silencioso, proibido por FR-14.
- Jobs `pr-size` e `mutation` só em `pull_request` → também em `merge_group`.
  Reason: se a fila existir no futuro, check obrigatório que não reporta nela é configuração incompleta.

## REMOVED

- A reivindicação implícita de que `GATE-06` e `GATE-17` estavam “satisfeitos” só por existirem scripts/ADR-0034.
  Reason: GATE-06 estava afrouxado; GATE-17 por auto-aprovação é teatro.
  Migration: ADR-0037 (waiver GATE-17); teto ciclomático alinhado + ratchet.

## Aprovação (SDD-02)

- Aprovador: @marcioazam
- Data: 2026-08-18
- Evidência: escolha `two_wave` e pedido de implementação do plano “Harness SOTA duas ondas”. REQ-H-001 a REQ-H-012.
