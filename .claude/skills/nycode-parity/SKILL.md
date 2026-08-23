---
name: nycode-parity
description: "Corre e interpreta o gate de paridade contra o harness de referência permitido. Use when changing observable agent behavior, the parity fixture, or NFR-6 divergence. Triggers: \"parity-gate\", \"paridade\", \"NFR-6\", \"nycode-parity\". Not for external landscape research (use research-swarm)."
---
# Paridade com a referência

NFR-6: divergência observável da referência é decisão registada (ADR), não
acaso. O instrumento é `scripts/parity-gate.sh`. Não inventes um segundo
método de comparação.
## Como correr
Precisa do binário `nycode`, do harness `nycode-parity` e do fixture
`nycode-parity-fixture` (`cargo build --workspace`). O script arranca o
fixture local; não precisa de gateway real nem de credencial.
Dois modos, ditos em voz alta:
- **completo** — há harness de referência; as dimensões são comparadas.
- **instrumento** — não há referência; verifica-se que o harness observa o
  candidato. **Não é paridade**, e a saída tem de o dizer.
Não existe o terceiro modo (sair 0 em silêncio porque faltou gateway).
## Proveniência

Referências permitidas: `pi`, `codex`, `opencode`, `goose`, `grok-build`, com
atribuição no `NOTICE`. Código vazado do Claude Code e derivados estão
**proibidos** (`AGENTS.md`). Não abras esse material para "fechar um delta".

Uma divergência nova ou vai para um ADR (como o ADR-0007 dos subagentes) ou
o candidato muda. Calar a diferença no harness é o defeito.

## Evaluation

**Pass:** o gate correu; um modo incompleto foi nomeado; divergência nova tem
ADR ou foi removida.
**Fail:** verde porque o gateway faltou, ou paridade "fechada" contra material
de proveniência proibida.
