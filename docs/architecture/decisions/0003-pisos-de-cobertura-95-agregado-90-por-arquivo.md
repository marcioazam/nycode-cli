# ADR-0003: Pisos de cobertura de 95% agregado e 90% por arquivo de produção

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) NFR-5,
  NFR-4; substitui os pisos de 90%/80% adotados na Wave 0

## Contexto

O NyCode CLI já operava com dois pisos de cobertura desde a Wave 0 — 90%
agregado e 80% por arquivo de produção — implementados em
[`scripts/coverage-gate.sh`](../../../scripts/coverage-gate.sh) e travados no job
`coverage` do CI. O desenho de dois pisos veio do ADR-0393 do `nylla-gateway` e
resolve um problema concreto: **o agregado sozinho esconde a própria
distribuição**. Num workspace de 5.568 linhas, um arquivo de 80 linhas
completamente sem teste custa ao agregado 1,4 ponto percentual — um erro de
arredondamento — enquanto é exatamente o código que ninguém exercitou.

A questão que motivou este ADR é se 90%/80% ainda descrevem a barra do projeto.
A medição diz que não: o workspace estava em **97,68% agregado**, quase oito
pontos acima do piso. Um piso que fica muito abaixo do valor real deixa de ser um
piso e vira decoração — ele não impede regressão nenhuma até que a regressão seja
enorme. Entre a barra declarada e a barra praticada havia espaço para um crate
inteiro apodrecer sem o gate reclamar.

No piso por arquivo o quadro era diferente. Com 80%, três arquivos de produção
passavam sem ninguém notar que estavam bem abaixo do resto:
`crates/nycode-cli/src/observer.rs` em 82,5%, `crates/nycode-agent/src/agent.rs`
em 86,0% e `crates/nycode-cli/src/main.rs` em 89,9%. Nos três, o descoberto não
era código trivial: era o `impl Observer` inteiro, o roteamento de reasoning
delta e a resolução de sessão — superfícies observáveis pelo usuário, que é
precisamente o que NFR-4 exige que não degrade em silêncio.

## Decisão

Os pisos passam a ser:

1. **Agregado ≥ 95,0%** de linhas sobre todo o workspace.
2. **Todo arquivo de produção** (`crates/*/src/**`) com pelo menos uma linha
   instrumentada **≥ 90,0%**.

Ambos são duros e falham fechado. Três restrições acompanham a decisão e não são
negociáveis:

1. **O piso sobe com a dívida paga, não com a dívida declarada.** Elevar o piso
   e simultaneamente abrir exemptions para os arquivos que ele reprova é trocar
   um número por outro sem ganhar nada. Os três arquivos abaixo de 90% foram
   levados acima do piso com teste, no mesmo commit que elevou o piso, e a
   tabela de exemptions continua vazia.
2. **Exemption é decisão revisável, nunca atalho.** Uma entrada `below-floor`
   exige razão declarada e ratcheta: quando o arquivo alcança o piso, a entrada
   obsoleta falha o gate. O mesmo vale para `no-statements` que ganhou uma
   função e para exemption cujo arquivo sumiu.
3. **Código intestável vira costura, não exemption.** O caso do `observer.rs` é o
   exemplo: ele estava em 82,5% porque a struct fixava `std::io::stdout()` no
   construtor e o progresso saía por `eprintln!`, de modo que nada da
   apresentação era observável de um teste. A resposta foi parametrizar os
   destinos de saída, não dispensar o arquivo do piso.

## Consequências

Positivas: a distância entre a barra declarada e a praticada some, então o gate
volta a detectar regressão real em vez de só catástrofe. O piso por arquivo em
90% pega o arquivo novo que chega com metade dos caminhos sem teste — o modo de
falha mais comum num repositório onde parte do código é escrita por agentes.
Como efeito colateral, o exercício de subir os três arquivos abriu costuras que
já eram devidas por desenho.

Negativas: a folga do agregado caiu de 7,7 para cerca de 2,7 pontos, então uma
feature grande que chegue com cobertura mediana pode reprovar o gate e exigir
teste antes do merge — que é o comportamento pretendido, mas custa tempo no PR.
Arquivos pequenos ficam sensíveis à aritmética: num arquivo de 22 linhas, duas
linhas descobertas já são 9,1%, o que dá pouca margem antes do piso. E linhas
genuinamente inalcançáveis passam a pesar mais: a falha de construção do runtime
tokio em `main.rs`, que só ocorre por exaustão de recursos do SO, consome 2,3% do
orçamento daquele arquivo sem que exista teste capaz de cobri-la.

Descartadas: **elevar só o agregado**, que preservaria o ponto cego que motiva o
desenho de dois pisos; **exigir 100% por arquivo**, que transformaria toda linha
inalcançável em exemption e esvaziaria o significado da tabela de exemptions;
**medir por região ou por branch em vez de linha**, tecnicamente superior mas com
número instável entre versões do LLVM, o que tornaria o gate ruidoso; e **exigir
95% também por arquivo**, simétrico e sedutor, mas que reprovaria arquivos
pequenos por uma única linha de tratamento de erro inalcançável.

Limitação conhecida: o agregado inclui código de teste — os `mod tests` inline e
`agent_test.rs` — e portanto está inflado. Descontando o que dá para separar por
nome de arquivo, a medição fica em 97,54% em vez de 97,68%, então a decisão não
muda em nenhuma das duas leituras. Separar de verdade exigiria exclusão por
região; está no [roadmap](../../product/ROADMAP.md), não neste ADR.

## Revisão

Este ADR é revisto se o agregado se estabilizar acima de 98% por várias ondas
seguidas, caso em que o piso agregado sobe de novo pela mesma lógica que o levou
a 95%. É revisto também se a cobertura passar a ser medida só sobre produção: os
dois números precisariam ser recalibrados, porque o piso atual está expresso
sobre uma medição que inclui teste. Uma terceira entrada `below-floor` na tabela
de exemptions é sinal de que o piso por arquivo está desalinhado com a realidade
do código, e obriga a reabrir a discussão em vez de acumular dispensas.
