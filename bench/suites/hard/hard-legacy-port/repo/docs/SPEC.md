# SPEC — pacote `frete` (porta do legado)

O pacote `frete` substitui `legacy/frete_calc.py`, `legacy/frete_tab.py` e `legacy/frete_fmt.py`. A API muda
(objetos imutáveis, exceções, nenhum estado global), mas os 20 comportamentos observáveis da seção 3 são os
do legado e devem ser preservados exatamente. Os valores das tabelas (zonas, preços, prazos, multiplicadores,
limites) são os de `legacy/frete_tab.py`; os comentários do legado descrevem os detalhes de cada regra.

## 1. Escopo

- R0.1 `frete` não importa nada de `legacy` (nem direta nem indiretamente): `legacy/` será apagado depois da
  migração. `frete` pode usar `util/`.
- R0.2 `legacy/`, `app/` e `tests/` ficam como estão; `tests/` continua passando.
- R0.3 Fora do escopo: fechamento do dia (`fechamento`, `resumo_por_*`, `ticket_medio`, `maior_cotacao`,
  `linhas_csv`, `rodape`), `calcula_varios`, `dump_tabela`, `confere_tabelas` e a conversão de texto para
  número (`_num`): na API nova todos os números são `int`.

## 2. API

Tudo abaixo é importável direto de `frete` (`from frete import Cotador, Item, ...`).

### 2.1 Modelos (dataclasses `frozen=True`; atribuir a um campo levanta `AttributeError`)

- `Item(peso_g, comprimento_cm, largura_cm, altura_cm, quantidade=1, valor_centavos=0)` — `valor_centavos` é o
  valor declarado de UMA unidade.
- `Pedido(cep_destino, itens, servico="N", cupom="")` — `itens` é uma sequência (tupla ou lista) de `Item`.
- `Cotacao(numero, cep_destino, zona, servico, peso_taxavel_g, volumes, frete_centavos, seguro_centavos,
  total_centavos, prazo_dias, avisos=())` — campos nessa ordem, aceitos por nome; `cep_destino` com 8 dígitos
  sem separadores; `servico` é `"N"`, `"E"` ou `"X"`; `avisos` é uma tupla de `str`;
  `total_centavos = frete_centavos + seguro_centavos`.
- `Item` e `Pedido` não validam nada na construção; toda validação acontece em `Cotador.cotar`.

### 2.2 Exceções

`ErroFrete(Exception)` é a base; cada subclasse tem o atributo de classe `codigo` com o código do legado:

| Classe | `codigo` |
|---|---|
| `ErroPedidoVazio` | 1 |
| `ErroCep` | 2 |
| `ErroItem` | 3 |
| `ErroServico` | 4 |
| `ErroPeso` | 5 |

### 2.3 `Cotador`

- `Cotador(cep_origem="01310-100")` — o CEP de origem passa pela mesma normalização/validação do CEP de destino
  (C1); inválido levanta `ErroCep` no construtor. Substitui a constante `ORIGEM` do legado na regra C2.
- `cotador.cotar(pedido) -> Cotacao` — levanta a subclasse de `ErroFrete` correspondente em caso de erro.
- `cotador.historico` — tupla com as `Cotacao` bem-sucedidas dessa instância, em ordem.
- `cotador.total_acumulado` — soma de `total_centavos` do histórico (`int`, 0 no início).
- Instâncias são independentes entre si; não há estado em módulo.

### 2.4 Formatação (funções)

- `formata_moeda(centavos) -> str`, `formata_peso(gramas) -> str`
- `etiqueta(cotacao) -> str`, `linha_csv(cotacao) -> str` — dependem só dos campos da `Cotacao` recebida.

## 3. Comportamentos a preservar

- C1 **CEP.** Removem-se espaços, hífens e pontos; o resto precisa ser exatamente 8 dígitos e diferente de
  `00000000`, senão `ErroCep`.
- C2 **Zona.** Nesta ordem: 3 primeiros dígitos iguais aos da origem → zona 0; 2 primeiros dígitos na tabela de
  exceções → zona da exceção; senão zona pelo primeiro dígito.
- C3 **Itens.** Item com `quantidade == 0` é ignorado antes de qualquer validação. Nos demais,
  `quantidade < 0`, `peso_g <= 0` ou qualquer dimensão negativa → `ErroItem`. Dimensão 0 é válida.
- C4 **Pedido vazio.** Se não sobra nenhum item (lista vazia ou só quantidades 0) → `ErroPedidoVazio`.
- C5 **Peso cubado.** Por item, em gramas: `comprimento * largura * altura // 6` (truncado). Vale o maior entre
  o peso real e o cubado, item a item, e só então multiplica-se pela quantidade.
- C6 **Peso taxável.** A soma do pedido sobe para o próximo múltiplo de 100 g (arredonda o total, não cada item).
- C7 **Limite.** Peso taxável acima de 30 000 g → `ErroPeso`; 30 000 g exatos são aceitos.
- C8 **Ordem das verificações.** Itens na ordem da lista (C3), pedido vazio (C4), CEP (C1), peso (C7),
  serviço (C10). O primeiro erro encontrado nessa ordem é o levantado.
- C9 **Serviço.** Tiram-se os espaços das pontas; só a primeira letra conta, sem diferenciar maiúsculas
  (`"expresso"` → `E`). Vazio → `N` sem aviso. Letra fora de `N`/`E`/`X` → `N` com o aviso
  `servico desconhecido: <texto>` (texto como veio, só sem os espaços das pontas).
- C10 **Serviço X na zona 5** → `ErroServico`.
- C11 **Preço base.** Faixas "até 1 kg", "até 5 kg", "até 10 kg" com o limite pertencendo à faixa de baixo; acima
  de 10 kg, preço dos 10 kg mais o adicional por kg começado.
- C12 **Combustível.** Zonas 3, 4 e 5: a base recebe 5% (meio centavo sobe), antes do multiplicador do serviço.
- C13 **Multiplicador do serviço.** `N` 100%, `E` 150%, `X` 220% sobre a base, meio centavo sobe.
- C14 **Manuseio.** Mais de 10 volumes (soma das quantidades): R$ 2,00 por volume além do décimo, somados
  depois do multiplicador e antes do piso.
- C15 **Piso.** Frete menor que R$ 12,00 vira R$ 12,00; aplicado antes do cupom e não reaplicado depois.
- C16 **Cupom** (sem espaços das pontas, sem diferenciar maiúsculas). `FRETE10`: desconto de 10% do frete (meio
  centavo sobe no desconto). `GRATIS`: frete 0, só com serviço `N` e zona ≤ 2; fora disso é ignorado sem aviso.
  Vazio: nada. Qualquer outro: ignorado com o aviso `cupom desconhecido: <CUPOM EM MAIÚSCULAS>`.
- C17 **Seguro.** Valor declarado total = soma de `valor_centavos * quantidade`. Se passar de R$ 500,00, seguro =
  1% do excedente, truncado; senão 0. Nenhum cupom altera o seguro.
- C18 **Prazo.** Zona 0: sempre 1. Demais: prazo da tabela; `E` → metade arredondada para cima; `X` → 1; depois,
  peso taxável acima de 10 000 g soma 1 dia (inclusive no `X`).
- C19 **Numeração.** `numero` começa em 1 por instância de `Cotador` e só avança em cotação bem-sucedida; uma
  cotação com erro não entra no histórico nem no acumulado. Avisos na ordem: serviço, depois cupom.
- C20 **Formatos.**
  - `formata_moeda`: `R$` + um espaço + reais com ponto de milhar + vírgula + 2 dígitos (`123456` → `R$ 1.234,56`).
  - `formata_peso`: quilos com uma casa truncada e vírgula (`2300` → `2,3 kg`).
  - `etiqueta`: linhas unidas por `\n`, sem quebra final, como nos exemplos: valores em rótulo de 8 colunas +
    valor alinhado à direita em 16; a linha `Seguro:` só existe quando o seguro é maior que zero; prazo 1 é
    `1 dia util`, os demais `N dias uteis`; uma linha `Aviso: <texto>` por aviso; nomes dos serviços: `NORMAL`,
    `EXPRESSO`, `EXTREMO`; número com 4 dígitos.
  - `linha_csv`: `numero(4 dígitos);cep;zona;servico;peso_taxavel_g;volumes;frete;seguro;total;prazo`.

## 4. Exemplos

```python
from frete import Cotador, Item, Pedido, etiqueta, linha_csv

cotador = Cotador()
c1 = cotador.cotar(Pedido("04567-000", (Item(1200, 30, 20, 10, 2, 15000),), "E", "frete10"))
c2 = cotador.cotar(Pedido("69.012-345", (Item(4000, 40, 30, 30, 1, 120000), Item(250, 0, 0, 0, 12)), "turbo", "abc"))
```

`etiqueta(c1)`:

```text
COTACAO #0001
Destino: 04567-000 (zona 1)
Servico: EXPRESSO
Peso taxavel: 2,4 kg
Volumes: 2
Frete:          R$ 29,70
Total:          R$ 29,70
Prazo: 1 dia util
```

`linha_csv(c1)` é `0001;04567000;1;E;2400;2;2970;0;2970;1`.

`etiqueta(c2)`:

```text
COTACAO #0002
Destino: 69012-345 (zona 5)
Servico: NORMAL
Peso taxavel: 9,0 kg
Volumes: 13
Frete:         R$ 120,45
Seguro:          R$ 7,00
Total:         R$ 127,45
Prazo: 14 dias uteis
Aviso: servico desconhecido: turbo
Aviso: cupom desconhecido: ABC
```

`linha_csv(c2)` é `0002;69012345;5;N;9000;13;12045;700;12745;14` e `cotador.total_acumulado` é `15715`.
