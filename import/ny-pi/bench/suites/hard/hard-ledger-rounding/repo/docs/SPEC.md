# Regras do razão

1. Valores monetários são `Decimal`; o carregador rejeita `float` com `TypeError`.
2. Expoentes (casas da unidade menor): EUR, USD e BRL = 2; JPY = 0; KWD = 3. Moeda desconhecida → `ValueError`.
3. O arredondamento acontece uma única vez, no fim de cada cálculo, para o expoente da moeda de destino. Nenhum cálculo arredonda valores intermediários.
4. Modos de arredondamento: `half_up` (metade se afasta do zero, também para negativos), `half_even` (metade vai ao par) e `down` (em direção a zero). Os nomes são aceitos sem diferenciar maiúsculas de minúsculas, e `-` equivale a `_` (`HALF_UP`, `half-up` e `half_up` são o mesmo modo). Modo desconhecido → `ValueError`, nunca um modo padrão silencioso.
5. Imposto = `líquido × alíquota`, modo `half_up`, na moeda do relatório, calculado sobre o líquido já convertido e arredondado.
6. Taxa de processamento = `|valor| × FEE_RATE`, modo `FEE_MODE` da configuração.
7. Juros = `principal × taxa_anual × dias / 365`, modo `half_even`.
8. Conversão cambial = `valor × taxa`, expoente da moeda de destino, modo `FX_MODE` da configuração (`half_up`). Mesma moeda devolve o valor inalterado; taxa ausente → `ValueError`.
9. Rateio por maior resto: cada parte começa em `down`; a sobra, em unidades mínimas, vai uma a uma às partes de maior resto fracionário (empate: menor índice). A soma das partes é exatamente o total. Total negativo: rateia o valor absoluto e nega as partes. Pesos vazios, não positivos → `ValueError`.
10. Cada linha do relatório tem `net`, `tax` e `gross = net + tax`, todos já arredondados.
11. Os totais do relatório são, coluna a coluna, a soma exata das linhas exibidas (já arredondadas). Assim o total sempre confere com a soma do que o leitor vê.
12. As linhas seguem a ordem `(data, id)`.
13. A renderização exibe cada valor com o expoente da moeda do relatório.
14. Estornos (`refund`) têm valor negativo; o imposto é o simétrico do imposto da venda correspondente (regra 4 afasta do zero).
15. Lançamentos `fee` e `interest` não são tributáveis: o imposto da linha é zero, qualquer que seja a `tax_rate`.
16. Datas são ISO (`AAAA-MM-DD`); data inválida → `ValueError`.
17. O diário rejeita ids duplicados com `ValueError`.
