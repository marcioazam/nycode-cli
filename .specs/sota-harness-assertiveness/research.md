# Research Summary: harness SOTA 2026 — assertividade máxima

**Date:** 2026-08-17 | **Passes:** 5 | **Confidence:** 86%

Decisão a fechar: o que ainda falta no harness *deste* repositório para
agentes (Claude Code, Codex, OpenCode, Cursor, Goose) falharem fechado
sem reabrir `GATE-16`, sem subir cobertura, sem auto-aprovação
`GATE-17`, e sem alongar o `AGENTS.md`.

Critério de parada: cada ferramenta tem um instrumento mecânico no Stop
(ou um “não se aplica” honesto), os gates já escritos estão no
`ci-local.sh --full`, e nenhuma regra nova vive só como prosa.

## Key Findings

1. `AGENTS.md` no OpenCode entra no contexto do modelo. A página de
   rules não descreve outro mecanismo (hook que recuse Stop). Fail-closed
   nas outras ferramentas é hook, permissão e CI — isso vem das docs
   delas, não desta.
   — Source: <https://opencode.ai/docs/rules/> | As-of: 2026-08-17 |
   Independent sources: 1 (oficial OpenCode; Claude/Codex corroboram o
   lado *deles*) | Confidence: H | Impact: crit
   Pass 5: VERIFIED a citação de contexto; o gloss “não é enforcement”
   não está na página.

2. Claude Code: `Stop` com exit **2** impede o modelo de parar. Sem JSON
   válido no stdout, exit **1** é erro não-bloqueante. O script deve
   sair cedo se `stop_hook_active` é true (já continuou). O cap da
   plataforma é 8 bloqueios consecutivos sem progresso — não é o
   critério do early-exit.
   — Source: <https://code.claude.com/docs/en/hooks> ·
   <https://code.claude.com/docs/en/hooks-guide> | As-of: 2026-08-17 |
   Independent sources: 1 publisher (duas páginas Anthropic) |
   Confidence: H | Impact: crit
   Pass 5: VERIFIED. JSON válido no stdout ainda pode decidir o
   resultado; `WorktreeCreate` falha em qualquer nonzero (outro evento).

3. Codex: só `type: "command"` corre. `Stop` com exit 2 + stderr
   continua o turno; `decision: "block"` no Stop **não** rejeita o
   turno — vira prompt de continuação. Stdout em exit 0 tem de ser JSON
   ou vazio.
   — Source: <https://developers.openai.com/codex/hooks> | As-of: 2026-08-17 |
   Independent sources: 1 (oficial) | Confidence: H | Impact: crit
   Pass 5: VERIFIED.

4. Cursor `stop` dispara **depois** do loop acabar. Continuação é
   `followup_message`. `loop_limit` default 5. Exit 2 bloqueia; outros
   códigos, por default, seguem (fail-open). `failClosed: true` bloqueia
   em crash, timeout ou JSON inválido — a página **não** diz que isso
   cobre outros exit codes.
   — Source: <https://cursor.com/docs/hooks> | As-of: 2026-08-17 |
   Independent sources: 1 (oficial) | Confidence: H | Impact: high
   Pass 5: VERIFIED o fail-open default e o `failClosed` para
   crash/timeout/JSON; o acoplamento “failClosed cobre exit 1” é
   inferência, não citação.

5. OpenCode plugins expõem `session.idle`. Um plugin TypeScript só para
   teatro duplicaria o contrato. Não há Stop-block nativo na doc de
   plugins.
   — Source: <https://opencode.ai/docs/plugins/> | As-of: 2026-08-17 |
   Independent sources: 1 | Confidence: H | Impact: med

6. Alongar `AGENTS.md` não sobe taxa de sucesso e sobe custo (~+20%).
   Catálogos grandes de skill degradam seleção. Assertividade máxima ≠
   mais instrução always-on.
   — Source: <https://arxiv.org/html/2602.11988> | As-of: 2026-02 |
   Independent sources: 2 (Gloaguen et al.; Anthropic 2026-07-24 sobre
   cortar o system prompt) | Confidence: H | Impact: high
   Pass 5: fora do lote do fact-checker (não era claim de vendor hook).

7. DORA 2025: uso de IA ainda se correlaciona **negativamente** com
   estabilidade de entrega; o cluster que desbloqueia é teste
   automatizado + VCS maduro + feedback **rápido**. GitClear 2026
   (623M changes): duplicação +81%, error-masking +47% — já cobertos
   por `GATE-08` e `scripts/error-masking/` quando ligados de verdade.
   — Source: DORA 2025 · GitClear 2026 | As-of: 2026 |
   Independent sources: 2 | Confidence: M | Impact: high
   Pass 5: fora do lote do fact-checker.

8. `clippy::assertions_on_constants` (style, warn desde 1.34.0) pega
   `assert!(true)`, `assert!(false)` e `assert!(B)` com `B` const —
   não só tautologia que “não pode falhar”. Não pega `#[test] fn`
   vazio. FR-8 fica parcial.
   — Source: <https://rust-lang.github.io/rust-clippy/master/index.html#/assertions_on_constants>
   | As-of: 2026-08-17 (clippy master, unversioned) | Independent
   sources: 1 | Confidence: H | Impact: med
   Pass 5: VERIFIED.

9. Instrumentos `scripts/waiver/` e `scripts/error-masking/` existiam
   fora do `full()`; a spec 003 dizia `instrumentado`. Isso era teatro.
   Ligados no `--full` e no CI nesta passagem.
   — Source: árvore local 2026-08-17 | Independent sources: 1 |
   Confidence: H | Impact: crit

## Disagreements

- **Prosa vs máquina.** Guias de “verification before completion”
  (skills) pedem que o modelo rode testes. Docs oficiais de Claude,
  Codex e Cursor pedem hook de Stop. Confiar no skill é o que o
  próprio modelo ignora sob carga de instrução. O hook vence.
- **Cursor vs Claude/Codex no Stop.** Claude/Codex ainda podem recusar
  a parada. Cursor só reabre o turno com `followup_message`. Não
  média: o mesmo script ramifica a saída.
- **`--fast` em todo Stop vs teste só do que sujou.** DORA pede
  feedback rápido; `--fast` (~1 min) em cada Stop briga com isso.
  Verificação = `cargo test` dos crates `.rs` sujos, não a sequência
  inteira do merge.

## Verification (Pass 5)

Lote de 9 claims de vendor enviado ao fact-checker (contexto limpo,
só claims + URLs). URLs todas HTTP 200 em 2026-08-17. Nenhuma página
de vendor trazia data de last-updated.

| Lote | Veredito |
|---|---|
| 8 VERIFIED | Stop exit 2 Claude; exit 1 fail-open sem JSON; `stop_hook_active` + cap 8; Codex command-only / decision:block / stdout JSON; Cursor loop ends + followup + loop_limit 5; exit 2 vs fail-open default; OpenCode AGENTS.md no contexto; clippy `assertions_on_constants` |
| 0 INCORRECT | — |
| Extra wording | `failClosed` ↔ outros exit codes (claim 7); “not enforcement” no OpenCode (claim 8) — a página não diz isso |

Nenhum claim bloqueante. Cada claim de vendor assenta numa doc só
(claim 2 = duas páginas Anthropic = um publisher). Clippy master é
índice vivo; a lint em si data de 1.34.0.

O script deste repo no Cursor **não depende** da inferência
failClosed↔exit 1: falha de teste devolve `followup_message` com exit
0. `failClosed: true` cobre o que a página nomeia (crash, timeout,
JSON inválido).

## Open Questions

- Goose: contrato de hook de Stop no repo do *peer* (não no produto)
  não foi revalidado nesta passagem — Impact: low (AGENTS.md + git
  hooks já cobrem o merge).
- FR-9 (quarentena de flake) e FR-18 (PBT) continuam abertos de
  propósito: presença de `proptest` não prova propriedade; retries do
  nextest não são quarentena — Impact: med

## Sources

- <https://code.claude.com/docs/en/hooks> — official-doc | 2026-08-17
- <https://code.claude.com/docs/en/hooks-guide> — official-doc | 2026-08-17
- <https://developers.openai.com/codex/hooks> — official-doc | 2026-08-17
- <https://cursor.com/docs/hooks> — official-doc | 2026-08-17
- <https://opencode.ai/docs/rules/> — official-doc | 2026-08-17
- <https://opencode.ai/docs/plugins/> — official-doc | 2026-08-17
- <https://arxiv.org/html/2602.11988> — peer-reviewed/preprint | 2026-02
- <https://rust-lang.github.io/rust-clippy/master/index.html#/assertions_on_constants>
  — official-doc | 2026-08-17

## Recommended Approach

Não alongar o `AGENTS.md`. Ligar waiver e error-masking no `full()`.
Um script `scripts/agent-stop/verify.sh` (exit 2, nunca 1) atrás de
três JSON finos (`.claude/settings.json`, `.codex/hooks.json`,
`.cursor/hooks.json`). `assertions_on_constants = deny`. OpenCode fica
no `AGENTS.md` já existente. FR-9/18/24 abertos.
