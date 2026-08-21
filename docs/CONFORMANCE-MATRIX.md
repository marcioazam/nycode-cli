# Conformance matrix

Pin: SOTA-2026 **v1.4.0**. Status: `instrumentado` | `waiver` | `não se aplica`.
`instrumentado` = check no entry point `CI-03` (`scripts/verify-all` →
`scripts/ci-local.sh`) visto falhar de propósito. `waiver` aponta ADR com os
seis campos. Não copiar pilares; não restatar tetos.

Declarado no `README.md`:

- Level: L2
- Profiles: Núcleo, Autoria por agente, Produto agente
- Regulado: não

Issue de rastreio: [#70](https://github.com/marcioazam/nycode-cli/issues/70).
Esta matriz **não** autoriza a frase “100% SOTA-2026” enquanto houver `waiver`
em data — waiver honesto não é omissão, mas também não é 100% instrumentado.

| FR | Profile | Rule IDs | Status | Evidence |
|---|---|---|---|---|
| FR-1 | Núcleo | `CI-03` | instrumentado | `scripts/verify-all` → `ci-local.sh`; auto-teste `ci-local-test.sh` |
| FR-2 | Núcleo | `CI-04` | instrumentado | 12 checks obrigatórios, ADR-0034 |
| FR-3 | Núcleo | `GATE-14`, `CI-10` | instrumentado | `scripts/waiver/gate.sh` |
| FR-4 | Núcleo | waiver process | instrumentado | ADRs 0033, 0037, 0038, 0039 + registro |
| FR-5 | Núcleo | `GATE-01`–`03`, `CI-06` | instrumentado | `coverage-gate.sh`, `diff-coverage-gate.sh` (PR) |
| FR-6 | Núcleo | `GATE-04`, `CI-07` | instrumentado | `mutation-gate.sh`: 0 sobreviventes no diff (mais estrito que 80% por crate; sem `RAT-01` de pacote) |
| FR-7 | Núcleo | `SEC-11` | instrumentado | rustc `unused_must_use` deny; `let _ =` em Result ainda existe e fica para PR própria |
| FR-8 | Núcleo | `SDD-13`, `ADV-05` | instrumentado | `scripts/vacuous-assert/gate.sh` (diff); auto-teste `gate-test.sh` |
| FR-9 | Núcleo | `CI-14`, `GATE-14` | instrumentado | `scripts/flake-quarantine.txt` lido por `scripts/waiver/gate.sh`; vazio = zero quarentenas |
| FR-10 | Núcleo | `GATE-13`, `AI-11`, `SEC-09` | instrumentado | `cargo deny`, `dependency-age-gate.sh` |
| FR-11 | Núcleo | `GATE-10` | instrumentado | `scripts/artifact/gate.sh` (Trivy) |
| FR-12 | Núcleo | `GATE-12` | instrumentado | gitleaks em `--fast` |
| FR-13 | Núcleo | `GATE-15` | instrumentado | `architecture-boundary-gate.sh` |
| FR-14 | Núcleo | `GATE-05`–`09` | instrumentado | complexity 15/10 + ratchet; duplication; file-length; perf-gate |
| FR-15 | Núcleo | `CI-05` | instrumentado | branch protection `strict`; `enforce_admins` off (documentado); fila N/A (conta pessoal) |
| FR-16 | Núcleo | `CI-11`, `SP-06` | instrumentado | pinact, ADR-0030 |
| FR-17 | Núcleo | `CI-16` | instrumentado | `scripts/contract/gate.sh`; schema recusa campo required ausente; campo opcional extra passa |
| FR-18 | Núcleo | `SDD-17` | instrumentado | `scripts/parser-invariants/gate.sh`; diff de parser do registro sem `proptest!` recusa |
| FR-19 | Autoria | `GATE-11`, `AI-01` | instrumentado | `agent-pr-size-gate.sh` |
| FR-20 | Autoria | `AI-07`–`09` | instrumentado | `.githooks/commit-msg` + `scripts/attribution/gate.sh` |
| FR-21 | Autoria | `AI-03` | waiver | ADR-0037 (mesmo buraco de dono único; agente não tem identidade de merge) |
| FR-22 | Autoria | `AI-06` | instrumentado | pr-size + attribution + waiver-gate no pipeline |
| FR-23 | Autoria | `AI-10` | instrumentado | `test_map` gerado |
| FR-24 | Autoria | `AI-13`–`15` | instrumentado | `scripts/metrics/gate.sh`; sem split ou loc/commit como produtividade recusa |
| FR-25 | Autoria | `AI-12`, `SDD-16` | instrumentado | contrato em `AGENTS.md`: colar saída de `scripts/verify-all --full` |
| FR-26 | Autoria | `GATE-17`, `AI-02` | waiver | ADR-0037 |
| FR-27 | Produto | `AGT-01` | instrumentado | `sanitize::as_model_data` |
| FR-28 | Produto | `AGT-02` | instrumentado | `permission.rs` recusa ferramenta desconhecida |
| FR-29 | Produto | `AGT-03` | instrumentado | `tool::pin` no execute |
| FR-30 | Produto | `AGT-04` | waiver | ADR-0038 |
| FR-31 | Produto | `AGT-05` | instrumentado | `Bound` + `ApprovalKey`; grant de path A não aprova path B |
| FR-32 | Produto | `AGT-06` | instrumentado | `tool/redact.rs`; segredo plantado ausente do ContentBlock |
| FR-33 | Produto | `AGT-07` | instrumentado | `session/store/mac.rs`; linha sem MAC/expirada/estrangeira não entra em `load` |
| FR-34 | Produto | `AGT-08` | instrumentado | `tools/task.rs`; spawn sem envelope, MAC forjado ou expirado recusa |
| FR-35 | Núcleo | `GATE-16` | waiver | ADR-0033 |
