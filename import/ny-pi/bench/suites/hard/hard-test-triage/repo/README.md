# stockroom

Estoque, pedidos e relatórios em memória, só com a biblioteca padrão.

- `stockroom/catalog`: SKU, produtos, embalagens.
- `stockroom/inventory`: livro de movimentos, lotes com validade, reservas, reposição, transferência.
- `stockroom/orders`: preço, frete, totais e ciclo de vida do pedido.
- `stockroom/reports`: reposição, valor do estoque e tabela de texto.
- `stockroom/util`, `stockroom/config.py`: dinheiro, ids e configuração do processo.
- `stockroom/app.py`: fachada (`App`).

As regras estão em `docs/SPEC.md`, que é a fonte da verdade. Testes: `python3 -m pytest -q tests`.

A última refatoração (separação em subpacotes) mexeu em código e em testes ao mesmo tempo e a suíte ficou
vermelha: há regressões no código e há testes que passaram a contrariar o SPEC.
