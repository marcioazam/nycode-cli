# ledger

Razão contábil mínimo em Python (somente biblioteca padrão): lançamentos, imposto, taxas, juros,
câmbio, rateio e relatório final.

- `ledger/model`: lançamentos, contas, diário, moedas.
- `ledger/calc`: imposto, taxas, juros, câmbio, rateio.
- `ledger/report`: linhas, totais e renderização.
- `ledger/io`: leitura de registros e serialização.
- `ledger/util`: utilitários numéricos, datas e texto.

Uso: `ledger.app.build_report(registros, Rates({...}), "EUR")`.
As regras de negócio estão em `docs/SPEC.md`. Testes: `python3 -m pytest -q tests`.
