---
name: nycode-confinement
description: "Aplica o contrato de confinamento de SO deste repo (FR-11, duas políticas). Use when changing bash sandbox, MCP child process, hooks, or confinement detection. Triggers: \"confinamento\", \"FR-11\", \"workspace-write\", \"network-client\", \"sandbox\". Not for a generic OWASP audit (use security-auditor)."
---
# Confinamento de SO

A detecção de confinamento (FR-11) **não** se adia para o primeiro uso da
ferramenta nem se salta para caber no startup (NFR-8 / ADR-0011). Ausência
tem de ser dita ao usuário **antes** de ele decidir agir.

## Duas políticas (ADR-0017)

Quem invoca escolhe; o processo filho não escolhe o próprio confinamento.

- **`workspace-write`** — leitura ampla, escrita na raiz e no temporário, rede
  negada. Shell e hooks.
- **`network-client`** — leitura ampla, escrita só no temporário, rede
  permitida, workspace **não** gravável. Servidor MCP por stdio.

Rede permitida não é consentimento (ADR-0016). Uma política que permite por
omissão (perfil macOS com `allow default`) não se relata como equivalente a
uma que nega — isso seria degradação silenciosa (NFR-4).

## O que não fazer

- Envolver MCP com `workspace-write` (corta a rede e inutiliza o servidor).
- Envolver o shell com `network-client` (abre saída de rede a um comando que
  o usuário revisou como local).
- Anunciar confinamento quando o ambiente não o impõe.

Ver: ADR-0005 (processo auxiliar), ADR-0017 (duas políticas),
ADR-0018 (contenção de caminho na abertura).

## Evaluation

**Pass:** a mudança nomeia a política, não a omite na detecção, e não troca
uma pela outra para "simplificar".
**Fail:** FR-11 adiado para o primeiro `bash`, ou MCP/hook a subir sem a
política que o ADR-0017 lhes atribui.
