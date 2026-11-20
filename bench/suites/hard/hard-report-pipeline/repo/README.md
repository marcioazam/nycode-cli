# reportkit

Relatório de vendas a partir de um CSV de pedidos (Python 3, só biblioteca padrão).

O pipeline tem cinco etapas, uma por subpacote:

- `reportkit/reader/` — texto CSV → linhas cruas (`read_rows`).
- `reportkit/validate/` — linhas cruas → pedidos (`validate_rows`).
- `reportkit/aggregate/` — pedidos → resumo (`aggregate`).
- `reportkit/formatting/` — resumo → texto (`render_text`).
- `reportkit/export/` — resumo → CSV ou JSON (`export`).

`reportkit/pipeline.py` liga as etapas (`run`), `reportkit/cli.py` é a linha de comando, `reportkit/models/` e
`reportkit/helpers/` são a base compartilhada.

- Uso: `python3 -m reportkit data/orders.csv [-f text|csv|json] [-o saida]`.
- Regras e formatos: `docs/SPEC.md`.
- Testes: `python3 -m pytest -q tests`.
