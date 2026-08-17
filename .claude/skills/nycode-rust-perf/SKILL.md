---
name: nycode-rust-perf
description: "Mede e otimiza o binário nycode contra o gate de sessão montada (NFR-1/2/3) com NFR-8 ativo. Use when the change touches startup, RSS, binary size, --probe-startup, or a Rust hot path on the mounted session. Triggers: \"perf-gate\", \"NFR-1\", \"RSS\", \"probe-startup\", \"otimizar rust\". Not for generic backend profiling (use performance-engineer), a diff perf review (use perf-review), or agent-loop token cost (use agent-loop-finops-auditor)."
---

# Performance crítica do nycode

Os pisos, as duas cargas e o comando do gate estão no `AGENTS.md` e em
`.claude/rules/performance.md`. Não os copies para aqui. Detalhe de ferramenta
(samply, Criterion, iai, DHAT) está em [references/tooling.md](references/tooling.md)
— lê só o que o perfil pedir.

## Loop

Uma mudança por ciclo. Sem número medido, não há otimização.

1. **Baseline.** `cargo build --release` e `scripts/perf-gate.sh`. A carga que
   NFR-1/NFR-2 descrevem é `--probe-startup` (ADR-0013), não `--version` no
   lugar da sessão.
2. **Perfil.** Só se o gate falhou ou o usuário pediu um hotspot. Preferir
   samply ou `cargo flamegraph` sobre o binário de `[profile.bench]` (já tem
   `debug = 1` e herda release). Atribua tempo/alocação a `file:line`.
3. **Uma mudança** no caminho quente. Não afrouxar LTO, `strip` nem
   `panic = "abort"`. Não adiar FR-11 nem FR-10 para caber no startup (NFR-8).
4. **Verificar.** O mesmo `scripts/perf-gate.sh` no mesmo tipo de máquina. Sem
   isso, a melhoria é [unverified].

## O que não fazer

- Editar `scripts/perf-baseline.txt` à mão.
- Adicionar Criterion, iai-callgrind ou semelhante ao `Cargo.toml` deste
  workspace sem ADR (NFR-3, SP-04). Investigação local, fora da árvore.
- Substituir o gate por contagem de instruções: a sessão montada inclui disco,
  credencial e MCP.

## Evaluation

**Pass:** o ciclo correu o `perf-gate.sh` antes e depois, o perfil apontou um
`file:line`, e nenhuma mudança desligou controle de segurança para caber no
orçamento.
**Fail:** otimização sem baseline do gate, ou `--version` tratado como sessão
montada.
