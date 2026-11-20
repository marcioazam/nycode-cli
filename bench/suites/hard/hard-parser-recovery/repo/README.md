# cfgparse

Analisador de um formato próprio de configuração (somente biblioteca padrão), com recuperação de erros:
um arquivo com problemas devolve a configuração aproveitável e todos os diagnósticos, cada um com a
linha e a coluna físicas do problema.

```text
# exemplo
[server.http]
port = 8080
hosts = ["a", "b"]
```

- `cfgparse/reader`: linhas físicas, linhas lógicas (continuação) e mapa de posições.
- `cfgparse/lexer`: tokens, strings, números.
- `cfgparse/parser`: valores, cabeçalhos, gramática, recuperação, diagnósticos.
- `cfgparse/schema`: validação de tipos. `cfgparse/result`: árvore e mesclagem.
- `cfgparse/api.py`, `cfgparse/cli.py`: `parse`, `load` e o comando.

Regras em `docs/SPEC.md`. Testes: `python3 -m pytest -q tests`.
