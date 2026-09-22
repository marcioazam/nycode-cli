# Delta — AGT-05

## ADDED

- REQ-AGT05-001: Grant é `ApprovalKey` (ator, tool, alvo canónico, digest de params).
- REQ-AGT05-002: Grant de path A não aprova path B.
- REQ-AGT05-003: Mesmo path com params diferentes não reusa o grant.
- REQ-AGT05-004: Subagente não reusa grant do pai.
- REQ-AGT05-005: Chamada unlinkable recusa e não entra no cache.

## MODIFIED

- `Approver::approve` passa a ver identidade canónica, não só o nome da tool.

## REMOVED

- Nenhum.

## Aprovação (SDD-02)

Pendente LGTM humano.
