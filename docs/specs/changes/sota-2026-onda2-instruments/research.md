# Pesquisa — instrumentos da onda 2 (SOTA-2026 v1.4.0)

As-of: 2026-08-18. Fontes permitidas: `pi`, `grok-build`, `codex`, `opencode`,
`goose`, OWASP Agentic 2026, papers citados. Proibido: Claude Code vazado.
Isto não é MUST novo; fecha o desenho de cada Issue da onda 2.

## Decisão que a pesquisa fecha

Como instrumentar AGT-04–08 e FR-8/17/18/24 neste stack (Rust 2024, tokio,
`bash -c`, subagente in-process, JSONL) sem copiar harness de outro produto
e sem alongar `AGENTS.md`.

## Contra-evidência (assertividade)

Mais markdown e mais abas GitHub não sobem correção nem conformidade.

- arXiv [2602.11988](https://arxiv.org/abs/2602.11988): arquivos de contexto
  não movem sucesso; custo +20%.
- arXiv [2607.27250](https://arxiv.org/abs/2607.27250): `AGENTS.md` real não
  converte near-miss em pass.
- arXiv [2602.12670](https://arxiv.org/abs/2602.12670): ≥4 skills e SKILL.md
  “comprehensive” perdem para pacotes compactos.
- Issue Types e merge queue em conta pessoal não são MUST. `AI-04` é deny no
  cliente.

## AGT-04 / FR-30 — argv-as-data

Nenhum dos cinco refs usa `argv: string[]` no contrato do modelo. Codex, Pi,
Goose e grok-build spawnam `[shell, -c|-lc, command]`. OpenCode historicamente
`spawn(command, {shell})`.

NyCode: schema `{ argv: string[] }`, `Command::new(&argv[0]).args(&argv[1..])`,
recusar `command`, recusar interpreter+`-c`. Fixture:
`a_command_string_is_rejected_and_metacharacters_are_data`.

## AGT-05 / FR-31 — aprovação ligada

Chave: ator + tool + alvo canónico + digest dos params. OpenCode
`always: ["*"]` é anti-padrão. Goose é só por nome. Codex: cache com chaves
tipadas; patch path-only é fraco demais para o ID.

NyCode: `Bound` à frente de `Asking`; grant de path A não aprova path B.
Subagente não reusa grant do pai.

## AGT-06 / FR-32 — segredo fora do modelo

Regex best-effort (Codex `redact_secrets`) não é o ID. Prosa em `AGENTS.md`
não é o ID (`AI-04`). Fixture: segredo plantado ausente de `ContentBlock`,
JSONL e tracing; credencial extra some quando `execute` retorna.

## AGT-07 / FR-33 — memória validada / TTL / escopo

JSONL append-only (ADR-0006) permanece. Falha fechada na fronteira do modelo:
linha sem MAC, expirada ou de outro workspace não entra em `load`. Fixture:
`an_unsigned_expired_or_foreign_session_record_is_not_loaded_into_model_context`.

## AGT-08 / FR-34 — envelope do filho

ADR-0007 hoje declara ausência de fronteira pai/filho. O PR deste ID emenda
isso. Envelope HMAC no spawn de `task`; envelope forjado recusa. Não HTTP A2A.

## FR-8 / ADV-05

`scripts/vacuous-assert/gate.sh` no diff: `assert!(true)`, só `is_ok()`/`is_some()`.
Clippy `assertions_on_constants` não cobre existência. Mutation não é este ID.

## FR-17 / CI-16

Schema JSON do argv + NDJSON `Event` em `contracts/cli/`. `nycode-parity` não
substitui. Pact HTTP e snapshot de `--help` falham expansão compatível.

## FR-18 / SDD-17

`scripts/parser-invariants/gate.sh`: se o diff toca parser no registro, exige
`proptest!`. Fora do diff, não taxa o workspace.

## FR-24 / AI-13–15

Validador de relatório DORA partido por origem (`Assisted-by` vs humano).
Contagem de commits não é produtividade (`AI-15`).

## Ordem

AGT-04 → AGT-05 → AGT-06 → AGT-07 → AGT-08 → FR-8 → FR-18 → FR-17 → FR-24.
Um ID por PR (`GATE-11`). GATE-16 e GATE-17 ficam em waiver.
