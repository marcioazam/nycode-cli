# relkit

Utilitários para montar relatórios de release (Python 3, só biblioteca padrão).

- `relkit/core/` — seis módulos independentes: `semver`, `globmatch`, `manifest`, `duration`, `table`, `money`.
- `relkit/report/` — `model` (entradas) e `build` (integração dos seis módulos).
- `relkit/util/`, `relkit/types.py`, `relkit/errors.py` — base compartilhada, pronta.
- `python3 -m relkit report manifest.ini files.json [--history 1.0.0,1.1.0]` — imprime o relatório.
- Regras e exemplos: `docs/SPEC.md`. Testes: `python3 -m pytest -q tests`.
