# bin/checks — lint da própria configuração do harness

- `check-instructions.py` — CLAUDE.md, rules, commands e skills (YAML, nome, descrição) + bytes sempre carregados.
- `check-agents.py` — contrato dos agentes de `claude-home/agents`.
- `skill-usage.py` — uso real das skills nas sessões (`--unused`).
- `arg-expansion-check.mjs` — `$1`/`$@` acidentais em skills e commands.
- Testes ao lado: `test_check_agents.py`, `test_skill_usage.py`.
