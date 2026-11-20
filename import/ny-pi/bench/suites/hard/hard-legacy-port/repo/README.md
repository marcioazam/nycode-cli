# balcao-frete

Cotação de frete do balcão. Python 3, só biblioteca padrão.

- `legacy/` — motor antigo (`frete_calc`, `frete_tab`, `frete_fmt`): estado global, códigos de erro numéricos.
  Continua em uso por `app/` até a migração terminar.
- `frete/` — pacote novo, a implementar conforme `docs/SPEC.md`.
- `app/` — CLI de lote (`python3 -m app.cli lote.txt`), ainda sobre o legado.
- `util/` — helpers sem dependência do legado (podem ser usados pelo pacote novo).
- `tests/` — `python3 -m pytest -q tests`.
