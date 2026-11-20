# Regras do formato e dos diagnósticos

1. As linhas físicas são separadas apenas por `\n` ou `\r\n`. Nenhum outro caractere (U+2028, `\x0b`, `\x0c`, `\r` isolado) quebra linha.
2. Linha e coluna começam em 1; a coluna conta caracteres desde o início da linha física onde o token culpado começa.
3. `#` fora de string inicia um comentário até o fim da linha física.
4. Uma linha física cujo código (sem o comentário) termina em `\` continua na linha física seguinte. Um comentário que termina em `\` não continua.
5. Numa atribuição, um `[` de lista aberto continua nas linhas físicas seguintes até fechar: a instrução continua enquanto, contando desde o início dela, houver mais `[` do que `]` (colchetes dentro de strings e de comentários não contam). Uma lista sem fechamento consome o resto do arquivo e gera um único erro `E_LIST`. Linhas que começam com `[` (cabeçalhos) nunca continuam por colchete.
6. Instruções: cabeçalho `[a.b]` (linha lógica cujo primeiro token é `[`) ou atribuição `chave = valor`; linhas vazias e comentários são ignorados.
7. Chave: `[A-Za-z_][A-Za-z0-9_-]*`, sem pontos. Cabeçalho: nomes assim separados por pontos; `[a.b]` aninha `b` dentro de `a`.
8. Valores: string entre aspas (escapes `\n`, `\t`, `\"`, `\\`; outro escape → `E_STRING` na posição da barra invertida), inteiro, decimal, `true`, `false` e lista (vírgula final permitida, itens de tipos livres).
9. Uma string cabe numa linha física: sem aspa de fechamento ela termina no fim da linha física, também dentro de uma lista em várias linhas (as linhas físicas seguintes são lidas normalmente), e gera `E_STRING` na posição da aspa de abertura.
10. Cada erro vira um `Diagnostic(line, col, code, message)` na posição física do token culpado; uma linha lógica gera no máximo um diagnóstico. `E_LIST` aponta o `[` de abertura da lista.
11. Códigos: `E_CHAR` (caractere inesperado), `E_STRING`, `E_SYNTAX`, `E_LIST`, `E_HEADER` (cabeçalho malformado), `E_DUP_KEY`, `E_DUP_SECTION`, `E_CONFLICT` (cabeçalho cujo caminho já é um valor) e `E_TYPE`.
12. Chave repetida na mesma seção → `E_DUP_KEY` na segunda chave; o primeiro valor permanece. Cabeçalho repetido → `E_DUP_SECTION` na posição do `[`.
13. Chaves antes de qualquer cabeçalho pertencem à raiz.
14. Recuperação: uma linha inválida não define chave nem abre seção, e o erro fica contido nela. Fora os casos das regras 5 (lista sem fechamento) e 15, a análise recomeça na linha lógica seguinte como se a linha inválida não existisse: aspas, colchetes ou cabeçalhos mal fechados numa linha não mudam a forma como as linhas seguintes são lidas. Toda linha lógica é verificada.
15. Depois de um cabeçalho inválido (qualquer erro numa linha de cabeçalho, por exemplo `E_HEADER`, `E_DUP_SECTION` ou `E_CONFLICT`), as linhas até o próximo cabeçalho continuam sendo analisadas e seus erros de sintaxe são reportados, mas seus valores são descartados: não entram em nenhuma seção e chaves repetidas entre elas não são reportadas. Um novo cabeçalho válido volta ao modo normal. Cabeçalho sem `]` → `E_HEADER` na posição do `[`.
16. `parse` nunca levanta exceção por erro de sintaxe e devolve `Result(config, diagnostics)`; `strict=True` (e `load`) levanta `ParseError` com o primeiro diagnóstico por posição.
17. Os diagnósticos saem ordenados por `(line, col)`.
18. Esquema `{"secao.chave": tipo}`: valor de tipo errado → `E_TYPE` na posição da chave; `bool` não é `int`; `int` vale como `float`.
19. CLI: imprime `linha:coluna: CODIGO: mensagem` por diagnóstico e sai com 1 se houver algum, senão 0.
