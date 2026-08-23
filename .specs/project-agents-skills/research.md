# Research Summary: agents e skills do nycode-cli

**Date:** 2026-08-16 | **Passes:** 4 | **Confidence:** 84%

Decisão que esta pesquisa fecha: quais agents e skills **deste repositório**
criar (em especial o par de performance crítica em Rust) sem duplicar a frota
da casa nem inflar o prompt do próprio `nycode` (FR-8).

Assunção: os artefatos vivem no repo (`.claude/skills`, `.claude/rules`,
`.claude/agents`, `.cursor/agents`). O produto carrega só skills, e só de
`.nycode/skills`, `.claude/skills` e `.agents/skills`
([`crates/nycode-agent/src/context/skills.rs`](../../crates/nycode-agent/src/context/skills.rs)).
O diretório `.nycode/` está no `.gitignore`, então skill versionada não pode
viver lá.

## Key Findings

1. O repositório não tinha skills, rules nem agents locais; `.claude/` estava
   vazio. A casa já cobre idioma Rust (`rust-reviewer`), perf genérico de
   servidor (`performance-engineer`), regressão num diff
   (`performance-review-auditor` / skill `perf-review`) e custo em tokens
   (`agent-loop-finops-auditor`). O buraco é o contrato **deste** CLI: duas
   cargas (`--version` vs `--probe-startup`), `hyperfine` + RSS + tamanho,
   NFR-8. — Source: inventário local + [AGENTS.md](../../AGENTS.md) | As-of:
   2026-08-16 | Independent sources: 1 (repo) | Confidence: H | Impact: crit

2. Skill, regra e subagent não são intercambiáveis. CLAUDE.md/rules carregam
   sempre (ou por `paths:`); a skill carrega nome+descrição no arranque e o
   corpo só quando invocada; o subagent isola contexto e devolve só o resumo.
   — Source: [Steering Claude Code](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)
   | As-of: 2026-06-18 | Independent sources: 2 (blog Anthropic +
   [docs de sub-agents](https://code.claude.com/docs/en/sub-agents)) |
   Confidence: H | Impact: crit

3. Cada `description` de skill entra no prompt de sistema do `nycode` em
   **toda** sessão neste workspace. O parser só lê escalares de uma linha:
   YAML dobrado (`>-`) faz a skill ser ignorada. — Source:
   [`skills.rs`](../../crates/nycode-agent/src/context/skills.rs) | As-of:
   2026-08-16 | Independent sources: 1 | Confidence: H | Impact: crit

4. Catálogo grande piora seleção e custo. Skills “relevantes” induzem falha
   por procedimento excessivo (62,6% das regressões de eficiência); a
   acurácia de escolha cai com skills confundíveis e com |S| acima de um
   limiar. Packs públicos de 20–40 skills Rust (ex. `adxptived/Rust-Skills`)
   foram rejeitados. — Source: [arXiv 2608.11888](https://arxiv.org/abs/2608.11888),
   [arXiv 2601.04748](https://arxiv.org/abs/2601.04748) | As-of: 2026-08 |
   Independent sources: 2 | Confidence: H | Impact: high

5. Callgrind/iai/Gungraun medem instruções com precisão em CI ruidoso, mas
   **não** substituem o gate: a sessão montada inclui disco, credencial e MCP.
   O instrumento de record continua `scripts/perf-gate.sh`. Criterion, samply
   e DHAT são investigação local, sem nova dependência no workspace (NFR-3,
   SP-04). — Source: [Gungraun vs Criterion](https://gungraun.github.io/gungraun/latest/html/comparison/criterion.html),
   [Rust Performance Book — Profiling](https://nnethercote.github.io/perf-book/profiling.html),
   [ADR-0013](../../docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)
   | As-of: 2026 | Independent sources: 3 | Confidence: H | Impact: high

6. O `performance-review-auditor` da casa já lê
   `.claude/rules/performance.md` quando o ficheiro existe. A alavanca mais
   barata é escrever essa regra (citando AGENTS.md, sem copiar pisos) para o
   auditor genérico passar a aplicar **este** contrato. — Source:
   `~/.claude/agents/performance-review-auditor.md` | As-of: 2026-08-16 |
   Independent sources: 1 | Confidence: H | Impact: high

## Disagreements

- **Criterion no CI vs só local.** Gungraun aconselha não usar wall-clock no
  CI partilhado. Este repositório já trava NFR-1/2/3 com `hyperfine` + RSS no
  runner, com o quociente do ADR-0031. Não é um erro a “corrigir” trocando o
  gate por iai: o utilizador sente wall-clock da sessão montada, não contagem
  de instruções. Confiar: a decisão do repo (ADR-0012/0013/0031).
- **Onde o Cursor descobre agents.** A documentação do Cursor aponta
  `.cursor/agents/`; o Claude Code aponta `.claude/agents/`. Sem evidência
  forte de que o Cursor leia o segundo, o par duplica o agent nos dois sítios.
  Confiança média (70%) neste ponto.

## Open Questions

- O Cursor indexa `.claude/skills/` via Agent Skills, ou só `.cursor/skills/`?
  — Impact: med. Mitigação: skill canónica em `.claude/skills` (o `nycode`
  descobre-a); se o Cursor não disparar sozinho, o corpo ainda se lê pelo
  caminho no prompt do produto.
- A Onda 2 (confinamento, fidelidade de wire, paridade) só se justifica se a
  Onda 1 deixar falhas recorrentes. Incluída no mesmo lote a pedido de
  fechar o plano; cada skill tem `Not for` para o specialist da casa.

## Sources

- https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more — official-doc | as-of: 2026-06-18 | HTTP 200
- https://agentskills.io/specification — official-doc | as-of: 2026-08-16 | HTTP 200
- https://code.claude.com/docs/en/sub-agents — official-doc | as-of: 2026-08-16 | HTTP 200
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills — official-doc | as-of: 2025-10-16
- https://nnethercote.github.io/perf-book/profiling.html — maintainer | as-of: 2026-08-16 | HTTP 200
- https://arxiv.org/abs/2608.11888 — preprint | as-of: 2026-08 | HTTP 200
- https://arxiv.org/abs/2601.04748 — preprint | as-of: 2026-01 | HTTP 200
- https://bheisler.github.io/criterion.rs/book/iai/comparison.html — maintainer
- https://gungraun.github.io/gungraun/latest/html/comparison/criterion.html — maintainer

## Recommended Approach

Uma regra path-scoped que aponta para os pisos já em AGENTS.md, uma skill
curta com o loop de medição deste gate, e um agent read-only que a pré-carrega.
Três skills de produto na Onda 2. Nenhum pack público, nenhuma dependência nova
de benchmark no `Cargo.toml`.
