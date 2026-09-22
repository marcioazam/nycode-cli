# Design — SOTA-2026 v1.4.0 harness

Issue: [#70](https://github.com/marcioazam/nycode-cli). Requirements: [specs.md](specs.md).

## Abordagem

Citar IDs do padrão pinado; não copiar pilares. Instrumentos novos são scripts
no mesmo contrato de `scripts/ci-local.sh` / `scripts/verify-all`. O runtime do
produto ganha dois controles AGT nesta fatia (overlay e pin no execute); o
resto de AGT entra em waiver datado.

## Integração

- Matriz: `docs/CONFORMANCE-MATRIX.md`, preenchida a partir de
  `standard/HARNESS.md` v1.4.0.
- Ledger GitHub: how-to em `docs/how-to/`, Issue Form, PR template. Project
  requer scope `project` no token `gh` — se faltar, fica registrado na Issue.
- Deny: `.claude/settings.json`, `.cursor/permissions.json`, rules `00`/`30`/`80`.
- `GATE-14`: `scripts/waiver/gate.sh` + `registry.txt` + `scripts/flake-quarantine.txt`.
- `GATE-10`: `scripts/artifact/gate.sh` (Trivy no artefato) depois do
  `cargo build --release`.
- AGT-01: `tool::sanitize::as_model_data` na conversão `ToolOutput::into_blocks`.
- AGT-03: `tool::pin` no `Agent::specs` / `Agent::execute`.

## Fila de merge

Plataforma: só em repositório público de organização. Este repo é
`marcioazam/nycode-cli`. Não reivindicar fila. Manter `on.merge_group` e fazer
os jobs hoje só-PR reportarem também nesse evento.

## Erros

| Condição | Resultado |
|---|---|
| Waiver expirado | `GATE-14` fecha o merge |
| Schema mutado entre apresentação e execute | `ToolOutput::error`, falha fechada |
| Overlay em saída de ferramenta | envelopado como dado; o texto continua visível |
| Trivy ausente | gate fecha com a linha de instalação |
| Token `gh` sem scope `project` | Issue segue; Project não é autoridade |

## Alternativas recusadas

- Copiar `RULES.md` para o repo — ADR-0032.
- Declarar Produto agente como não aplicável — o binário planeja, chama tools e persiste sessão.
- Ativar `required_pull_request_reviews` para marcar `GATE-17` — ADR-0034.
- Encompridar `AGENTS.md` para “ficar mais assertivo” — v1.3.0, três camadas.

## Aprovação (SDD-04)

- Aprovador: @marcioazam
- Data: 2026-08-18
- Evidência: escolha `two_wave` e pedido de implementação do plano “Harness SOTA duas ondas”.
