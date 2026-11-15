# SPEC — relkit

Seis módulos independentes em `relkit/core/` e um módulo de integração em `relkit/report/build.py`. Hoje todas as
funções levantam `NotImplementedError`. Os módulos de `core/` não importam uns aos outros; só usam `relkit.types`,
`relkit.errors` e `relkit.util` (já prontos, ver o código). Só biblioteca padrão.

Erros: texto inválido levanta `ParseError(kind, text, reason)` (mensagem
`invalid <kind> <repr(text)>: <reason>`); argumentos de programação inválidos levantam `ValueError`;
`ConfigError(line, reason)` e `ReportError(msg)` como em `relkit/errors.py`.

## 1. `core/semver.py`

`parse_version(text) -> Version` · `format_version(v) -> str` · `compare_versions(a, b) -> int` ·
`bump(v, part) -> Version` · `satisfies(v, spec) -> bool` · `max_satisfying(versions, spec)`.
Onde se diz "versão", `compare_versions`, `bump`, `satisfies` e `max_satisfying` aceitam `Version` ou `str`.

- S1 `parse_version`: espaços nas pontas são ignorados; um `v` minúsculo inicial é aceito. Forma
  `MAJOR.MINOR.PATCH[-PRE][+BUILD]`. Os três números são inteiros sem sinal, sem zero à esquerda
  (`util.numbers.parse_uint`). Erros: `ParseError("version", ...)` com a razão `expected MAJOR.MINOR.PATCH`
  (quantidade de partes ≠ 3), `bad number`, `bad pre-release`, `leading zero in pre-release` ou `bad build metadata`.
- S2 `PRE` são identificadores separados por `.`; cada um usa só `[0-9A-Za-z-]` e não é vazio. Um identificador só
  de dígitos vira `int` (sem zero à esquerda, senão `leading zero in pre-release`); os demais ficam `str`. `BUILD`
  idem, mas tudo fica `str` e zeros à esquerda são permitidos. O `PRE` começa no primeiro `-` depois do `PATCH`
  (`1.0.0-alpha-1` tem `pre == ("alpha-1",)`). O `BUILD` começa no primeiro `+`.
- S3 `format_version` é o inverso: `1.2.3`, `1.2.3-rc.1`, `1.2.3-rc.1+b5`; sem o `v`.
- S4 `compare_versions` devolve -1, 0 ou 1 e ignora `build`. Compara `(major, minor, patch)`; com os três iguais,
  uma versão sem `pre` é MAIOR que qualquer uma com `pre`; entre dois `pre`, compara-se identificador a identificador:
  inteiros por valor, textos em ordem ASCII, inteiro sempre MENOR que texto; se um é prefixo do outro, o menor é o
  mais curto. (`1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 <
  1.0.0-rc.1 < 1.0.0`.)
- S5 `bump(v, part)` com `part` em `"major"`, `"minor"`, `"patch"`: incrementa, zera os menores e descarta `pre` e
  `build`. Outro `part` levanta `ValueError`.
- S6 `satisfies(v, spec)`: `spec` é uma ou mais alternativas separadas por `||`; cada alternativa é uma lista de
  cláusulas separadas por `,` (todas valem). Cláusula: `*` (qualquer), ou operador + versão completa: `>=`, `<=`,
  `>`, `<`, `=` (ou sem operador), `^`, `~`. `^X.Y.Z` = `>=X.Y.Z` e `<` o próximo maior não zero (`^1.2.3` → `<2.0.0`,
  `^0.2.3` → `<0.3.0`, `^0.0.3` → `<0.0.4`). `~X.Y.Z` = `>=X.Y.Z` e `<X.(Y+1).0`. Espaços ao redor das cláusulas
  são ignorados. Spec vazio, cláusula vazia ou versão inválida na cláusula → `ParseError("spec", spec, ...)`.
- S7 Pré-lançamento: uma versão com `pre` só satisfaz uma alternativa se, além das cláusulas, alguma cláusula dela
  escreve uma versão com `pre` e o mesmo `(major, minor, patch)`. (`1.3.0-beta.1` não satisfaz `^1.2.0`, mas satisfaz
  `>=1.3.0-alpha`.) Dentro da alternativa as comparações usam S4.
- S8 `max_satisfying(versions, spec)`: devolve o ELEMENTO original (não convertido) de maior versão entre os que
  satisfazem `spec`; em empate (iguais por S4, ex.: só o `build` difere) vale o primeiro; `None` se nenhum.
  Todas as entradas são analisadas: uma inválida levanta `ParseError` mesmo que outra seja candidata.

## 2. `core/globmatch.py`

`glob_match(pattern, path) -> bool` · `filter_paths(patterns, paths) -> list`.

- G1 O `path` é dividido com `util.paths.segments` (`\` vira `/`, segmentos vazios e `.` somem). O padrão só usa `/`
  como separador (vazios e `.` também somem); `\` no padrão é escape: `\x` é o caractere `x` literal.
- G2 Em um segmento, `*` casa qualquer sequência (inclusive vazia) e `?` casa um caractere; nenhum casa `/`.
  Maiúsculas e minúsculas são diferentes.
- G3 Segmento inteiro `**` casa zero ou mais segmentos (`a/**/b` casa `a/b`; `a/**` casa `a` e `a/x/y`).
- G4 Classes `[abc]`, `[a-z]`, `[!abc]` (negada); um `]` logo depois de `[` ou `[!` é literal. Casa um caractere.
- G5 Alternativas `{a,b,c}` (uma por vez, sem aninhar, podem ser vazias; dentro de uma classe `{` é literal) expandem
  o padrão inteiro: `src/*.{py,pyi}` ≡ `src/*.py` ou `src/*.pyi`.
- G6 Nomes ocultos: `*`, `?`, `[...]` e `**` não casam um segmento que comece com `.`, a menos que o próprio
  segmento do padrão comece com `.` literal (`.*` casa `.env`; `*` não casa `.env`; `**` não atravessa `.git/`).
- G7 Erros de padrão: `ParseError("pattern", pattern, reason)` com `empty` (padrão vazio ou só `/`/`.`),
  `unclosed class`, `unclosed brace`, `nested braces`, `dangling escape` (`\` final), `bad class` (ex.: `[z-a]`).
  `glob_match` valida o padrão mesmo quando o `path` não casa.
- G8 `filter_paths(patterns, paths)`: um `!` inicial nega o padrão (`\!` é um `!` literal). Para cada caminho, os
  padrões são aplicados em ordem; vale o ÚLTIMO que casa: negado exclui, normal inclui; nenhum casa → excluído.
  Devolve os caminhos ORIGINAIS (sem normalizar) na ordem de entrada. Todos os padrões são validados mesmo com
  `paths` vazio.

## 3. `core/manifest.py`

`parse_manifest(text) -> Manifest`; `Manifest.sections` é `dict[str, dict[str, str]]` (na ordem do arquivo) e
`Manifest.get("secao.chave", default)` devolve o valor; sem `default` e ausente → `ConfigError(0, "missing 'secao.chave'")`.
A classe também aceita `Manifest(sections, lines=None)`. Linhas terminam em `\n` (um `\r` final é ignorado).

- M1 Linha em branco ou cuja primeira não-branca é `#` ou `;` é ignorada; a em branco também encerra uma continuação.
- M2 `[nome]` abre uma seção (`[A-Za-z][A-Za-z0-9_-]*`, espaços nas pontas ok). Inválido →
  `ConfigError(n, "bad section header")`; repetido → `duplicate section 'nome'`.
- M3 `chave = valor`: o primeiro `=` fora de aspas separa (`util.scan.find_unquoted`). Chave `[A-Za-z][A-Za-z0-9_.-]*`.
  Razões, nesta ordem de checagem: sem `=` → `expected 'key = value'`; chave vazia → `empty key`; chave inválida →
  `bad key 'x'`; antes de qualquer seção → `key outside section`; repetida na seção → `duplicate key 'x'`.
- M4 Valor sem aspas: sem espaços nas pontas; um comentário começa no primeiro `#` precedido de espaço/tab
  (`a#b` é o valor inteiro; `a #b` vale `a`). Valor entre aspas duplas (`"..."`): escapes `\n`, `\t`, `\"`, `\\`
  (outro → `bad escape '\q'`); depois da aspa final só pode haver espaços ou um espaço seguido de `# comentário` (senão
  `text after closing quote`); sem aspa final → `unterminated string`. Entre aspas preserva espaços internos.
- M5 Continuação: linha que começa com espaço ou tab (e não é vazia nem comentário) logo após uma chave (sem linha
  em branco no meio) acrescenta ao valor ` ` + o texto da linha (sem espaços das pontas, sem comentário `#`).
  Sem chave anterior → `unexpected continuation`; chave anterior entre aspas → `continuation of quoted value`.
- M6 Interpolação, depois de ler o arquivo todo: `${secao.chave}` vira o valor (já interpolado) dessa chave, em
  qualquer valor (inclusive entre aspas), com referências para a frente permitidas; `$$` vira `$`; um `$` sozinho
  fica literal. Valores resolvidos são definitivos (um `$` que veio de `$$` não é reinterpretado). As chaves são
  resolvidas em ordem do arquivo, em profundidade. Erros usam a LINHA da chave cujo valor tem a referência:
  `unknown reference 'a.b'`, `unterminated reference` (`${` sem `}`) e `cycle at 'a.b'` (a.b já estava em
  resolução; `a.x = ${a.x}` é ciclo). Ex.: `x = ${s.y}` (linha 2) e `y = ${s.x}` (linha 3) → `ConfigError(3, "cycle at 's.x'")`.
- M7 `ConfigError.line` conta a partir de 1 (a linha da chave, nas continuações).

## 4. `core/duration.py`

`parse_duration(text) -> int` (milissegundos) · `format_duration(ms) -> str`.

- D1 Texto = partes `<número><unidade>` (espaços entre partes são permitidos, nunca entre número e unidade; as
  pontas são ignoradas). Número: dígitos com `.dígitos` opcional (`1.5`; não `1.`, `.5`, sinal ou expoente).
  Unidades: `d`=86400000, `h`=3600000, `m`=60000, `s`=1000, `ms`=1 ms (minúsculas).
- D2 As unidades aparecem em ordem estritamente decrescente (d, h, m, s, ms), sem repetir: `1m1h` e `1s1s` são erro.
- D3 Soma exata em frações e arredonda UMA vez no fim para o inteiro mais próximo, empate para o par
  (`util.numbers.div_round_half_even`): `1.5s` → 1500, `0.0005s` → 0, `0.0015s` → 2, `1h0.5ms` → 3600000.
- D4 `ParseError("duration", text, reason)`: `empty` (vazio/só espaços), `unknown unit` (letras que não são unidade,
  ex. `5x`, `5H`, `1hm`; checado antes da ordem), `units out of order`, `bad syntax` (todo o resto: `1h30`,
  `1 h`, `h`, `1.s`).
- D5 `format_duration(ms)`: `ms` int (não bool) ≥ 0, senão `ValueError`. `0` → `0ms`; senão as partes não nulas de
  d, h, m, s, ms separadas por um espaço: `90061001` → `1d 1h 1m 1s 1ms`; `60000` → `1m`. `parse_duration(format_duration(n)) == n`.

## 5. `core/table.py`

`render_table(headers, rows, aligns="", max_widths=None) -> str`.

- T1 Cada célula vira `str` (`None` → vazio); `\r`, `\n` e `\t` viram um espaço cada.
- T2 `max_widths`: lista, uma entrada por coluna, `int` ≥ 1 ou `None`; célula (e cabeçalho) mais larga que o limite é
  cortada por `util.text.truncate`. Tamanho diferente do número de colunas → `ValueError`.
- T3 Larguras medidas com `util.text.display_width` (CJK = 2, combinantes = 0); cada coluna tem a largura da maior
  célula (cabeçalho incluso), no mínimo 1.
- T4 `aligns`: string com um de `l`, `r`, `c` por coluna (vazia = tudo `l`); alinha cabeçalho e células com
  `util.text.pad`. Tamanho errado ou caractere inválido → `ValueError`. `headers` vazio → `ValueError`.
- T5 Formato: linha de cabeçalho, linha separadora e uma linha por registro, unidas por `\n` (sem `\n` final). Células
  de uma linha unidas por ` | `; o separador é `-` × largura de cada coluna unidos por `-+-`; todas as linhas
  sem espaços à direita (`rstrip`).
- T6 Linha com número de células diferente das colunas → `ValueError("row N has X cells, expected Y")`, `N` a
  partir de 1. Sem linhas, saem só cabeçalho e separador.

```text
render_table(["Name", "Qty"], [["apple", 3], ["fig", 12]], "lr")
Name  | Qty
------+----
apple |   3
fig   |  12
```

## 6. `core/money.py`

`relkit.types.Money(units, currency)` e `CURRENCIES` já existem (casas decimais: USD/EUR/BRL 2, JPY 0, KWD 3).

- Y1 `parse_money(text)`: duas palavras separadas por espaço, `CODE valor` ou `valor CODE`. `CODE` precisa estar em
  `CURRENCIES` (maiúsculas), senão `ParseError("money", text, "unknown currency")`. Valor: `-` opcional, inteiro com
  milhares opcionais por vírgula em grupos de 3 (`1,234`; `1,23` é erro) e parte decimal opcional com no máximo as
  casas da moeda (menos casas completam com zeros: `USD 12.5` → 1250; mais → `too many decimals`). Outros erros:
  `bad amount`, e `expected 'CODE amount' or 'amount CODE'` (palavras ≠ 2).
- Y2 `format_money(m)`: `CODE` + um espaço + (`-` se negativo) + inteiro com vírgula de milhar + `.` + casas (JPY sem ponto):
  `USD 1,234.50`, `USD -5.00`, `JPY 1,500`, `KWD 0.005`.
- Y3 `split_money(m, weights) -> list[Money]`: divide `|units|` proporcionalmente aos pesos (lista de `int` ≥ 0, não
  vazia, soma > 0, sem `bool`; senão `ValueError`) pelo método do maior resto: cota inteira para cada um e as
  unidades que sobram, uma a uma, a quem tem o maior resto (empate: menor índice). O sinal de `m` é reaplicado. A
  soma é sempre `m`. `split_money(Money(100,"USD"), [1,1,1])` → 34, 33, 33.
- Y4 `apply_rate(m, rate, rounding="half_even")`: `rate` é percentual `12.5%` (dígitos, `.dígitos` opcional, `%`
  obrigatório) → `ParseError("rate", rate, "bad rate")`. Resultado = `units × rate / 100`, mesma moeda, arredondado:
  `half_even` (empate para o par) ou `half_up` (empate se afasta do zero); em ambos, o sinal é simétrico
  (`-2.5` → -2 em even, -3 em up). Outro `rounding` → `ValueError`.
- Y5 `convert(m, to, rate, rounding="half_even")`: `rate` é decimal positivo com até 6 casas (`5.1234`), unidades da
  moeda `to` por 1 unidade MAIOR da origem, ajustando as casas decimais das duas moedas (USD→JPY a `150`: `USD 1.00` →
  `JPY 150`). Moeda `to` desconhecida ou igual à de `m` → `ValueError`; `rate` mal formado, zero ou com mais de 6
  casas → `ParseError("rate", rate, ...)`. Arredondamento como em Y4.
- Y6 `add(a, b)`: moedas diferentes → `ValueError("currency mismatch: USD vs EUR")`. `sum_money(items, currency)`:
  soma de uma lista de `Money` (vazia → `Money(0, currency)`); moeda diferente em qualquer item → `ValueError`.

## 7. `report/build.py`

`build_report(manifest_text, entries, history=()) -> str`; `entries` são `report.model.FileEntry(path, size, build)`;
`history` é uma lista de versões (`str` ou `Version`). Usa os seis módulos de `core/`. `relkit.cli` já a chama.

Chaves do manifesto: `release.name`, `release.version`, `artifacts.include`, `cost.rate_per_hour` (obrigatórias;
ausente → `ConfigError(0, "missing ...")`), e opcionais `release.channel`, `release.compat` (padrão `*`),
`artifacts.max_name`, `budget.max_cost`, `cost.shares`. Erros de `core/` se propagam sem troca de tipo.

- B1 `artifacts.include`: padrões separados por vírgula FORA de chaves `{}` (o `\x` escapa), cada um sem espaços nas
  pontas, vazios descartados; nenhum → `ReportError("no include patterns")`.
- B2 Seleção: `filter_paths(padrões, caminhos normalizados)` com `util.paths.normalize`; ficam as entradas cujo caminho
  normalizado passou. Nenhuma → `ReportError("no files match")`. Ordem: tamanho decrescente, depois caminho
  normalizado crescente, estável.
- B3 `artifacts.max_name` (se não vazio): `int` ≥ 2 (`parse_uint`), largura máxima da coluna File; senão
  `ReportError("bad max_name")`.
- B4 Custo de cada arquivo = `rate_per_hour.units × ms / 3600000` arredondado half-even, na moeda de `rate_per_hour`
  (`ms` vem de `parse_duration(build)`).
- B5 Corpo: `Release <name> <versão>` (+ um espaço e `(<channel>)` se houver); `Next: patch X, minor Y, major Z` (via `bump`);
  `Compatible: <elemento de max_satisfying(history, compat)>` ou `none`; linha em branco; tabela com cabeçalho
  `File`, `Size`, `Build`, `Cost` e alinhamento `lrrr` (File = caminho normalizado, Size com milhar por vírgula,
  Build = `format_duration`, Cost = `format_money`); linha em branco; `Total: N files, S bytes, <duração total>,
  <custo total>` (S com milhar por vírgula); linhas unidas por `\n`, sem `\n` final.
- B6 `budget.max_cost` (se não vazio): moeda diferente do custo → `ReportError("budget currency mismatch")`; custo
  maior que o teto → `OVER BUDGET by <diferença>`; senão `Within budget: <diferença> left` (diferença ≥ 0).
- B7 `cost.shares` (se não vazio): pesos inteiros separados por `:` (`parse_uint` em cada, espaços ignorados), custo
  total dividido por `split_money` → `Shares: <a> / <b> / ...`; peso inválido ou soma zero → `ReportError("bad shares")`.
  As linhas B6 e B7, quando existem, vêm depois de `Total:`, nessa ordem.

Exemplo — manifesto:

```ini
[release]
name = "relkit"
version = 1.4.0
channel = stable
compat = ^1.0.0

[artifacts]
include = dist/*.{whl,tar.gz}, !dist/*-debug.*
max_name = 20

[cost]
rate_per_hour = USD 12.00
shares = 3:1

[budget]
max_cost = USD 1.00
```

Entradas `dist/relkit-1.4.0.whl` (120000 B, `1m30s`), `dist/relkit-1.4.0.tar.gz` (95000 B, `45s`),
`dist/relkit-1.4.0-debug.whl` (900000 B, `2m`), `docs/guide.pdf` (5000 B, `10s`); `history = ["1.3.2", "2.0.0", "1.3.10", "1.4.0-rc.1"]`:

```text
Release relkit 1.4.0 (stable)
Next: patch 1.4.1, minor 1.5.0, major 2.0.0
Compatible: 1.3.10

File                 |    Size |  Build |     Cost
---------------------+---------+--------+---------
dist/relkit-1.4.0.w… | 120,000 | 1m 30s | USD 0.30
dist/relkit-1.4.0.t… |  95,000 |    45s | USD 0.15

Total: 2 files, 215,000 bytes, 2m 15s, USD 0.45
Within budget: USD 0.55 left
Shares: USD 0.34 / USD 0.11
```

(`1.4.0-rc.1` não entra em `Compatible` por S7; `2.0.0` não satisfaz `^1.0.0`; `1.3.10 > 1.3.2` por S4.)
