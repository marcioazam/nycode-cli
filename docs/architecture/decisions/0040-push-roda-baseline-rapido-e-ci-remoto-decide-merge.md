# ADR-0040: Push roda baseline rapido e CI remoto decide merge

- **Status:** aceito
- **Data:** 2026-08-22
- **Supersede parcialmente:** ADR-0034, apenas a equivalencia entre hook local
  completo e os checks remotos

## Contexto

O hook `pre-push` executava `scripts/ci-local.sh --full`, repetindo testes,
cobertura, release e performance que o CI remoto tambem executa. Essa repeticao
nao cobria gates que dependem da base real do PR, da imagem ou da referencia de
paridade e tornava cada push desproporcionalmente caro.

## Decisao

`pre-push` executa `scripts/ci-local.sh --fast`. O CI remoto continua sendo a
autoridade para merge em `main`, com os 12 checks exigidos pela ADR-0034.
`--full` continua disponivel como baseline local ampliado e nao e apresentado
como equivalente ao CI remoto. Gates ja executados por `fast()` nao sao
repetidos em `full()`.

## Consequencias

Pushes recebem formatacao, clippy, testes e os controles locais rapidos sem
repetir a suite cara. Uma falha que dependa da base do PR, da imagem ou da
referencia de paridade permanece responsabilidade visivel do CI remoto.

Esta decisao nao reduz a protecao de `main`, nao remove checks obrigatorios e
nao altera a politica de revisao humana da ADR-0034.
