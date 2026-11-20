# SPEC — reportkit

`reportkit` lê um CSV de pedidos e produz um relatório de vendas. As seções 1 a 8 descrevem o que já existe e
funciona (relatório `summary`). A seção 9 é o trabalho pedido: coluna `status`, modo tolerante e o relatório
`monthly`, com as regras numeradas R1 a R16. Só biblioteca padrão. Dinheiro é sempre `decimal.Decimal`, nunca
`float`.

## 1. Modelo e erros

- `reportkit/models/`: `RawRow(line, fields)`, `Order`, `Summary`, `RegionSummary`, `ProductLine`.
- `reportkit/errors.py`: `ReportError` é a base; `ReadError` (etapa de leitura), `ValidationError` (etapa de
  validação; o atributo `errors` é a lista de mensagens e `str()` é essa lista unida por `\n`) e `ExportError`
  (saída impossível de produzir).

## 2. Leitura (`reportkit.reader.read_rows`)

- 2.1 Separador `,`; campos entre aspas duplas podem conter vírgula, quebra de linha e `""` (uma aspa). Campos
  sem aspas perdem espaços e tabs das pontas; campos com aspas ficam como estão. Aceita BOM inicial, `\n` e `\r\n`.
- 2.2 Linhas em branco e linhas cujo primeiro caractere não branco é `#` são puladas (fora de aspas). O número de
  uma linha de dados é o número da linha física do arquivo em que o registro começa, contando a partir de 1 e
  incluindo as linhas puladas.
- 2.3 O primeiro registro é o cabeçalho. As colunas obrigatórias são `order_id`, `date`, `region`, `product`,
  `quantity`, `unit_price`, `discount_pct`, em qualquer ordem; colunas desconhecidas são ignoradas. Erros
  (`ReadError`): `missing header`, `line N: missing column 'x'`, `line N: duplicate column 'x'`,
  `line N: expected A fields, got B`, `line N: unterminated quoted field`,
  `line N: unexpected character after closing quote`.

## 3. Validação (`reportkit.validate.validate_rows`)

Cada linha de dados é conferida coluna a coluna, na ordem abaixo. Todas as mensagens de todas as linhas são
reunidas (ordem das linhas, depois ordem das colunas) e, havendo alguma, levanta-se `ValidationError`. Cada mensagem
tem a forma `line N: <coluna>: <motivo>`; o texto do campo aparece entre aspas simples, sem escape.

- 3.1 `order_id`: vazio → `order_id: empty`; igual ao de uma linha anterior → `order_id: duplicate of line M`
  (M é a primeira linha com esse id). O id fica registrado na primeira vez em que aparece, mesmo que essa linha
  tenha outros erros.
- 3.2 `date`: `AAAA-MM-DD` com data real; senão `date: invalid date '<texto>'`.
- 3.3 `region`: comparada em maiúsculas com `NORTH`, `SOUTH`, `EAST`, `WEST`; senão
  `region: unknown region '<texto>'`. O pedido guarda a região em maiúsculas.
- 3.4 `product`: vazio → `product: empty`.
- 3.5 `quantity`: só dígitos e maior que zero; senão `quantity: invalid quantity '<texto>'`.
- 3.6 `unit_price`: dígitos com até duas casas opcionais (`12`, `12.5`, `12.50`); senão
  `unit_price: invalid amount '<texto>'`.
- 3.7 `discount_pct`: vazio vale 0; mesma sintaxe de 3.6 e no máximo 100; senão
  `discount_pct: invalid percentage '<texto>'`.

## 4. Agregação (`reportkit.aggregate.aggregate`)

- 4.1 Por pedido: `gross = quantity × unit_price`; `discount = gross × discount_pct / 100`, arredondado para o
  centavo, meio para cima, pedido a pedido; `net = gross − discount`.
- 4.2 O resumo soma `orders` (quantidade de pedidos), `units`, `gross`, `discount`, `net` no total, por região e
  por produto dentro da região. `average_order = net / orders` (centavo, meio para cima; `0.00` sem pedidos).
  `first_date` e `last_date` são a menor e a maior data (`None` sem pedidos).
- 4.3 Regiões em ordem de `net` decrescente e, no empate, nome crescente; produtos de uma região idem.
- 4.4 `share` da região = `net` da região / `net` total × 100, com uma casa, meio para cima (`0.0` se o total é 0).

## 5. Texto (`reportkit.formatting.render_text`)

Toda linha termina com `\n` e não tem espaço no fim. Dinheiro no texto usa separador de milhar e duas casas
(`1,234.50`). Linhas, na ordem: `SALES REPORT`; `Period: <first_date> to <last_date>` (ou `Period: -`);
`Orders: N`; `Units: N`; `Gross: X`; `Discount: X`; `Net: X`; `Average order: X`; uma linha vazia; a tabela.

Tabela: as células de uma linha são unidas por dois espaços. Larguras 22, 6, 6, 12, 12, 12, 6; a primeira coluna é
alinhada à esquerda e as demais à direita; um valor mais largo que a coluna não é cortado. Cabeçalho:
`REGION / PRODUCT`, `ORDERS`, `UNITS`, `GROSS`, `DISCOUNT`, `NET`, `SHARE`. Para cada região, uma linha com o nome
e o `share` seguido de `%`; depois uma linha por produto, com o nome precedido de dois espaços e ajustado a 20
caracteres (tab e quebras viram espaço; nomes maiores são cortados e terminam em `...`) e `SHARE` vazio. Última
linha: `TOTAL` com os totais e `SHARE` vazio.

## 6. CSV (`reportkit.export.export(resumo, "csv")`)

- 6.1 Toda linha termina com `\r\n`. Um campo só recebe aspas se contém `,`, `"`, `\r`, `\n` ou começa/termina com
  espaço; aspas internas são dobradas.
- 6.2 Números sem separador de milhar; dinheiro com duas casas; `share` com uma casa e sem `%`.
- 6.3 Cabeçalho `region,product,orders,units,gross,discount,net,share`. Linha de região: `product` vazio. Linha de
  produto: `share` vazio. Última linha: `region` = `TOTAL`, `product` e `share` vazios.

## 7. JSON (`reportkit.export.export(resumo, "json")`)

Objeto com as chaves `report` (`"summary"`), `first_date`, `last_date` (texto ISO ou `null`), `orders`, `units`
(inteiros), `gross`, `discount`, `net`, `average_order` (texto com duas casas) e `regions`: lista de objetos com
`region`, `share` (texto com uma casa), `orders`, `units`, `gross`, `discount`, `net` e `products` (lista de
objetos com `product`, `orders`, `units`, `gross`, `discount`, `net`). Indentação de 2 espaços e `\n` final.

## 8. Pipeline e linha de comando

- 8.1 `reportkit.pipeline.run(text, fmt="text")` devolve a saída; `fmt` é `text`, `csv` ou `json`; outro valor
  levanta `ExportError("unknown format '<fmt>'")`. `reportkit.run` é a mesma função.
- 8.2 `reportkit.cli.main(argv)`: `reportkit ENTRADA [-f FORMATO] [-o SAIDA]`. Escreve a saída em stdout (ou no
  arquivo de `-o`) e devolve 0. Um `ReportError` vira `error: <mensagem>` em stderr, nada em stdout, retorno 2.

## 9. Trabalho pedido: `status`, modo tolerante e relatório `monthly`

Tudo o que as seções 1 a 8 descrevem continua valendo, salvo onde uma regra abaixo diz o contrário. A saída de um
arquivo sem coluna `status` e sem linhas inválidas, no relatório `summary`, não muda.

### 9.1 Coluna `status`

- **R1** `status` é uma coluna opcional do cabeçalho, em qualquer posição. Sem ela, todo pedido é `paid`. Repetida,
  vale a regra das demais: `ReadError("line N: duplicate column 'status'")`.
- **R2** Valores aceitos, sem diferenciar maiúsculas de minúsculas: `paid`, `refunded`, `cancelled`; campo vazio
  vale `paid`. Outro valor gera a mensagem `line N: status: unknown status '<texto>'`, que vem depois das mensagens
  das outras colunas da mesma linha.
- **R3** No relatório `summary` só os pedidos `paid` contam: os `refunded` e `cancelled` ficam fora de tudo
  (totais, regiões, produtos, `first_date`/`last_date`). A saída é a mesma de um arquivo sem essas linhas.

### 9.2 API, relatórios e modo tolerante

- **R4** `reportkit.pipeline.run(text, fmt="text", report="summary", skip_invalid=False) -> str` e
  `reportkit.pipeline.run_with_warnings(text, fmt="text", report="summary", skip_invalid=False) ->
  (saida, avisos)`, em que `saida` é exatamente o que `run` devolve e `avisos` é uma lista de `str`. `report` é
  `summary` ou `monthly`. Relatório desconhecido levanta `ExportError("unknown report '<report>'")` e formato
  desconhecido levanta `ExportError("unknown format '<fmt>'")`; os dois são conferidos ANTES de ler a entrada
  (valem mesmo com entrada vazia ou inválida), o relatório primeiro.
- **R5** Com `skip_invalid=False` nada muda: havendo mensagens de validação, levanta-se `ValidationError`; não
  havendo, `avisos == []`. Com `skip_invalid=True`, cada linha que teria ao menos uma mensagem é descartada, o
  relatório é feito com as demais e `avisos` traz as mesmas mensagens, na mesma ordem, que estariam em
  `ValidationError.errors`. A regra 3.1 não muda: repetir o id de uma linha descartada também é erro. Um
  `ReadError` continua fatal nos dois modos.
- **R6** Só no formato `text`, nos dois relatórios: quando `skip_invalid=True` e ao menos uma linha foi
  descartada, a saída ganha uma última linha `Skipped rows: N`, em que N é o número de LINHAS descartadas (uma
  linha com duas mensagens conta uma vez). CSV e JSON não mudam.
- **R7** Linha de comando: `-r/--report RELATORIO` (padrão `summary`) e `--skip-invalid`. Com `--skip-invalid`,
  cada aviso sai em stderr como `warning: <mensagem>`, uma linha por aviso, e o retorno é 0. Os erros de R4
  seguem 8.2 (`error: unknown report 'x'`, retorno 2).

### 9.3 Agregação do relatório `monthly`

- **R8** Os pedidos são agrupados pelo mês da data (`AAAA-MM`) e, dentro do mês, pela região. Pedidos `cancelled`
  são ignorados. Um pedido `paid` soma em `orders`, `units`, `gross`, `discount` e `net` como em 4.1. Um pedido
  `refunded` soma apenas em `refunded` o seu `net` (4.1); não entra em `orders`, `units`, `gross`, `discount`, `net`.
- **R9** Meses em ordem crescente, do primeiro ao último mês que têm pedido `paid` ou `refunded`. Os meses
  intermediários sem nenhum desses pedidos TAMBÉM aparecem, sem linhas de região e com subtotal zerado (vale
  entre anos: de `2023-11` a `2024-02` são quatro meses). Sem nenhum pedido `paid` ou `refunded`, não há meses.
- **R10** Dentro do mês, uma linha por região que tem pedido `paid` ou `refunded` naquele mês (só `refunded` →
  linha com `net` 0.00). Ordem: `net` decrescente; no empate, a região que aparece primeiro no arquivo, naquele
  mês, entre os pedidos não cancelados (NÃO é ordem alfabética).
- **R11** `share` da região no mês, em percentual do `net` do mês com uma casa, pelo método do maior resto, de modo
  que os `share` do mês somem exatamente `100.0`: calcula-se `net da região × 1000 / net do mês`; cada região
  recebe a parte inteira (em décimos de ponto percentual); os décimos que faltam para 1000 são dados, um a um, às
  regiões de maior parte fracionária e, no empate, à que vem antes na ordem de R10. Três regiões iguais dão
  `33.4`, `33.3`, `33.3`; com `net` 30, 10, 10 e 10 dão `50.0`, `16.7`, `16.7`, `16.6`. Se o `net` do mês é 0,
  todo `share` é `0.0`.
- **R12** Subtotal do mês: soma das linhas do mês em `orders`, `units`, `gross`, `discount`, `net`, `refunded`; o
  `share` do subtotal é `100.0` se o `net` do mês é maior que 0 e `0.0` caso contrário. Total geral: soma dos
  meses, sem `share`, mais `average_order = net / orders` (centavo, meio para cima; `0.00` se `orders` é 0).

### 9.4 Saídas do relatório `monthly`

- **R13** Texto (mesmas convenções da seção 5: `\n`, sem espaço no fim, dinheiro com milhar, células unidas por
  dois espaços, sem corte). Linhas, na ordem: `MONTHLY REPORT`; `Period: <primeiro mês> to <último mês>` (ou
  `Period: -` sem meses); linha vazia; a tabela; linha vazia; `Average order: X`; e a linha de R6, se houver.
  Tabela: larguras 7, 6, 6, 6, 12, 12, 12, 12, 6; as duas primeiras colunas alinhadas à esquerda, as demais à
  direita. Cabeçalho: `MONTH`, `REGION`, `ORDERS`, `UNITS`, `GROSS`, `DISCOUNT`, `NET`, `REFUNDED`, `SHARE`.
  Linha de região: mês, região, números, `share` seguido de `%`. Linha de subtotal: `REGION` = `TOTAL` e `share`
  com `%`. O mês só é escrito na PRIMEIRA linha de cada mês (as outras ficam com `MONTH` vazio; num mês sem
  regiões a primeira linha é o subtotal). Última linha da tabela: `MONTH` = `TOTAL`, `REGION` e `SHARE` vazios.
- **R14** CSV (convenções 6.1 e 6.2). Cabeçalho `month,region,orders,units,gross,discount,net,refunded,share`.
  Linha de região: mês e região. Subtotal do mês: mês e `region` = `*`. Total geral (sempre a última linha, mesmo
  sem meses): `month` = `*`, `region` = `*`, `share` vazio. O mês é escrito em todas as linhas.
- **R15** JSON (indentação e `\n` final como na seção 7). Objeto com `report` (`"monthly"`), `first_month`,
  `last_month` (texto `AAAA-MM` ou `null`), `orders`, `units` (inteiros), `gross`, `discount`, `net`, `refunded`,
  `average_order` (texto com duas casas) e `months`: lista de objetos com `month`, `orders`, `units`, `gross`,
  `discount`, `net`, `refunded`, `share` (texto com uma casa) e `regions`: lista de objetos com `region`, `orders`,
  `units`, `gross`, `discount`, `net`, `refunded`, `share`. Nenhuma outra chave.
- **R16** Exemplo. Entrada:

```text
order_id,date,region,product,quantity,unit_price,discount_pct,status
1,2023-11-03,west,W,1,10.00,,
2,2023-11-15,EAST,W,1,10.00,,PAID
3,2023-11-15,North,G,1,10.00,,
4,2023-11-20,north,G,3,1000.00,10,refunded
5,2024-01-02,east,W,10,250.00,15,
6,2024-01-17,SOUTH,W,3,25.00,0,cancelled
7,2024-01-30,WEST,C,x,3.35,5,
```

Saída de `run(entrada, "text", "monthly", skip_invalid=True)`:

```text
MONTHLY REPORT
Period: 2023-11 to 2024-01

MONTH    REGION  ORDERS   UNITS         GROSS      DISCOUNT           NET      REFUNDED   SHARE
2023-11  WEST         1       1         10.00          0.00         10.00          0.00   33.4%
         EAST         1       1         10.00          0.00         10.00          0.00   33.3%
         NORTH        1       1         10.00          0.00         10.00      2,700.00   33.3%
         TOTAL        3       3         30.00          0.00         30.00      2,700.00  100.0%
2023-12  TOTAL        0       0          0.00          0.00          0.00          0.00    0.0%
2024-01  EAST         1      10      2,500.00        375.00      2,125.00          0.00  100.0%
         TOTAL        1      10      2,500.00        375.00      2,125.00          0.00  100.0%
TOTAL                 4      13      2,530.00        375.00      2,155.00      2,700.00

Average order: 538.75
Skipped rows: 1
```
